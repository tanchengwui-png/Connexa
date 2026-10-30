import { randomUUID } from "node:crypto";
import { getAppBaseUrl } from "@/lib/app-url";
import { BillingPeriod, PaymentStatus, SubscriptionStatus, normalizeWorkspacePackageKey, recordWorkspacePayment } from "@/lib/billing";
import { createBillplzBill, deleteBillplzBill, getBillplzBill, verifyBillplzCallbackSignature, verifyBillplzRedirectSignature } from "@/lib/billplz";
import {
  createPendingWorkspacePackageUpgrade,
  createWorkspacePackageSubscription,
  endWorkspacePackageSubscription,
  ensurePendingWorkspacePackageUpgradeStore,
  findCurrentWorkspacePackageSubscriptionForUpdate,
  findPendingWorkspacePackageUpgradeByIdForWorkspace,
  findPendingWorkspacePackageUpgradeByIdForWorkspaceForUpdate,
  findPendingWorkspacePackageUpgradeByProviderReference,
  findPendingWorkspacePackageUpgradeByProviderReferenceForUpdate,
  findWorkspaceByIdForUpdate,
  listActivePendingWorkspacePackageUpgradesByWorkspaceForUpdate,
  listPendingWorkspacePackageUpgradesByWorkspace,
  updatePendingWorkspacePackageUpgradeProvider,
  updatePendingWorkspacePackageUpgradeStatus,
  updateWorkspacePlan,
  type PendingWorkspacePackageUpgradeRow
} from "@/lib/db-auth";
import { execute, queryMany, queryOne, transaction } from "@/lib/db";
import { getPackageChargeAmount, normalizePackageBillingPeriod, PACKAGE_BILLING_PERIOD, type PackageBillingPeriod } from "@/lib/package-pricing";
import { getPlatformConfig } from "@/lib/platform-config";
import { getPlatformPackageSettings, getResolvedPublicPackageDefinition } from "@/lib/platform-packages";
import { getPublicPackageDefinition, publicPackageKeys, type PublicPackageKey } from "@/lib/public-packages";
import {
  createPaidInvoice,
  finalizeInvoiceDocumentAndEmail,
  sendInvoiceIssuedEmail
} from "@/lib/billing-management";
import { getCurrentSubscriptionOverview } from "@/lib/billing-management";

const WORKSPACE_PACKAGE_RANK: Record<PublicPackageKey, number> = {
  starter: 1,
  professional: 2,
  growth: 3,
  enterprise: 4
};

const UPGRADE_INVOICE_STATUS = {
  ISSUED: "ISSUED",
  PAYMENT_PROCESSING: "PAYMENT_PROCESSING",
  PAYMENT_EXPIRED: "PAYMENT_EXPIRED",
  PAYMENT_REVIEW_REQUIRED: "PAYMENT_REVIEW_REQUIRED",
  PAID: "PAID",
  CANCELLED: "CANCELLED",
  SUPERSEDED: "SUPERSEDED",
  EXPIRED: "EXPIRED",
  PAYMENT_FAILED: "PAYMENT_FAILED"
} as const;

type UpgradeInvoiceStatus = (typeof UPGRADE_INVOICE_STATUS)[keyof typeof UPGRADE_INVOICE_STATUS];
type PlanChangeOperationType = "UPGRADE" | "RENEWAL" | "DOWNGRADE";

const PAYMENT_PROCESSING_TIMEOUT_MINUTES = Math.max(
  1,
  Number.parseInt(process.env.PAYMENT_PROCESSING_TIMEOUT_MINUTES ?? "20", 10) || 20
);
const PAYMENT_RECONCILIATION_BATCH_SIZE = Math.max(
  1,
  Math.min(100, Number.parseInt(process.env.PAYMENT_RECONCILIATION_BATCH_SIZE ?? "25", 10) || 25)
);
const PAYMENT_RECONCILIATION_LEASE_MS = 2 * 60 * 1000;

function getWorkspacePackageRank(plan: string | null | undefined) {
  return WORKSPACE_PACKAGE_RANK[normalizeWorkspacePackageKey(plan)];
}

function isOpenInvoiceStatus(status: string) {
  return status === UPGRADE_INVOICE_STATUS.ISSUED || status === "PENDING";
}

function isFailedPlanChangeStatus(status: string) {
  return status === UPGRADE_INVOICE_STATUS.PAYMENT_FAILED;
}

function isPaymentProcessingStatus(status: string) {
  return status === UPGRADE_INVOICE_STATUS.PAYMENT_PROCESSING;
}

function getPaymentExpiresAt(paymentStartedAt: Date) {
  // Malaysia is GMT+8 year-round. Adding a duration to the stored instant is
  // timezone-safe while the source timestamp is presented and audited in GMT+8.
  return new Date(paymentStartedAt.getTime() + PAYMENT_PROCESSING_TIMEOUT_MINUTES * 60 * 1000);
}

async function recordPaymentReconciliationActivity(input: {
  upgradeId: string;
  action: string;
  reason?: string | null;
  gatewayState?: string | null;
  executor?: Parameters<typeof execute>[2];
}) {
  await execute(
    `INSERT INTO "WorkspacePackagePaymentReconciliation" (id, "upgradeId", action, reason, "gatewayState", "createdAt")
     VALUES ($1, $2, $3, $4, $5, NOW())`,
    [randomUUID().replace(/-/g, ""), input.upgradeId, input.action, input.reason ?? null, input.gatewayState ?? null],
    input.executor
  );
}

function isReplaceablePlanChangeStatus(status: string) {
  return isOpenInvoiceStatus(status) || isFailedPlanChangeStatus(status);
}

function isPayablePlanChangeStatus(status: string) {
  return isOpenInvoiceStatus(status) || isFailedPlanChangeStatus(status);
}

function matchesPlanChangeSelection(
  planChange: {
    targetPlan: string;
    currentPlan: string;
    operationType: string | null;
    billingPeriod?: string | null;
  },
  targetPlan: string,
  operationType: PlanChangeOperationType,
  billingPeriod: PackageBillingPeriod
) {
  return (
    planChange.targetPlan === targetPlan &&
    normalizeSelectedPlanChangeBillingPeriod(planChange.billingPeriod) === billingPeriod &&
    (planChange.operationType ??
      resolvePlanChangeOperation(planChange.currentPlan, planChange.targetPlan)) === operationType
  );
}

async function supersedePlanChanges(input: {
  planChanges: Array<{ id: string }>;
  replacementReason: string;
  replacedById?: string | null;
  executor: Parameters<typeof queryMany>[2];
}) {
  const changedAt = new Date();

  for (const planChange of input.planChanges) {
    await updatePendingWorkspacePackageUpgradeStatus({
      upgradeId: planChange.id,
      status: UPGRADE_INVOICE_STATUS.SUPERSEDED,
      cancelledAt: changedAt,
      completedAt: changedAt,
      replacedById: input.replacedById ?? null,
      replacementReason: input.replacementReason,
      executor: input.executor
    });
  }
}

async function listScheduledPlanChangesForUpdate(workspaceId: string, executor: Parameters<typeof queryMany>[2]) {
  return queryMany<{
    id: string;
    invoiceNumber: string | null;
  }>(
    `SELECT id, "invoiceNumber"
     FROM "PendingWorkspacePackageUpgrade"
     WHERE "workspaceId" = $1
       AND status = 'SCHEDULED'
     FOR UPDATE`,
    [workspaceId],
    executor
  );
}

