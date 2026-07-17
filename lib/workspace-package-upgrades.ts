import { randomUUID } from "node:crypto";
import { getAppBaseUrl } from "@/lib/app-url";
import { BillingPeriod, PaymentStatus, SubscriptionStatus, normalizeWorkspacePackageKey, recordWorkspacePayment } from "@/lib/billing";
import { createBillplzBill, verifyBillplzCallbackSignature, verifyBillplzRedirectSignature } from "@/lib/billplz";
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
  findWorkspaceById,
  findWorkspaceByIdForUpdate,
  listActivePendingWorkspacePackageUpgradesByWorkspaceForUpdate,
  listPendingWorkspacePackageUpgradesByWorkspace,
  updatePendingWorkspacePackageUpgradeProvider,
  updatePendingWorkspacePackageUpgradeStatus,
  updateWorkspacePlan
} from "@/lib/db-auth";
import { queryMany, queryOne, transaction } from "@/lib/db";
import { getPackageChargeAmount, normalizePackageBillingPeriod, PACKAGE_BILLING_PERIOD, type PackageBillingPeriod } from "@/lib/package-pricing";
import { getPlatformConfig } from "@/lib/platform-config";
import { getPlatformPackageSettings, getResolvedPublicPackageDefinition } from "@/lib/platform-packages";
import { getPublicPackageDefinition, publicPackageKeys, type PublicPackageKey } from "@/lib/public-packages";
import {
  createPaidInvoice,
  finalizeInvoiceDocumentAndEmail,
  sendInvoiceIssuedEmail,
  sendInvoiceIssuedEmailFromSnapshot
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
  PAID: "PAID",
  CANCELLED: "CANCELLED",
  SUPERSEDED: "SUPERSEDED",
  EXPIRED: "EXPIRED",
  PAYMENT_FAILED: "PAYMENT_FAILED"
} as const;

type UpgradeInvoiceStatus = (typeof UPGRADE_INVOICE_STATUS)[keyof typeof UPGRADE_INVOICE_STATUS];
type PlanChangeOperationType = "UPGRADE" | "RENEWAL" | "DOWNGRADE";

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
      executor: client
    });
  });
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
  return invoices.map(buildInvoiceView);
}

export async function createWorkspacePackageUpgradeInvoice(input: {
  workspaceId: string;
  requestedByAgentId: string;
  targetPlan: string;
  billingPeriod: string;
}) {
  await ensurePendingWorkspacePackageUpgradeStore();

  const created = await transaction(async (client) => {
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

  if (created.invoiceNumber) {
    const [workspace, requestedBy, createdInvoice] = await Promise.all([
      findWorkspaceById(input.workspaceId),
      queryOne<{ name: string; email: string }>(
        `SELECT name, email FROM "Agent" WHERE id = $1 LIMIT 1`,
        [input.requestedByAgentId]
      ),
      queryOne<{ targetPlan: string; amount: string | null; currency: string | null; billingPeriod: string | null }>(
        `SELECT "targetPlan", amount, currency, "billingPeriod"
         FROM "PendingWorkspacePackageUpgrade"
         WHERE "invoiceNumber" = $1
         LIMIT 1`,
        [created.invoiceNumber]
      )
    ]);
    const targetPackage = createdInvoice
      ? await getPayablePlanChangeTargetPackage(
          normalizeWorkspacePackageKey(createdInvoice.targetPlan),
          normalizeSelectedPlanChangeBillingPeriod(createdInvoice.billingPeriod)
        )
      : null;
    if (requestedBy?.email && workspace && targetPackage && targetPackage.priceAmount !== null) {
      await sendInvoiceIssuedEmailFromSnapshot({
        invoiceNo: created.invoiceNumber,
        orderNo: created.invoiceNumber,
        workspaceId: workspace.id,
        customerName: requestedBy.name,
        customerEmail: requestedBy.email,
        packageName: targetPackage.name,
        amount: targetPackage.selectedAmount,
        currency: targetPackage.currency ?? "MYR",
        billingPeriod: targetPackage.selectedBillingPeriod,
        issueDate: new Date(),
        dueDate: addDays(new Date(), 7),
        status: "OPEN",
        companyInformation: null,
        taxInformation: null
      }).catch((error) => {
        console.error("[billing] unable to send issued package invoice email", error);
      });
    }
  }

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

    if (invoice.id !== activePlanChange?.id) {
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

    await updatePendingWorkspacePackageUpgradeProvider({
      upgradeId: invoice.id,
      provider: "billplz",
      providerReference: bill.id,
      providerCheckoutUrl: bill.url,
      status: UPGRADE_INVOICE_STATUS.PAYMENT_PROCESSING,
      paymentStartedAt: new Date(),
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

    if (!isOpenInvoiceStatus(invoice.status) && !isPaymentProcessingStatus(invoice.status)) {
      throw new Error("INVOICE_NOT_PAYABLE");
    }

    const workspace = await findWorkspaceByIdForUpdate(invoice.workspaceId, client);

    if (!workspace) {
      throw new Error("Workspace not found.");
    }

    const activePlanChanges = await listActivePendingWorkspacePackageUpgradesByWorkspaceForUpdate(workspace.id, client);
    const activePlanChange = activePlanChanges[0] ?? null;
    if (invoice.id !== activePlanChange?.id) {
      throw new Error("INVOICE_SUPERSEDED");
    }

    if (workspace.plan !== invoice.currentPlan) {
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