async function expireScheduledPlanChanges(input: {
  workspaceId: string;
  replacementInvoiceId: string | null;
  replacementInvoiceNumber: string;
  executor: Parameters<typeof queryMany>[2];
}) {
  const scheduledPlanChanges = await listScheduledPlanChangesForUpdate(input.workspaceId, input.executor);
  for (const scheduled of scheduledPlanChanges) {
    await updatePendingWorkspacePackageUpgradeStatus({
      upgradeId: scheduled.id,
      status: UPGRADE_INVOICE_STATUS.EXPIRED,
      cancelledAt: new Date(),
      completedAt: new Date(),
      replacedById: input.replacementInvoiceId,
      replacementReason: `Expired by ${input.replacementInvoiceNumber}`,
      executor: input.executor
    });
  }
}

function buildUpgradeInvoiceNumber() {
  const date = new Date();
  const stamp = `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(
    date.getUTCDate()
  ).padStart(2, "0")}`;
  const suffix = randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase();
  return `UPG-${stamp}-${suffix}`;
}

function parseAmount(value: string | null) {
  return value === null ? null : Number(value);
}

function resolvePlanChangeOperation(currentPlan: string | null | undefined, targetPlan: string): PlanChangeOperationType {
  const currentRank = getWorkspacePackageRank(currentPlan);
  const targetRank = getWorkspacePackageRank(targetPlan);

  if (targetRank === currentRank) {
    return "RENEWAL";
  }

  return targetRank > currentRank ? "UPGRADE" : "DOWNGRADE";
}

function getNextBillingAt(billingPeriod: string | null) {
  if (billingPeriod === BillingPeriod.YEARLY) {
    const next = new Date();
    next.setUTCFullYear(next.getUTCFullYear() + 1);
    return next;
  }

  if (billingPeriod === BillingPeriod.MONTHLY) {
    const next = new Date();
    next.setUTCMonth(next.getUTCMonth() + 1);
    return next;
  }

  return null;
}

function normalizeSelectedPlanChangeBillingPeriod(
  billingPeriod: string | null | undefined
): PackageBillingPeriod {
  return billingPeriod?.trim().toUpperCase() === PACKAGE_BILLING_PERIOD.YEARLY
    ? PACKAGE_BILLING_PERIOD.YEARLY
    : PACKAGE_BILLING_PERIOD.MONTHLY;
}

async function getPayablePlanChangeTargetPackage(
  targetPackageKey: PublicPackageKey,
  billingPeriod: PackageBillingPeriod
) {
  const [settings, targetPackage] = await Promise.all([
    getPlatformPackageSettings(),
    getResolvedPublicPackageDefinition(targetPackageKey)
  ]);
  const targetSettings = settings.find((item) => item.packageKey === targetPackageKey);

  if (!targetSettings) {
    throw new Error("PLAN_NOT_FOUND");
  }

  if (!targetSettings.isVisible) {
    throw new Error("PLAN_INACTIVE");
  }

  if (targetPackage.priceAmount === null) {
    throw new Error("PLAN_NOT_PURCHASABLE");
  }

  const selectedAmount = getPackageChargeAmount({
    monthlyPriceAmount: targetPackage.monthlyPriceAmount,
    yearlyDiscountPercentage: targetPackage.yearlyDiscountPercentage,
    billingPeriod,
    currency: targetPackage.currency
  });

  if (selectedAmount === null) {
    throw new Error("PLAN_NOT_PURCHASABLE");
  }

  return {
    ...targetPackage,
    selectedBillingPeriod: billingPeriod,
    selectedAmount
  };
}

function validatePlanChangeSelection(input: {
  operationType: PlanChangeOperationType;
  workspacePlan: string;
  targetPlan: PublicPackageKey;
  currentSubscription: Awaited<ReturnType<typeof getCurrentSubscriptionOverview>>;
  now: Date;
  source: "plan-change" | "downgrade";
}) {
  const currentRank = getWorkspacePackageRank(input.workspacePlan);
  const targetRank = getWorkspacePackageRank(input.targetPlan);

  if (input.operationType === "RENEWAL") {
    if (input.source === "downgrade") {
      throw new Error("SAME_PLAN_SELECTED");
    }
    const canRenewCurrent =
      input.currentSubscription?.status === SubscriptionStatus.TRIAL ||
      input.currentSubscription?.status === SubscriptionStatus.EXPIRED;
    if (!canRenewCurrent) {
      throw new Error("Choose the current package for renewal or a higher package for upgrade.");
    }
    return;
  }

  if (input.operationType === "UPGRADE") {
    if (targetRank <= currentRank) {
      throw new Error("INVALID_UPGRADE_PLAN");
    }
    return;
  }

  if (targetRank >= currentRank) {
    throw new Error("INVALID_DOWNGRADE_PLAN");
  }

  if (!input.currentSubscription?.expiryDate || input.currentSubscription.expiryDate.getTime() > input.now.getTime()) {
    throw new Error("CURRENT_PLAN_NOT_EXPIRED");
  }
}

function buildInvoiceNumberForPlanChange(operationType: PlanChangeOperationType) {
  const prefix = operationType === "DOWNGRADE" ? "DWN" : operationType === "RENEWAL" ? "RNL" : "UPG";
  return buildInvoiceNumberForChange(prefix);
}

function addDays(value: Date, days: number) {
  return new Date(value.getTime() + days * 24 * 60 * 60 * 1000);
}

async function getBillplzCheckoutConfig() {
  const config = await getPlatformConfig();
  const apiKey = config?.billplzApiKey ?? process.env.BILLPLZ_API_KEY ?? "";
  const collectionId = config?.billplzCollectionId ?? process.env.BILLPLZ_COLLECTION_ID ?? "";
  const xSignatureKey = config?.billplzXSignatureKey ?? process.env.BILLPLZ_X_SIGNATURE_KEY ?? "";
  const sandbox = config?.billplzSandbox ?? process.env.BILLPLZ_SANDBOX === "true";

  if (!apiKey || !collectionId) {
    throw new Error("Billplz checkout is not configured yet.");
  }

  return {
    apiKey,
    collectionId,
    xSignatureKey: xSignatureKey || undefined,
    sandbox
  };
}

function buildInvoiceView(row: Awaited<ReturnType<typeof listPendingWorkspacePackageUpgradesByWorkspace>>[number]) {
  const currentPackage = getPublicPackageDefinition(normalizeWorkspacePackageKey(row.currentPlan));
  const targetPackage = getPublicPackageDefinition(normalizeWorkspacePackageKey(row.targetPlan));

  return {
    id: row.id,
    invoiceNumber: row.invoiceNumber,
    operationType: (row.operationType ?? resolvePlanChangeOperation(row.currentPlan, row.targetPlan)) as PlanChangeOperationType,
    currentPlan: row.currentPlan,
    currentPackageLabel: currentPackage.name,
    targetPlan: row.targetPlan,
    targetPackageLabel: targetPackage.name,
    amount: parseAmount(row.amount),
    currency: row.currency,
    billingPeriod: normalizeSelectedPlanChangeBillingPeriod(row.billingPeriod ?? targetPackage.billingPeriod),
    status: isOpenInvoiceStatus(row.status) ? UPGRADE_INVOICE_STATUS.ISSUED : row.status,
    providerCheckoutUrl: row.providerCheckoutUrl,
    replacedById: row.replacedById,
    replacesId: row.replacesId,
    replacementReason: row.replacementReason,
    paymentStartedAt: row.paymentStartedAt?.toISOString() ?? null,
    paidAt: row.paidAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

async function markPendingWorkspacePackageUpgradePaymentFailed(providerReference: string) {
  await ensurePendingWorkspacePackageUpgradeStore();

  return transaction(async (client) => {
    const invoice = await findPendingWorkspacePackageUpgradeByProviderReferenceForUpdate(providerReference, client);

    if (!invoice) {
      throw new Error("Upgrade invoice not found.");
    }

    if (invoice.status === UPGRADE_INVOICE_STATUS.PAID) {
      return invoice;
    }

    if (invoice.status === UPGRADE_INVOICE_STATUS.CANCELLED || invoice.status === UPGRADE_INVOICE_STATUS.SUPERSEDED) {
      return invoice;
    }

    if (!isPaymentProcessingStatus(invoice.status)) {
      return invoice;
    }

    return updatePendingWorkspacePackageUpgradeStatus({
      upgradeId: invoice.id,
      status: UPGRADE_INVOICE_STATUS.PAYMENT_FAILED,
      paymentReconciledAt: new Date(),
      paymentGatewayState: "unpaid",
      paymentReconciliationReason: "Billplz callback or redirect confirmed the payment was not completed.",
      clearPaymentReconciliationLease: true,
      executor: client
    });
  });
}

async function claimExpiredWorkspacePackagePayment(upgradeId: string, now: Date) {
  return transaction(async (client) => {
    const invoice = await queryOne<PendingWorkspacePackageUpgradeRow>(
      `SELECT * FROM "PendingWorkspacePackageUpgrade" WHERE id = $1 FOR UPDATE`,
      [upgradeId],
      client
    );
    if (!invoice || !isPaymentProcessingStatus(invoice.status) || !invoice.providerReference) {
      return null;
    }

    const paymentStartedAt = invoice.paymentStartedAt ?? invoice.createdAt;
    const paymentExpiresAt = invoice.paymentExpiresAt ?? getPaymentExpiresAt(paymentStartedAt);
    if (paymentExpiresAt.getTime() > now.getTime()) {
      return null;
    }
    if (invoice.paymentReconciliationLeaseUntil && invoice.paymentReconciliationLeaseUntil.getTime() > now.getTime()) {
      return null;
    }

    await execute(
      `UPDATE "PendingWorkspacePackageUpgrade"
       SET "paymentExpiresAt" = $2, "paymentReconciliationLeaseUntil" = $3, "updatedAt" = NOW()
       WHERE id = $1`,
      [invoice.id, paymentExpiresAt, new Date(now.getTime() + PAYMENT_RECONCILIATION_LEASE_MS)],
      client
    );
    await recordPaymentReconciliationActivity({
      upgradeId: invoice.id,
      action: "RECONCILIATION_CLAIMED",
      reason: "Payment processing timeout reached.",
      executor: client
    });
    return { ...invoice, paymentExpiresAt };
  });
}

async function markExpiredWorkspacePackagePayment(input: {
  upgradeId: string;
  gatewayState: string;
  reason: string;
  now: Date;
}) {
  return transaction(async (client) => {
    const invoice = await queryOne<PendingWorkspacePackageUpgradeRow>(
      `SELECT * FROM "PendingWorkspacePackageUpgrade" WHERE id = $1 FOR UPDATE`,
      [input.upgradeId],
      client
    );
    if (!invoice || !isPaymentProcessingStatus(invoice.status)) {
      return invoice;
    }
    const updated = await updatePendingWorkspacePackageUpgradeStatus({
      upgradeId: invoice.id,
      status: UPGRADE_INVOICE_STATUS.PAYMENT_EXPIRED,
      completedAt: input.now,
      paymentReconciledAt: input.now,
      paymentGatewayState: input.gatewayState,
      paymentReconciliationReason: input.reason,
      clearPaymentReconciliationLease: true,
      executor: client
    });
    await recordPaymentReconciliationActivity({
      upgradeId: invoice.id,
      action: "PAYMENT_EXPIRED",
      reason: input.reason,
      gatewayState: input.gatewayState,
      executor: client
    });
    return updated;
  });
}

async function releaseWorkspacePackagePaymentReconciliationLease(upgradeId: string, reason: string) {
  await transaction(async (client) => {
    const invoice = await queryOne<PendingWorkspacePackageUpgradeRow>(
      `SELECT * FROM "PendingWorkspacePackageUpgrade" WHERE id = $1 FOR UPDATE`,
      [upgradeId],
      client
    );
    if (!invoice || !isPaymentProcessingStatus(invoice.status)) return;
    await execute(
      `UPDATE "PendingWorkspacePackageUpgrade"
       SET "paymentReconciliationLeaseUntil" = NULL, "paymentReconciliationReason" = $2, "updatedAt" = NOW()
       WHERE id = $1`,
      [upgradeId, reason],
      client
    );
    await recordPaymentReconciliationActivity({ upgradeId, action: "RECONCILIATION_DEFERRED", reason, executor: client });
  });
}

export async function reconcileWorkspacePackagePayment(input: {
  upgradeId: string;
  now?: Date;
  source: "scheduled" | "preflight" | "manual";
}) {
  await ensurePendingWorkspacePackageUpgradeStore();
  const now = input.now ?? new Date();
  const invoice = await claimExpiredWorkspacePackagePayment(input.upgradeId, now);
  if (!invoice) return { status: "SKIPPED" as const };

  let config;
  try {
    config = await getBillplzCheckoutConfig();
  } catch (error) {
    await releaseWorkspacePackagePaymentReconciliationLease(
      invoice.id,
      `Billplz configuration could not be loaded: ${error instanceof Error ? error.message.slice(0, 180) : "unknown error"}`
    );
    return { status: "DEFERRED" as const };
  }
  let bill;
  try {
    bill = await getBillplzBill(config, invoice.providerReference!);
  } catch (error) {
    await releaseWorkspacePackagePaymentReconciliationLease(
      invoice.id,
      `Billplz status could not be confirmed: ${error instanceof Error ? error.message.slice(0, 180) : "unknown error"}`
    );
    return { status: "DEFERRED" as const };
  }

  if (bill.paid || bill.state.toLowerCase() === "paid") {
    const completed = await completePendingWorkspacePackageUpgrade(invoice.providerReference!, bill.paidAt ?? now);
    await recordPaymentReconciliationActivity({
      upgradeId: invoice.id,
      action: "PAYMENT_COMPLETED",
      reason: `Confirmed paid by ${input.source} reconciliation.`,
      gatewayState: bill.state
    });
    return { status: "COMPLETED" as const, invoice: completed };
  }

  if (bill.state.toLowerCase() === "deleted" && !bill.paid) {
    return { status: "EXPIRED" as const, invoice: await markExpiredWorkspacePackagePayment({
      upgradeId: invoice.id, gatewayState: bill.state, reason: "Billplz confirmed the unpaid bill is deleted.", now
    }) };
  }

  if (bill.state.toLowerCase() !== "due" || bill.paid) {
    await releaseWorkspacePackagePaymentReconciliationLease(invoice.id, `Billplz returned unhandled state: ${bill.state}`);
    return { status: "DEFERRED" as const };
  }

  try {
    await deleteBillplzBill(config, invoice.providerReference!);
    const refreshedBill = await getBillplzBill(config, invoice.providerReference!);
    if (refreshedBill.paid || refreshedBill.state.toLowerCase() === "paid") {
      const completed = await completePendingWorkspacePackageUpgrade(invoice.providerReference!, refreshedBill.paidAt ?? now);
      return { status: "COMPLETED" as const, invoice: completed };
    }
    if (refreshedBill.state.toLowerCase() === "deleted" && !refreshedBill.paid) {
      return { status: "EXPIRED" as const, invoice: await markExpiredWorkspacePackagePayment({
        upgradeId: invoice.id, gatewayState: refreshedBill.state, reason: "Timed out; Billplz deleted the unpaid bill.", now
      }) };
    }
    await releaseWorkspacePackagePaymentReconciliationLease(invoice.id, `Billplz bill remained ${refreshedBill.state} after deletion request.`);
  } catch (error) {
    await releaseWorkspacePackagePaymentReconciliationLease(
      invoice.id,
      `Billplz deletion/status confirmation failed: ${error instanceof Error ? error.message.slice(0, 180) : "unknown error"}`
    );
  }
  return { status: "DEFERRED" as const };
}

export async function reconcileExpiredWorkspacePackagePayments(input: { now?: Date; batchSize?: number } = {}) {
  await ensurePendingWorkspacePackageUpgradeStore();
  const now = input.now ?? new Date();
  const rows = await queryMany<{ id: string }>(
    `SELECT id FROM "PendingWorkspacePackageUpgrade"
     WHERE status = 'PAYMENT_PROCESSING'
       AND COALESCE("paymentExpiresAt", "paymentStartedAt", "createdAt") +
           CASE WHEN "paymentExpiresAt" IS NULL THEN INTERVAL '${PAYMENT_PROCESSING_TIMEOUT_MINUTES} minutes' ELSE INTERVAL '0 minutes' END <= $1
       AND ("paymentReconciliationLeaseUntil" IS NULL OR "paymentReconciliationLeaseUntil" <= $1)
     ORDER BY "paymentExpiresAt" NULLS FIRST, "createdAt"
     LIMIT $2`,
    [now, input.batchSize ?? PAYMENT_RECONCILIATION_BATCH_SIZE]
  );
  const results = await Promise.all(rows.map((row) => reconcileWorkspacePackagePayment({ upgradeId: row.id, now, source: "scheduled" })));
  return {
    reconciledCount: results.filter((result) => result.status !== "SKIPPED").length,
    expiredCount: results.filter((result) => result.status === "EXPIRED").length,
    completedCount: results.filter((result) => result.status === "COMPLETED").length,
    deferredCount: results.filter((result) => result.status === "DEFERRED").length
  };
}

async function reconcileExpiredWorkspacePackagePaymentsForWorkspace(workspaceId: string) {
  const now = new Date();
  const rows = await queryMany<{ id: string }>(
    `SELECT id FROM "PendingWorkspacePackageUpgrade"
     WHERE "workspaceId" = $1 AND status = 'PAYMENT_PROCESSING'
       AND COALESCE("paymentExpiresAt", "paymentStartedAt", "createdAt") +
           CASE WHEN "paymentExpiresAt" IS NULL THEN INTERVAL '${PAYMENT_PROCESSING_TIMEOUT_MINUTES} minutes' ELSE INTERVAL '0 minutes' END <= $2`,
    [workspaceId, now]
  );
  for (const row of rows) {
    await reconcileWorkspacePackagePayment({ upgradeId: row.id, now, source: "preflight" });
  }
}

export function isWorkspacePackageUpgrade(currentPlan: string | null | undefined, targetPlan: string) {
  return getWorkspacePackageRank(targetPlan) > getWorkspacePackageRank(currentPlan);
}

export function getHigherWorkspacePackageKeys(currentPlan: string | null | undefined) {
  const currentRank = getWorkspacePackageRank(currentPlan);
  return publicPackageKeys.filter((packageKey) => WORKSPACE_PACKAGE_RANK[packageKey] > currentRank);
}

export function getLowerWorkspacePackageKeys(currentPlan: string | null | undefined) {
  const currentRank = getWorkspacePackageRank(currentPlan);
  return publicPackageKeys.filter((packageKey) => WORKSPACE_PACKAGE_RANK[packageKey] < currentRank);
}

export async function getWorkspacePackageDowngradeOptions(currentPlan: string | null | undefined) {
  return Promise.all(
    getLowerWorkspacePackageKeys(currentPlan).map(async (packageKey) => {
      const resolvedPackage = await getResolvedPublicPackageDefinition(packageKey);
      const basePackage = getPublicPackageDefinition(packageKey);
      return {
        key: packageKey,
        name: resolvedPackage.name,
        summary: resolvedPackage.summary,
        highlights: basePackage.highlights,
        priceAmount: resolvedPackage.priceAmount,
        monthlyPriceAmount: resolvedPackage.monthlyPriceAmount,
        yearlyDiscountPercentage: resolvedPackage.yearlyDiscountPercentage,
        currency: resolvedPackage.currency,
        billingPeriod: resolvedPackage.billingPeriod,
        pricing: resolvedPackage.pricing,
        selfServe: resolvedPackage.priceAmount !== null
      };
    })
  );
}

export async function getWorkspacePackageUpgradeOptions(currentPlan: string | null | undefined) {
  const packageKeys = getHigherWorkspacePackageKeys(currentPlan);
  const packages = await Promise.all(
    packageKeys.map(async (packageKey) => {
      const resolvedPackage = await getResolvedPublicPackageDefinition(packageKey);
      const basePackage = getPublicPackageDefinition(packageKey);
      return {
        key: packageKey,
        name: resolvedPackage.name,
        summary: resolvedPackage.summary,
        highlights: basePackage.highlights,
        priceAmount: resolvedPackage.priceAmount,
        monthlyPriceAmount: resolvedPackage.monthlyPriceAmount,
        yearlyDiscountPercentage: resolvedPackage.yearlyDiscountPercentage,
        currency: resolvedPackage.currency,
        billingPeriod: resolvedPackage.billingPeriod,
        pricing: resolvedPackage.pricing,
        selfServe: resolvedPackage.priceAmount !== null
      };
    })
  );

  return packages;
}

export async function listWorkspacePackageUpgradeInvoices(workspaceId: string) {
  await ensurePendingWorkspacePackageUpgradeStore();
  const invoices = await listPendingWorkspacePackageUpgradesByWorkspace(workspaceId);
  // Once paid, the checkout request is represented by the finalized Invoice
  // and must not appear as a second customer-facing invoice.
  return invoices.filter((invoice) => invoice.status !== UPGRADE_INVOICE_STATUS.PAID).map(buildInvoiceView);
}

export async function createWorkspacePackageUpgradeInvoice(input: {
  workspaceId: string;
  requestedByAgentId: string;
  targetPlan: string;
  billingPeriod: string;
}) {
  await ensurePendingWorkspacePackageUpgradeStore();
  await reconcileExpiredWorkspacePackagePaymentsForWorkspace(input.workspaceId);

  await transaction(async (client) => {
    const workspace = await findWorkspaceByIdForUpdate(input.workspaceId, client);
    const currentSubscription = await getCurrentSubscriptionOverview(input.workspaceId, client);

    if (!workspace) {
      throw new Error("Workspace not found.");
    }

    if (!currentSubscription) {
      throw new Error("Current subscription not found.");
    }

    const targetPackageKey = normalizeWorkspacePackageKey(input.targetPlan);
    const operationType = resolvePlanChangeOperation(workspace.plan, targetPackageKey);
    const billingPeriod = normalizePackageBillingPeriod(input.billingPeriod);
    const targetPackage = await getPayablePlanChangeTargetPackage(targetPackageKey, billingPeriod);
    const activePlanChanges = await listActivePendingWorkspacePackageUpgradesByWorkspaceForUpdate(workspace.id, client);
    const paymentProcessingPlanChange =
      activePlanChanges.find((planChange) => isPaymentProcessingStatus(planChange.status)) ?? null;
    const replaceablePlanChanges = activePlanChanges.filter((planChange) =>
      isReplaceablePlanChangeStatus(planChange.status)
    );
    const matchingPlanChange =
      replaceablePlanChanges.find((planChange) =>
        matchesPlanChangeSelection(planChange, targetPackageKey, operationType, billingPeriod)
      ) ?? null;

    if (paymentProcessingPlanChange) {
      throw new Error("PLAN_CHANGE_PAYMENT_IN_PROGRESS");
    }

    if (matchingPlanChange) {
      const stalePlanChanges = replaceablePlanChanges.filter(
        (planChange) => planChange.id !== matchingPlanChange.id
      );

      if (stalePlanChanges.length > 0) {
        await supersedePlanChanges({
          planChanges: stalePlanChanges,
          replacementReason: `Replaced by ${matchingPlanChange.invoiceNumber}`,
          replacedById: matchingPlanChange.id,
          executor: client
        });
      }

      return { invoiceNumber: null as string | null };
    }

    validatePlanChangeSelection({
      operationType,
      workspacePlan: workspace.plan,
      targetPlan: targetPackageKey,
      currentSubscription,
      now: new Date(),
      source: "plan-change"
    });

    if (activePlanChanges.length !== replaceablePlanChanges.length) {
      throw new Error("PLAN_CHANGE_ALREADY_IN_PROGRESS");
    }

    if (replaceablePlanChanges.length > 0) {
      await supersedePlanChanges({
        planChanges: replaceablePlanChanges,
        replacementReason: `Replaced by ${operationType.toLowerCase()} selection`,
        executor: client
      });
    }

    const invoiceNumber = buildInvoiceNumberForPlanChange(operationType);
    const replacedPlanChange = replaceablePlanChanges[0] ?? null;
    const createdPlanChange = await createPendingWorkspacePackageUpgrade({
      workspaceId: workspace.id,
      requestedByAgentId: input.requestedByAgentId,
      invoiceNumber,
      currentPlan: workspace.plan,
      targetPlan: targetPackageKey,
      operationType,
      billingPeriod,
      provider: null,
      status: UPGRADE_INVOICE_STATUS.ISSUED,
      amount: targetPackage.selectedAmount,
      currency: targetPackage.currency,
      replacesId: replacedPlanChange?.id ?? null,
      replacementReason: replacedPlanChange ? `Replaces ${replacedPlanChange.invoiceNumber}` : null,
      executor: client
    });

    if (replaceablePlanChanges.length > 0) {
      await supersedePlanChanges({
        planChanges: replaceablePlanChanges,
        replacementReason: `Replaced by ${invoiceNumber}`,
        replacedById: createdPlanChange?.id ?? null,
        executor: client
      });
    }

    await expireScheduledPlanChanges({
      workspaceId: workspace.id,
      replacementInvoiceId: createdPlanChange?.id ?? null,
      replacementInvoiceNumber: invoiceNumber,
      executor: client
    });

    return { invoiceNumber };
  });

  return {
    invoices: await listWorkspacePackageUpgradeInvoices(input.workspaceId)
  };
}

export async function beginWorkspacePackageUpgradeInvoicePayment(input: {
  workspaceId: string;
  upgradeId: string;
  requestedByName: string;
  requestedByEmail: string;
}) {
  await ensurePendingWorkspacePackageUpgradeStore();
  await reconcileExpiredWorkspacePackagePaymentsForWorkspace(input.workspaceId);

  const paymentContext = await transaction(async (client) => {
    const workspace = await findWorkspaceByIdForUpdate(input.workspaceId, client);
    const invoice = await findPendingWorkspacePackageUpgradeByIdForWorkspaceForUpdate(input.workspaceId, input.upgradeId, client);
    const currentSubscription = await getCurrentSubscriptionOverview(input.workspaceId, client);
    const activePlanChanges = await listActivePendingWorkspacePackageUpgradesByWorkspaceForUpdate(input.workspaceId, client);
    const activePlanChange = activePlanChanges[0] ?? null;

    if (!workspace) {
      throw new Error("Workspace not found.");
    }

    if (!invoice) {
      throw new Error("Upgrade invoice not found.");
    }

    if (activePlanChange && invoice.id !== activePlanChange.id) {
      throw new Error("INVOICE_SUPERSEDED");
    }

    if (invoice.status === UPGRADE_INVOICE_STATUS.PAID) {
      throw new Error("PAYMENT_ALREADY_PROCESSED");
    }

    if (invoice.status === UPGRADE_INVOICE_STATUS.CANCELLED) {
      throw new Error("INVOICE_CANCELLED");
    }

    if (invoice.status === UPGRADE_INVOICE_STATUS.SUPERSEDED) {
      throw new Error("INVOICE_SUPERSEDED");
    }

    if (isPaymentProcessingStatus(invoice.status)) {
      throw new Error("PLAN_CHANGE_PAYMENT_IN_PROGRESS");
    }

    if (!isPayablePlanChangeStatus(invoice.status)) {
      throw new Error("INVOICE_NOT_PAYABLE");
    }

    if (workspace.plan !== invoice.currentPlan) {
      throw new Error("Workspace package changed. Create a new package invoice.");
    }

    const targetPlan = normalizeWorkspacePackageKey(invoice.targetPlan);
    const operationType = (invoice.operationType ?? resolvePlanChangeOperation(workspace.plan, targetPlan)) as PlanChangeOperationType;
    validatePlanChangeSelection({
      operationType,
      workspacePlan: workspace.plan,
      targetPlan,
      currentSubscription,
      now: new Date(),
      source: "plan-change"
    });

    const selectedBillingPeriod = normalizeSelectedPlanChangeBillingPeriod(invoice.billingPeriod);
    const targetPackage = await getPayablePlanChangeTargetPackage(targetPlan, selectedBillingPeriod);
    return { workspace, invoice, targetPackage, operationType };
  });

  const billplzConfig = await getBillplzCheckoutConfig();
  const appBaseUrl = getAppBaseUrl();
  const bill = await createBillplzBill(billplzConfig, {
    name: input.requestedByName,
    email: input.requestedByEmail,
    amount: paymentContext.targetPackage.selectedAmount,
    description: `${paymentContext.targetPackage.name} ${paymentContext.targetPackage.selectedBillingPeriod.toLowerCase()} ${paymentContext.operationType.toLowerCase()} invoice ${paymentContext.invoice.invoiceNumber} for ${paymentContext.workspace.name}`,
    callbackUrl: `${appBaseUrl}/api/billing/billplz/package-upgrade/callback`,
    redirectUrl: `${appBaseUrl}/api/account/package-upgrade/complete`
  });

  await transaction(async (client) => {
    const invoice = await findPendingWorkspacePackageUpgradeByIdForWorkspaceForUpdate(input.workspaceId, input.upgradeId, client);
    const activePlanChanges = await listActivePendingWorkspacePackageUpgradesByWorkspaceForUpdate(input.workspaceId, client);
    const activePlanChange = activePlanChanges[0] ?? null;

    if (!invoice || invoice.id !== activePlanChange?.id || !isPayablePlanChangeStatus(invoice.status)) {
      throw new Error("INVOICE_NOT_PAYABLE");
    }

    const paymentStartedAt = new Date();
    await updatePendingWorkspacePackageUpgradeProvider({
      upgradeId: invoice.id,
      provider: "billplz",
      providerReference: bill.id,
      providerCheckoutUrl: bill.url,
      status: UPGRADE_INVOICE_STATUS.PAYMENT_PROCESSING,
      paymentStartedAt,
      paymentExpiresAt: getPaymentExpiresAt(paymentStartedAt),
      executor: client
    });
  });

  return {
    paymentUrl: bill.url
  };
}

export async function cancelWorkspacePackageUpgradeInvoice(input: {
  workspaceId: string;
  upgradeId: string;
}) {
  await ensurePendingWorkspacePackageUpgradeStore();

  const invoice = await findPendingWorkspacePackageUpgradeByIdForWorkspace(input.workspaceId, input.upgradeId);

  if (!invoice) {
    throw new Error("Upgrade invoice not found.");
  }

  if (invoice.status === UPGRADE_INVOICE_STATUS.PAID) {
    throw new Error("Paid upgrade invoices cannot be cancelled.");
  }

  if (invoice.status === UPGRADE_INVOICE_STATUS.CANCELLED) {
    return {
      invoices: await listWorkspacePackageUpgradeInvoices(input.workspaceId)
    };
  }

  if (!isOpenInvoiceStatus(invoice.status)) {
    throw new Error("This upgrade invoice can no longer be cancelled.");
  }

  await updatePendingWorkspacePackageUpgradeStatus({
    upgradeId: invoice.id,
    status: UPGRADE_INVOICE_STATUS.CANCELLED,
    cancelledAt: new Date(),
    completedAt: new Date()
  });

  return {
    invoices: await listWorkspacePackageUpgradeInvoices(input.workspaceId)
  };
}

export async function scheduleWorkspacePackageDowngrade(input: {
  workspaceId: string;
  requestedByAgentId: string;
  targetPlan: string;
  billingPeriod: string;
}) {
  await ensurePendingWorkspacePackageUpgradeStore();

  await transaction(async (client) => {
    const workspace = await findWorkspaceByIdForUpdate(input.workspaceId, client);
    const currentSubscription = await getCurrentSubscriptionOverview(input.workspaceId, client);

    if (!workspace || !currentSubscription) {
      throw new Error("Current subscription not found.");
    }

    const targetPlan = normalizeWorkspacePackageKey(input.targetPlan);
    const operationType = resolvePlanChangeOperation(workspace.plan, targetPlan);
    const billingPeriod = normalizePackageBillingPeriod(input.billingPeriod);

    if (operationType !== "DOWNGRADE") {
      validatePlanChangeSelection({
        operationType,
        workspacePlan: workspace.plan,
        targetPlan,
        currentSubscription,
        now: new Date(),
        source: "downgrade"
      });
      throw new Error("INVALID_DOWNGRADE_PLAN");
    }

    validatePlanChangeSelection({
      operationType,
      workspacePlan: workspace.plan,
      targetPlan,
      currentSubscription,
      now: new Date(),
      source: "downgrade"
    });

    const targetPackage = await getPayablePlanChangeTargetPackage(targetPlan, billingPeriod);
    const activePlanChanges = await listActivePendingWorkspacePackageUpgradesByWorkspaceForUpdate(workspace.id, client);
    const paymentProcessingPlanChange =
      activePlanChanges.find((planChange) => isPaymentProcessingStatus(planChange.status)) ?? null;
    const replaceablePlanChanges = activePlanChanges.filter((planChange) =>
      isReplaceablePlanChangeStatus(planChange.status)
    );
    const matchingPlanChange =
      replaceablePlanChanges.find((planChange) =>
        matchesPlanChangeSelection(planChange, targetPlan, operationType, billingPeriod)
      ) ?? null;

    if (paymentProcessingPlanChange) {
      throw new Error("PLAN_CHANGE_PAYMENT_IN_PROGRESS");
    }

    if (matchingPlanChange) {
      const stalePlanChanges = replaceablePlanChanges.filter(
        (planChange) => planChange.id !== matchingPlanChange.id
      );

      if (stalePlanChanges.length > 0) {
        await supersedePlanChanges({
          planChanges: stalePlanChanges,
          replacementReason: `Replaced by ${matchingPlanChange.invoiceNumber}`,
          replacedById: matchingPlanChange.id,
          executor: client
        });
      }

      return;
    }

    if (activePlanChanges.length !== replaceablePlanChanges.length) {
      throw new Error("PLAN_CHANGE_ALREADY_IN_PROGRESS");
    }

    if (replaceablePlanChanges.length > 0) {
      await supersedePlanChanges({
        planChanges: replaceablePlanChanges,
        replacementReason: `Replaced by ${operationType.toLowerCase()} selection`,
        executor: client
      });
    }

    const invoiceNumber = buildInvoiceNumberForPlanChange("DOWNGRADE");
    const replacedPlanChange = replaceablePlanChanges[0] ?? null;
    const createdPlanChange = await createPendingWorkspacePackageUpgrade({
      workspaceId: workspace.id,
      requestedByAgentId: input.requestedByAgentId,
      invoiceNumber,
      currentPlan: workspace.plan,
      targetPlan,
      operationType: "DOWNGRADE",
      billingPeriod,
      provider: null,
      status: UPGRADE_INVOICE_STATUS.ISSUED,
      amount: targetPackage.selectedAmount,
      currency: targetPackage.currency,
      replacesId: replacedPlanChange?.id ?? null,
      replacementReason: replacedPlanChange ? `Replaces ${replacedPlanChange.invoiceNumber}` : null,
      executor: client
    });

    if (replaceablePlanChanges.length > 0) {
      await supersedePlanChanges({
        planChanges: replaceablePlanChanges,
        replacementReason: `Replaced by ${invoiceNumber}`,
        replacedById: createdPlanChange?.id ?? null,
        executor: client
      });
    }
  });

  return {
    invoices: await listWorkspacePackageUpgradeInvoices(input.workspaceId)
  };
}

export async function applyScheduledWorkspaceDowngrades() {
  await ensurePendingWorkspacePackageUpgradeStore();
  const scheduled = await queryMany<{ id: string; workspaceId: string }>(
    `SELECT u.id, u."workspaceId"
     FROM "PendingWorkspacePackageUpgrade" u
     INNER JOIN "WorkspacePackageSubscription" s ON s."workspaceId" = u."workspaceId"
     WHERE u.status = 'SCHEDULED'
       AND s.status = 'ACTIVE'
       AND s."endedAt" IS NULL
       AND s."nextBillingAt" IS NOT NULL
       AND s."nextBillingAt" <= NOW()`
  );

  for (const row of scheduled) {
    const invoiceId = await transaction(async (client) => {
      const change = await findPendingWorkspacePackageUpgradeByIdForWorkspace(row.workspaceId, row.id);
      const workspace = await findWorkspaceByIdForUpdate(row.workspaceId, client);
      const currentSubscription = await findCurrentWorkspacePackageSubscriptionForUpdate(row.workspaceId, client);
      if (!change || !workspace || !currentSubscription || change.status !== "SCHEDULED") {
        return null;
      }
      const selectedBillingPeriod = normalizeSelectedPlanChangeBillingPeriod(change.billingPeriod);
      const targetPackage = await getPayablePlanChangeTargetPackage(
        normalizeWorkspacePackageKey(change.targetPlan),
        selectedBillingPeriod
      );
      const changedAt = currentSubscription.nextBillingAt ?? new Date();
      await endWorkspacePackageSubscription({
        subscriptionId: currentSubscription.id,
        status: SubscriptionStatus.CANCELLED,
        endedAt: changedAt,
        executor: client
      });
      await updateWorkspacePlan(workspace.id, change.targetPlan, client);
      const newSubscription = await createWorkspacePackageSubscription({
        workspaceId: workspace.id,
        packageCode: targetPackage.code,
        packageName: targetPackage.name,
        packageDescription: targetPackage.summary,
        packagePriceAmount: targetPackage.monthlyPriceAmount,
        packageCurrency: targetPackage.currency,
        packageBillingPeriod: targetPackage.billingPeriod,
        subscriptionPriceAmount: targetPackage.selectedAmount,
        subscriptionBillingPeriod: targetPackage.selectedBillingPeriod,
        subscriptionStatus: SubscriptionStatus.ACTIVE,
        subscriptionNextBillingAt: getNextBillingAt(targetPackage.selectedBillingPeriod),
        executor: client
      });
      await updatePendingWorkspacePackageUpgradeStatus({
        upgradeId: change.id,
        status: "COMPLETED",
        completedAt: changedAt,
        executor: client
      });
      const manager = await queryOne<{ id: string; name: string; email: string }>(
        `SELECT id, name, email
         FROM "Agent"
         WHERE "workspaceId" = $1
           AND role IN ('OWNER', 'ADMIN')
         ORDER BY CASE WHEN role = 'OWNER' THEN 0 ELSE 1 END, "createdAt" ASC
         LIMIT 1`,
        [workspace.id],
        client
      );
      if (!manager) {
        return null;
      }
      const invoice = await createPaidInvoice(
        {
          workspaceId: workspace.id,
          subscriptionId: newSubscription.id,
          packageId: targetPackage.code,
          customerName: manager.name,
          customerEmail: manager.email,
          packageName: targetPackage.name,
          amount: 0,
          currency: targetPackage.currency ?? "MYR",
          subscriptionStartDate: changedAt,
          subscriptionEndDate: getNextBillingAt(targetPackage.selectedBillingPeriod),
          transactionType: "DOWNGRADE",
          providerReference: buildInvoiceNumberForChange("DWN"),
          executor: client
        }
      );
      return invoice.id;
    });

    if (invoiceId) {
      await sendInvoiceIssuedEmail(invoiceId).catch((error) => {
        console.error("[billing] unable to send downgrade invoice email", error);
      });
      await finalizeInvoiceDocumentAndEmail(invoiceId).catch((error) => {
        console.error("Failed to finalize downgrade invoice", error);
      });
    }
  }

  return { appliedDowngradeCount: scheduled.length };
}

function buildInvoiceNumberForChange(prefix: string) {
  const date = new Date();
  const stamp = `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(
    date.getUTCDate()
  ).padStart(2, "0")}`;
  return `${prefix}-${stamp}-${randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase()}`;
}

async function completePendingWorkspacePackageUpgrade(providerReference: string, paidAt: Date | null) {
  await ensurePendingWorkspacePackageUpgradeStore();

  const completion = await transaction(async (client) => {
    const invoice = await findPendingWorkspacePackageUpgradeByProviderReferenceForUpdate(providerReference, client);

    if (!invoice) {
      throw new Error("Upgrade invoice not found.");
    }

    if (invoice.status === UPGRADE_INVOICE_STATUS.PAID) {
      return { upgrade: invoice, invoiceId: null as string | null };
    }

    if (invoice.status === UPGRADE_INVOICE_STATUS.CANCELLED) {
      throw new Error("INVOICE_CANCELLED");
    }

    if (invoice.status === UPGRADE_INVOICE_STATUS.SUPERSEDED) {
      throw new Error("INVOICE_SUPERSEDED");
    }

    if (invoice.status === UPGRADE_INVOICE_STATUS.PAYMENT_REVIEW_REQUIRED) {
      return { upgrade: invoice, invoiceId: null as string | null };
    }

    const isLateExpiredPayment = invoice.status === UPGRADE_INVOICE_STATUS.PAYMENT_EXPIRED;
    if (!isOpenInvoiceStatus(invoice.status) && !isPaymentProcessingStatus(invoice.status) && !isLateExpiredPayment) {
      throw new Error("INVOICE_NOT_PAYABLE");
    }

    const workspace = await findWorkspaceByIdForUpdate(invoice.workspaceId, client);

    if (!workspace) {
      throw new Error("Workspace not found.");
    }

    const activePlanChanges = await listActivePendingWorkspacePackageUpgradesByWorkspaceForUpdate(workspace.id, client);
    const activePlanChange = activePlanChanges[0] ?? null;
    if (invoice.id !== activePlanChange?.id) {
      if (isLateExpiredPayment) {
        const review = await updatePendingWorkspacePackageUpgradeStatus({
          upgradeId: invoice.id,
          status: UPGRADE_INVOICE_STATUS.PAYMENT_REVIEW_REQUIRED,
          paymentReconciledAt: paidAt ?? new Date(),
          paymentGatewayState: "paid",
          paymentReconciliationReason: "Late confirmed payment conflicts with a newer active plan change; manual review required.",
          clearPaymentReconciliationLease: true,
          executor: client
        });
        await recordPaymentReconciliationActivity({
          upgradeId: invoice.id,
          action: "LATE_PAYMENT_REVIEW_REQUIRED",
          reason: "Late confirmed payment conflicts with a newer active plan change.",
          gatewayState: "paid",
          executor: client
        });
        return { upgrade: review, invoiceId: null as string | null };
      }
      throw new Error("INVOICE_SUPERSEDED");
    }

    if (workspace.plan !== invoice.currentPlan) {
      if (isLateExpiredPayment) {
        const review = await updatePendingWorkspacePackageUpgradeStatus({
          upgradeId: invoice.id,
          status: UPGRADE_INVOICE_STATUS.PAYMENT_REVIEW_REQUIRED,
          paymentReconciledAt: paidAt ?? new Date(),
          paymentGatewayState: "paid",
          paymentReconciliationReason: "Late confirmed payment no longer matches the workspace plan; manual review required.",
          clearPaymentReconciliationLease: true,
          executor: client
        });
        await recordPaymentReconciliationActivity({
          upgradeId: invoice.id,
          action: "LATE_PAYMENT_REVIEW_REQUIRED",
          reason: "Late confirmed payment no longer matches the workspace plan.",
          gatewayState: "paid",
          executor: client
        });
        return { upgrade: review, invoiceId: null as string | null };
      }
      throw new Error("Workspace package changed before this invoice was paid.");
    }

    const currentSubscription = await findCurrentWorkspacePackageSubscriptionForUpdate(workspace.id, client);

    if (!currentSubscription) {
      throw new Error("Current workspace package subscription not found.");
    }

    const targetPlan = normalizeWorkspacePackageKey(invoice.targetPlan);
    const operationType = (invoice.operationType ?? resolvePlanChangeOperation(workspace.plan, targetPlan)) as PlanChangeOperationType;
    const currentExpiryDate =
      currentSubscription.status === SubscriptionStatus.TRIAL
        ? currentSubscription.trialEndsAt
        : currentSubscription.nextBillingAt ?? currentSubscription.endedAt;
    validatePlanChangeSelection({
      operationType,
      workspacePlan: workspace.plan,
      targetPlan,
      currentSubscription: {
        ...currentSubscription,
        subscribedPrice: currentSubscription.subscribedPrice === null ? null : Number(currentSubscription.subscribedPrice),
        isExpired:
          currentSubscription.status === SubscriptionStatus.EXPIRED ||
          Boolean(currentExpiryDate && currentExpiryDate.getTime() <= Date.now()),
        expiryDate: currentExpiryDate
      },
      now: new Date(),
      source: "plan-change"
    });

    const selectedBillingPeriod = normalizeSelectedPlanChangeBillingPeriod(invoice.billingPeriod);
    const targetPackage = await getPayablePlanChangeTargetPackage(targetPlan, selectedBillingPeriod);

    if (
      Number(invoice.amount ?? 0) !== targetPackage.selectedAmount ||
      (invoice.currency ?? "MYR") !== (targetPackage.currency ?? "MYR")
    ) {
      throw new Error("Invoice amount no longer matches the selected package.");
    }

    const completedAt = paidAt ?? new Date();
    await endWorkspacePackageSubscription({
      subscriptionId: currentSubscription.id,
      status: SubscriptionStatus.CANCELLED,
      endedAt: completedAt,
      executor: client
    });

    const nextBillingAt = getNextBillingAt(targetPackage.selectedBillingPeriod);
    await updateWorkspacePlan(workspace.id, targetPlan, client);
    const subscription = await createWorkspacePackageSubscription({
      workspaceId: workspace.id,
      packageCode: targetPackage.code,
      packageName: targetPackage.name,
      packageDescription: targetPackage.summary,
      packagePriceAmount: targetPackage.monthlyPriceAmount,
      packageCurrency: targetPackage.currency,
      packageBillingPeriod: targetPackage.billingPeriod,
      subscriptionPriceAmount: targetPackage.selectedAmount,
      subscriptionBillingPeriod: targetPackage.selectedBillingPeriod,
      subscriptionStatus: SubscriptionStatus.ACTIVE,
      subscriptionNextBillingAt: nextBillingAt,
      executor: client
    });

    if (!subscription) {
      throw new Error("Unable to create upgraded workspace package subscription.");
    }

    const requestedBy = await queryOne<{ name: string; email: string }>(
      `SELECT name, email FROM "Agent" WHERE id = $1 LIMIT 1`,
      [invoice.requestedByAgentId],
      client
    );
    const paidInvoice = await createPaidInvoice({
      workspaceId: workspace.id,
      subscriptionId: subscription.id,
      packageId: subscription.packageId,
      customerName: requestedBy?.name ?? workspace.name,
      customerEmail: requestedBy?.email ?? "",
      packageName: targetPackage.name,
      amount: targetPackage.selectedAmount,
      currency: targetPackage.currency ?? "MYR",
      transactionType: operationType === "RENEWAL"
        ? currentSubscription.status === SubscriptionStatus.TRIAL
          ? "NEW_SUBSCRIPTION"
          : "RENEWAL"
        : operationType,
      subscriptionStartDate: subscription.startedAt,
      subscriptionEndDate: nextBillingAt,
      paymentDate: completedAt,
      providerReference,
      executor: client
    });
    await recordWorkspacePayment({
      workspaceId: workspace.id,
      subscriptionId: subscription.id,
      invoiceId: paidInvoice.id,
      transactionId: providerReference,
      amount: targetPackage.selectedAmount,
      currency: targetPackage.currency ?? "MYR",
      provider: "billplz",
      providerReference,
      paymentMethod: "Billplz",
      receiptNumber: paidInvoice.receiptNumber,
      receiptIssuedAt: paidInvoice.receiptIssuedAt,
      status: PaymentStatus.PAID,
      paidAt: completedAt,
      executor: client
    });
    const updatedUpgrade = await updatePendingWorkspacePackageUpgradeStatus({
      upgradeId: invoice.id,
      status: UPGRADE_INVOICE_STATUS.PAID,
      paidAt: completedAt,
      completedAt,
      receiptNumber: paidInvoice.receiptNumber,
      receiptIssuedAt: paidInvoice.receiptIssuedAt,
      paymentReconciledAt: completedAt,
      paymentGatewayState: "paid",
      paymentReconciliationReason: "Billplz confirmed payment.",
      clearPaymentReconciliationLease: true,
      executor: client
    });
    return { upgrade: updatedUpgrade, invoiceId: paidInvoice.id };
  });

  if (completion.invoiceId) {
    await sendInvoiceIssuedEmail(completion.invoiceId).catch((error) => {
      console.error("[billing] unable to send upgrade invoice email", error);
    });
    await finalizeInvoiceDocumentAndEmail(completion.invoiceId).catch((error) => {
      console.error("[billing] unable to finalize upgrade invoice", error);
    });
  }

  return completion.upgrade;
}

export async function finalizeWorkspacePackageUpgradeFromRedirect(params: Record<string, string>) {
  await ensurePendingWorkspacePackageUpgradeStore();

  const config = await getBillplzCheckoutConfig();

  if (!verifyBillplzRedirectSignature(params, config.xSignatureKey)) {
    throw new Error("Invalid Billplz redirect signature.");
  }

  const billId = params["billplz[id]"] ?? "";
  const paid = params["billplz[paid]"] === "true";
  const paidAt = params["billplz[paid_at]"] ? new Date(params["billplz[paid_at]"]) : null;

  if (!billId) {
    throw new Error("Missing Billplz bill id.");
  }

  if (!paid) {
    return {
      status: "FAILED" as const,
      pendingUpgrade: await markPendingWorkspacePackageUpgradePaymentFailed(billId)
    };
  }

  return {
    status: "COMPLETED" as const,
    pendingUpgrade: await completePendingWorkspacePackageUpgrade(billId, paidAt)
  };
}

export async function finalizeWorkspacePackageUpgradeFromCallback(params: Record<string, string>) {
  await ensurePendingWorkspacePackageUpgradeStore();

  const config = await getBillplzCheckoutConfig();

  if (!verifyBillplzCallbackSignature(params, config.xSignatureKey)) {
    throw new Error("Invalid Billplz callback signature.");
  }

  if (!params.id) {
    throw new Error("Missing Billplz bill id.");
  }

  if (params.paid !== "true") {
    return markPendingWorkspacePackageUpgradePaymentFailed(params.id);
  }

  const paidAt = params.paid_at ? new Date(params.paid_at) : new Date();
  return completePendingWorkspacePackageUpgrade(params.id, paidAt);
}
