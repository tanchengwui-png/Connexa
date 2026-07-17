import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getAppBaseUrl } from "@/lib/app-url";
import {
  createEmptyBillingDetails,
  getBillingDetailsErrorMessage,
  normalizeBillingDetails,
  type BillingDetails,
  validateBillingDetails
} from "@/lib/billing-details";
import { createBillplzBill, verifyBillplzCallbackSignature, verifyBillplzRedirectSignature } from "@/lib/billplz";
import { normalizeWorkspacePackageKey, PaymentStatus, recordWorkspacePayment, SubscriptionStatus } from "@/lib/billing";
import { execute, queryMany, queryOne, transaction, type DbExecutor } from "@/lib/db";
import { AgentStatus } from "@/lib/db-types";
import { ensurePendingWorkspacePackageUpgradeStore } from "@/lib/db-auth";
import { renderEmailTemplate } from "@/lib/email-template";
import { sendEmail } from "@/lib/mail";
import { addMalaysiaDays, getMalaysiaDateKey } from "@/lib/malaysia-time";
import { getPlatformConfig, getPlatformSubscriptionConfig, getResolvedPlatformEmailConfig } from "@/lib/platform-config";
import { getResolvedPublicPackageDefinition } from "@/lib/platform-packages";

const INVOICE_UPLOAD_DIR = path.join(process.cwd(), "public", "uploads", "invoices");
const DOCUMENT_COMPANY_NAME = "Recurvos Connexa";

let billingManagementStoreReady = false;
let billingManagementStorePromise: Promise<void> | null = null;

type SubscriptionOverviewRow = {
  id: string;
  workspaceId: string;
  packageId: string;
  packageCode: string;
  packageName: string;
  status: string;
  subscribedPrice: string | null;
  currency: string | null;
  billingPeriod: string | null;
  startedAt: Date;
  trialStartedAt: Date | null;
  trialEndsAt: Date | null;
  endedAt: Date | null;
  nextBillingAt: Date | null;
  paidAt: Date | null;
  cancelledAt: Date | null;
  autoRenew: boolean;
};

type BillingProfileRow = {
  id: string;
  workspaceId: string;
  billingName: string;
  billingEmail: string;
  contactNumber: string;
  billingAddress1: string;
  billingAddress2: string | null;
  billingCity: string;
  billingState: string;
  billingPostcode: string;
  billingCountry: string;
  taxNumber: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type InvoiceRow = {
  id: string;
  invoiceNo: string;
  orderNo: string;
  workspaceId: string;
  subscriptionId: string | null;
  packageId: string | null;
  customerName: string;
  customerEmail: string;
  customerInformation: string | null;
  packageName: string;
  amount: string;
  currency: string;
  status: string;
  transactionType: string;
  subscriptionStartDate: Date;
  subscriptionEndDate: Date | null;
  paymentDate: Date | null;
  receiptNumber: string | null;
  receiptIssuedAt: Date | null;
  companyInformation: string | null;
  taxInformation: string | null;
  pdfPath: string | null;
  issueDate: Date;
  dueDate: Date | null;
  totalAmount: string | null;
  paidAmount: string | null;
  balanceAmount: string | null;
  invoicePdfPath: string | null;
  receiptPdfPath: string | null;
  paidAt: Date | null;
  provider: string | null;
  providerReference: string | null;
  providerCheckoutUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type ReceiptIssueResult = {
  receiptNumber: string;
  receiptIssuedAt: Date;
};

type BillingHistoryRow = {
  id: string;
  workspaceId: string;
  invoiceId: string | null;
  transactionType: string;
  description: string;
  amount: string;
  currency: string;
  trialStartDate: Date | null;
  trialEndDate: Date | null;
  createdAt: Date;
  invoiceNo: string | null;
  orderNo: string | null;
  pdfPath: string | null;
};

type InvoiceEmailSnapshot = {
  workspaceId?: string | null;
  invoiceNo: string;
  orderNo: string;
  customerName: string;
  customerEmail: string;
  packageName: string;
  amount: number;
  currency: string;
  issueDate: Date;
  dueDate: Date | null;
  status: string;
  billingPeriod?: string | null;
  customerInformation?: string | null;
  customerContactNumber?: string | null;
  customerAddress?: string | null;
  companyInformation?: string | null;
  taxInformation?: string | null;
};

type EmailLogRow = {
  id: string;
  workspaceId: string;
  subscriptionId: string | null;
  eventKey: string;
  emailType: string;
  recipientEmail: string;
  sentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type ExpiryReminderCandidateRow = {
  subscriptionId: string;
  workspaceId: string;
  workspaceName: string;
  packageCode: string;
  packageName: string;
  status: string;
  subscribedPrice: string | null;
  currency: string | null;
  billingPeriod: string | null;
  startedAt: Date;
  trialStartedAt: Date | null;
  trialEndsAt: Date | null;
  endedAt: Date | null;
  nextBillingAt: Date | null;
  autoRenew: boolean;
  managerId: string | null;
  managerName: string | null;
  managerEmail: string | null;
  managerStatus: string | null;
};

type ExpiryReminderKind = "trial" | "plan";

type ExpiryReminderCandidate = {
  subscriptionId: string;
  workspaceId: string;
  workspaceName: string;
  packageCode: string;
  packageName: string;
  recipientName: string;
  recipientEmail: string;
  kind: ExpiryReminderKind;
  periodEnd: Date;
  startedAt: Date | null;
  trialStartedAt: Date | null;
  trialEndsAt: Date | null;
  billingPeriod: string | null;
  subscribedPrice: number | null;
  currency: string | null;
  autoRenew: boolean;
};

type ExpiryReminderEmailPayload = {
  candidate: ExpiryReminderCandidate;
  appUrl: string;
  benefits: string[];
  priceLabel: string | null;
  cycleLabel: string | null;
  startDateLabel: string | null;
  renewalLabel: string | null;
  actionLabel: string;
  introLine: string;
  panelTitle: string;
  summaryLines: string[];
};

type ReminderPackageDefinition = {
  code: string;
  name: string;
  priceAmount: number | null;
  currency: string | null;
  billingPeriod: string | null;
  features: string[];
  highlights: string[];
};

type DocumentParty = {
  name: string | null;
  registrationNo: string | null;
  email: string | null;
  contactNumber: string | null;
  addressLines: string[];
};

type DocumentItem = {
  description: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
};

type DocumentAmountRow = {
  label: string;
  amount?: number;
  text?: string;
  highlight?: boolean;
};

export type InvoiceDocumentContext = {
  type: "invoice" | "receipt";
  title: "INVOICE" | "RECEIPT";
  invoiceNo: string;
  receiptNo: string | null;
  orderNo: string;
  issueDate: Date;
  dueDate: Date | null;
  paymentDate: Date | null;
  paymentMethod: string | null;
  currency: string;
  status: string;
  company: DocumentParty;
  customer: DocumentParty;
  items: DocumentItem[];
  summaryRows: DocumentAmountRow[];
  metaRows: Array<{ label: string; value: string }>;
  notes: string[];
};

function createRecordId() {
  return randomUUID().replace(/-/g, "");
}

function buildReference(prefix: string) {
  const now = new Date();
  const date = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(
    now.getUTCDate()
  ).padStart(2, "0")}`;
  return `${prefix}-${date}-${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

export async function issueReceiptNumber(input: {
  paidAt?: Date | null;
  executor: DbExecutor;
}): Promise<ReceiptIssueResult> {
  const issuedAt = input.paidAt ?? new Date();
  const year = issuedAt.getUTCFullYear();

  await execute(
    `INSERT INTO "ReceiptNumberSequence" (year, "lastValue", "createdAt", "updatedAt")
     VALUES ($1, 0, NOW(), NOW())
     ON CONFLICT (year) DO NOTHING`,
    [year],
    input.executor
  );

  const row = await queryOne<{ lastValue: number }>(
    `SELECT "lastValue"
     FROM "ReceiptNumberSequence"
     WHERE year = $1
     FOR UPDATE`,
    [year],
    input.executor
  );

  if (!row) {
    throw new Error("Unable to lock receipt number sequence.");
  }

  const nextValue = Number(row.lastValue) + 1;
  await execute(
    `UPDATE "ReceiptNumberSequence"
     SET "lastValue" = $2, "updatedAt" = NOW()
     WHERE year = $1`,
    [year, nextValue],
    input.executor
  );

  return {
    receiptNumber: formatReceiptNumber(year, nextValue),
    receiptIssuedAt: issuedAt
  };
}

export function formatReceiptNumber(year: number, value: number) {
  return `RCP-${year}-${String(value).padStart(6, "0")}`;
}

function addDays(value: Date, days: number) {
  return new Date(value.getTime() + days * 24 * 60 * 60 * 1000);
}

function getNextBillingAtFromBase(base: Date, billingPeriod: string | null) {
  const next = new Date(base);

  if (billingPeriod === "YEARLY") {
    next.setUTCFullYear(next.getUTCFullYear() + 1);
    return next;
  }

  if (billingPeriod === "MONTHLY") {
    next.setUTCMonth(next.getUTCMonth() + 1);
    return next;
  }

  return null;
}

function toNumber(value: string | number | null | undefined) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
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

async function runBillingManagementStoreMigrations(executor?: DbExecutor) {
  await execute(
    `ALTER TABLE "WorkspacePackageSubscription" ADD COLUMN IF NOT EXISTS "trialStartedAt" TIMESTAMP(3)`,
    [],
    executor
  );
  await execute(
    `ALTER TABLE "WorkspacePackageSubscription" ADD COLUMN IF NOT EXISTS "trialEndsAt" TIMESTAMP(3)`,
    [],
    executor
  );
  await execute(
    `ALTER TABLE "WorkspacePackageSubscription" ADD COLUMN IF NOT EXISTS "autoRenew" BOOLEAN NOT NULL DEFAULT TRUE`,
    [],
    executor
  );
  await execute(
    `CREATE TABLE IF NOT EXISTS "WorkspaceBillingProfile" (
       id TEXT PRIMARY KEY,
       "workspaceId" TEXT NOT NULL UNIQUE REFERENCES "Workspace"(id) ON DELETE CASCADE,
       "billingName" TEXT NOT NULL,
       "billingEmail" TEXT NOT NULL,
       "contactNumber" TEXT NOT NULL,
       "billingAddress1" TEXT NOT NULL DEFAULT '',
       "billingAddress2" TEXT,
       "billingCity" TEXT NOT NULL DEFAULT '',
       "billingState" TEXT NOT NULL DEFAULT '',
       "billingPostcode" TEXT NOT NULL DEFAULT '',
       "billingCountry" TEXT NOT NULL DEFAULT 'Malaysia',
       "taxNumber" TEXT,
       "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
       "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
     )`,
    [],
    executor
  );
  await execute(
    `CREATE TABLE IF NOT EXISTS "Invoice" (
       id TEXT PRIMARY KEY,
       "invoiceNo" TEXT NOT NULL UNIQUE,
       "orderNo" TEXT NOT NULL UNIQUE,
       "workspaceId" TEXT NOT NULL REFERENCES "Workspace"(id) ON DELETE CASCADE,
       "subscriptionId" TEXT REFERENCES "WorkspacePackageSubscription"(id) ON DELETE SET NULL,
       "packageId" TEXT,
       "customerName" TEXT NOT NULL,
       "customerEmail" TEXT NOT NULL,
       "customerInformation" TEXT,
       "packageName" TEXT NOT NULL,
       amount DECIMAL(10, 2) NOT NULL,
       currency TEXT NOT NULL DEFAULT 'MYR',
       status TEXT NOT NULL DEFAULT 'PAID',
       "transactionType" TEXT NOT NULL,
       "subscriptionStartDate" TIMESTAMP(3) NOT NULL,
       "subscriptionEndDate" TIMESTAMP(3),
       "paymentDate" TIMESTAMP(3),
       "companyInformation" TEXT,
       "taxInformation" TEXT,
       "pdfPath" TEXT,
       "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
       "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
     )`,
    [],
    executor
  );
  await execute(
    `CREATE TABLE IF NOT EXISTS "BillingHistory" (
       id TEXT PRIMARY KEY,
       "workspaceId" TEXT NOT NULL REFERENCES "Workspace"(id) ON DELETE CASCADE,
       "invoiceId" TEXT REFERENCES "Invoice"(id) ON DELETE SET NULL,
       "transactionType" TEXT NOT NULL,
       description TEXT NOT NULL,
       amount DECIMAL(10, 2) NOT NULL,
       currency TEXT NOT NULL DEFAULT 'MYR',
       "trialStartDate" TIMESTAMP(3),
       "trialEndDate" TIMESTAMP(3),
       "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
     )`,
    [],
    executor
  );
  await execute(`ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "issueDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP`, [], executor);
  await execute(`ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "dueDate" TIMESTAMP(3)`, [], executor);
  await execute(`ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "totalAmount" DECIMAL(10, 2)`, [], executor);
  await execute(`ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "paidAmount" DECIMAL(10, 2)`, [], executor);
  await execute(`ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "balanceAmount" DECIMAL(10, 2)`, [], executor);
  await execute(`ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "invoicePdfPath" TEXT`, [], executor);
  await execute(`ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "receiptPdfPath" TEXT`, [], executor);
  await execute(`ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "paidAt" TIMESTAMP(3)`, [], executor);
  await execute(`ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "receiptNumber" TEXT`, [], executor);
  await execute(`ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "receiptIssuedAt" TIMESTAMP(3)`, [], executor);
  await execute(`ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS provider TEXT`, [], executor);
  await execute(`ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "providerReference" TEXT`, [], executor);
  await execute(`ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "providerCheckoutUrl" TEXT`, [], executor);
  await execute(`ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "customerInformation" TEXT`, [], executor);
  await execute(`ALTER TABLE "WorkspaceBillingProfile" ADD COLUMN IF NOT EXISTS "billingAddress1" TEXT NOT NULL DEFAULT ''`, [], executor);
  await execute(`ALTER TABLE "WorkspaceBillingProfile" ADD COLUMN IF NOT EXISTS "billingAddress2" TEXT`, [], executor);
  await execute(`ALTER TABLE "WorkspaceBillingProfile" ADD COLUMN IF NOT EXISTS "billingCity" TEXT NOT NULL DEFAULT ''`, [], executor);
  await execute(`ALTER TABLE "WorkspaceBillingProfile" ADD COLUMN IF NOT EXISTS "billingState" TEXT NOT NULL DEFAULT ''`, [], executor);
  await execute(`ALTER TABLE "WorkspaceBillingProfile" ADD COLUMN IF NOT EXISTS "billingPostcode" TEXT NOT NULL DEFAULT ''`, [], executor);
  await execute(
    `ALTER TABLE "WorkspaceBillingProfile" ADD COLUMN IF NOT EXISTS "billingCountry" TEXT NOT NULL DEFAULT 'Malaysia'`,
    [],
    executor
  );
  await execute(
    `UPDATE "Invoice"
     SET "totalAmount" = COALESCE("totalAmount", amount),
         "paidAmount" = COALESCE("paidAmount", CASE WHEN status = 'PAID' THEN amount ELSE 0 END),
         "balanceAmount" = COALESCE("balanceAmount", CASE WHEN status = 'PAID' THEN 0 ELSE amount END),
         "invoicePdfPath" = COALESCE("invoicePdfPath", "pdfPath"),
         "paidAt" = COALESCE("paidAt", "paymentDate"),
         "dueDate" = COALESCE("dueDate", "createdAt" + INTERVAL '7 days')`,
    [],
    executor
  );
  await execute(
    `CREATE INDEX IF NOT EXISTS "Invoice_workspaceId_createdAt_idx" ON "Invoice" ("workspaceId", "createdAt" DESC)`,
    [],
    executor
  );
  await execute(
    `CREATE UNIQUE INDEX IF NOT EXISTS "Invoice_receiptNumber_key" ON "Invoice" ("receiptNumber")`,
    [],
    executor
  );
  await execute(
    `CREATE INDEX IF NOT EXISTS "Invoice_receiptIssuedAt_idx" ON "Invoice" ("receiptIssuedAt")`,
    [],
    executor
  );
  await execute(
    `CREATE TABLE IF NOT EXISTS "ReceiptNumberSequence" (
       year INTEGER PRIMARY KEY,
       "lastValue" INTEGER NOT NULL DEFAULT 0,
       "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
       "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
     )`,
    [],
    executor
  );
  await execute(`ALTER TABLE "PaymentTransaction" ADD COLUMN IF NOT EXISTS "invoiceId" TEXT`, [], executor);
  await execute(`ALTER TABLE "PaymentTransaction" ADD COLUMN IF NOT EXISTS "transactionId" TEXT`, [], executor);
  await execute(`ALTER TABLE "PaymentTransaction" ADD COLUMN IF NOT EXISTS "paymentMethod" TEXT`, [], executor);
  await execute(`ALTER TABLE "PaymentTransaction" ADD COLUMN IF NOT EXISTS "receiptNumber" TEXT`, [], executor);
  await execute(`ALTER TABLE "PaymentTransaction" ADD COLUMN IF NOT EXISTS "receiptIssuedAt" TIMESTAMP(3)`, [], executor);
  await execute(`ALTER TABLE "PaymentTransaction" ADD COLUMN IF NOT EXISTS "failureReason" TEXT`, [], executor);
  await execute(`ALTER TABLE "PaymentTransaction" ADD COLUMN IF NOT EXISTS "gatewayResponseJson" TEXT`, [], executor);
  await execute(
    `CREATE UNIQUE INDEX IF NOT EXISTS "PaymentTransaction_receiptNumber_key"
     ON "PaymentTransaction" ("receiptNumber")`,
    [],
    executor
  );
  await execute(
    `CREATE UNIQUE INDEX IF NOT EXISTS "PaymentTransaction_transactionId_key"
     ON "PaymentTransaction" ("transactionId")`,
    [],
    executor
  );
  await execute(
    `CREATE INDEX IF NOT EXISTS "PaymentTransaction_invoiceId_idx" ON "PaymentTransaction" ("invoiceId")`,
    [],
    executor
  );
  await execute(
    `CREATE INDEX IF NOT EXISTS "BillingHistory_workspaceId_createdAt_idx" ON "BillingHistory" ("workspaceId", "createdAt" DESC)`,
    [],
    executor
  );
  await execute(
    `CREATE TABLE IF NOT EXISTS "EmailLog" (
       id TEXT PRIMARY KEY,
       "workspaceId" TEXT NOT NULL REFERENCES "Workspace"(id) ON DELETE CASCADE,
       "subscriptionId" TEXT REFERENCES "WorkspacePackageSubscription"(id) ON DELETE CASCADE,
       "eventKey" TEXT NOT NULL UNIQUE,
       "emailType" TEXT NOT NULL,
       "recipientEmail" TEXT NOT NULL,
       "sentAt" TIMESTAMP(3),
       "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
       "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
     )`,
    [],
    executor
  );
  await execute(`ALTER TABLE "EmailLog" ADD COLUMN IF NOT EXISTS "workspaceId" TEXT`, [], executor);
  await execute(`ALTER TABLE "EmailLog" ADD COLUMN IF NOT EXISTS "subscriptionId" TEXT`, [], executor);
  await execute(`ALTER TABLE "EmailLog" ADD COLUMN IF NOT EXISTS "eventKey" TEXT`, [], executor);
  await execute(`ALTER TABLE "EmailLog" ADD COLUMN IF NOT EXISTS "emailType" TEXT`, [], executor);
  await execute(`ALTER TABLE "EmailLog" ADD COLUMN IF NOT EXISTS "recipientEmail" TEXT`, [], executor);
  await execute(`ALTER TABLE "EmailLog" ADD COLUMN IF NOT EXISTS "sentAt" TIMESTAMP(3)`, [], executor);
  await execute(`ALTER TABLE "EmailLog" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP`, [], executor);
  await execute(`ALTER TABLE "EmailLog" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP`, [], executor);
  await execute(`ALTER TABLE "EmailLog" ALTER COLUMN "createdAt" SET DEFAULT CURRENT_TIMESTAMP`, [], executor);
  await execute(`ALTER TABLE "EmailLog" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP`, [], executor);
  await execute(`CREATE UNIQUE INDEX IF NOT EXISTS "EmailLog_eventKey_key" ON "EmailLog" ("eventKey")`, [], executor);
  await execute(
    `CREATE INDEX IF NOT EXISTS "EmailLog_workspaceId_createdAt_idx" ON "EmailLog" ("workspaceId", "createdAt" DESC)`,
    [],
    executor
  );
}

export async function ensureBillingManagementStore(executor?: DbExecutor) {
  if (billingManagementStoreReady) {
    return;
  }

  if (executor) {
    await ensureBillingManagementStore();
    return;
  }

  if (!billingManagementStorePromise) {
    billingManagementStorePromise = runBillingManagementStoreMigrations()
      .then(() => {
        billingManagementStoreReady = true;
      })
      .catch((error) => {
        billingManagementStorePromise = null;
        throw error;
      });
  }

  await billingManagementStorePromise;
}

export async function getCurrentSubscriptionOverview(workspaceId: string, executor?: DbExecutor) {
  await ensureBillingManagementStore(executor);
  const row = await queryOne<SubscriptionOverviewRow>(
    `SELECT s.*, p.code AS "packageCode", p.name AS "packageName"
     FROM "WorkspacePackageSubscription" s
     INNER JOIN "Package" p ON p.id = s."packageId"
     WHERE s."workspaceId" = $1
     ORDER BY
       CASE WHEN s.status IN ('PENDING', 'TRIAL', 'ACTIVE', 'PAST_DUE') AND s."endedAt" IS NULL THEN 0 ELSE 1 END,
       s."startedAt" DESC
     LIMIT 1`,
    [workspaceId],
    executor
  );

  if (!row) {
    return null;
  }

  const expiryDate = row.status === "TRIAL" ? row.trialEndsAt : row.nextBillingAt ?? row.endedAt;
  const isExpired =
    row.status === "EXPIRED" ||
    ((row.status === "TRIAL" || row.status === "ACTIVE" || row.status === "PAST_DUE") &&
      Boolean(expiryDate && expiryDate.getTime() <= Date.now()));

  if (isExpired && row.status !== "EXPIRED") {
    await execute(
      `UPDATE "WorkspacePackageSubscription"
       SET status = 'EXPIRED', "endedAt" = COALESCE("endedAt", $2), "updatedAt" = NOW()
       WHERE id = $1`,
      [row.id, expiryDate ?? new Date()],
      executor
    );
    row.status = "EXPIRED";
    row.endedAt = row.endedAt ?? expiryDate ?? new Date();
  }

  return {
    ...row,
    subscribedPrice: row.subscribedPrice === null ? null : toNumber(row.subscribedPrice),
    isExpired,
    expiryDate
  };
}

export async function activateFreeTrialAfterVerification(agentId: string) {
  const config = await getPlatformSubscriptionConfig();

  const result = await transaction(async (client) => {
    await ensureBillingManagementStore(client);
    const agent = await queryOne<{ workspaceId: string; name: string; email: string }>(
      `SELECT "workspaceId", name, email FROM "Agent" WHERE id = $1 LIMIT 1 FOR UPDATE`,
      [agentId],
      client
    );
    if (!agent) {
      throw new Error("Account not found.");
    }

    const existingHistory = await queryOne<{ id: string }>(
      `SELECT id FROM "BillingHistory"
       WHERE "workspaceId" = $1 AND "transactionType" = 'FREE_TRIAL'
       LIMIT 1`,
      [agent.workspaceId],
      client
    );
    const subscription = await queryOne<SubscriptionOverviewRow>(
      `SELECT s.*, p.code AS "packageCode", p.name AS "packageName"
       FROM "WorkspacePackageSubscription" s
       INNER JOIN "Package" p ON p.id = s."packageId"
       WHERE s."workspaceId" = $1
       ORDER BY s."startedAt" DESC
       LIMIT 1
       FOR UPDATE`,
      [agent.workspaceId],
      client
    );
    if (!subscription) {
      throw new Error("Subscription not found.");
    }

    if (subscription.status !== "PENDING" && subscription.status !== "TRIAL") {
      return { workspaceId: agent.workspaceId, activated: false };
    }

    if (subscription.status === "TRIAL" && subscription.trialEndsAt && existingHistory) {
      return { workspaceId: agent.workspaceId, activated: false };
    }

    const trialStartedAt = new Date();
    const trialEndsAt = addDays(trialStartedAt, config.freeTrialDurationDays);
    await execute(
      `UPDATE "WorkspacePackageSubscription"
       SET status = 'TRIAL',
           "trialStartedAt" = $2,
           "trialEndsAt" = $3,
           "nextBillingAt" = $3,
           "autoRenew" = FALSE,
           "updatedAt" = NOW()
       WHERE id = $1`,
      [subscription.id, trialStartedAt, trialEndsAt],
      client
    );
    await execute(
      `UPDATE "Workspace" SET "trialEndsAt" = $2, "updatedAt" = NOW() WHERE id = $1`,
      [agent.workspaceId, trialEndsAt],
      client
    );

    if (!existingHistory) {
      await execute(
        `INSERT INTO "BillingHistory" (
           id, "workspaceId", "transactionType", description, amount, currency,
           "trialStartDate", "trialEndDate", "createdAt"
         ) VALUES ($1, $2, 'FREE_TRIAL', 'Free Trial Subscription', 0, 'MYR', $3, $4, NOW())`,
        [createRecordId(), agent.workspaceId, trialStartedAt, trialEndsAt],
        client
      );
    }

    const existingInvoice = await queryOne<{ id: string }>(
      `SELECT id
       FROM "Invoice"
       WHERE "workspaceId" = $1
         AND "subscriptionId" = $2
         AND "transactionType" = 'NEW_SUBSCRIPTION'
       LIMIT 1`,
      [agent.workspaceId, subscription.id],
      client
    );

    let trialInvoiceId: string | null = null;

    if (!existingInvoice) {
      const invoice = await createOpenInvoice({
        workspaceId: agent.workspaceId,
        subscriptionId: subscription.id,
        packageId: subscription.packageId,
        customerName: agent.name,
        customerEmail: agent.email,
        packageName: subscription.packageName,
        amount: toNumber(subscription.subscribedPrice),
        currency: subscription.currency ?? "MYR",
        transactionType: "NEW_SUBSCRIPTION",
        subscriptionStartDate: trialStartedAt,
        subscriptionEndDate: trialEndsAt,
        issueDate: trialStartedAt,
        dueDate: trialEndsAt,
        executor: client
      });
      trialInvoiceId = invoice.id;
    }

    return { workspaceId: agent.workspaceId, activated: true, trialInvoiceId };
  });

  if (result.trialInvoiceId) {
    void sendInvoiceIssuedEmail(result.trialInvoiceId).catch((error) => {
      console.error("[billing] unable to send free trial invoice email", error);
    });
  }

  return result;
}

export async function getBillingProfile(workspaceId: string, executor?: DbExecutor) {
  await ensureBillingManagementStore();
  return queryOne<BillingProfileRow>(
    `SELECT * FROM "WorkspaceBillingProfile" WHERE "workspaceId" = $1 LIMIT 1`,
    [workspaceId],
    executor
  );
}

export async function saveBillingProfile(input: {
  workspaceId: string;
  billingName: string;
  billingEmail: string;
  billingPhoneNumber: string;
  billingAddressLine1: string;
  billingAddressLine2?: string | null;
  billingCity: string;
  billingState: string;
  billingPostcode: string;
  billingCountry: string;
  billingTaxId?: string | null;
  executor?: DbExecutor;
}) {
  await ensureBillingManagementStore();
  const details = normalizeBillingDetails(input);
  const billingEmail = input.billingEmail.trim().toLowerCase();
  const validationError = getBillingDetailsErrorMessage(validateBillingDetails(details));

  if (validationError || !billingEmail) {
    throw new Error(validationError ?? "Billing email is required.");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(billingEmail)) {
    throw new Error("Enter a valid billing email.");
  }

  return queryOne<BillingProfileRow>(
    `INSERT INTO "WorkspaceBillingProfile" (
       id, "workspaceId", "billingName", "billingEmail", "contactNumber", "billingAddress1",
       "billingAddress2", "billingCity", "billingState", "billingPostcode", "billingCountry",
       "taxNumber", "createdAt", "updatedAt"
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
     ON CONFLICT ("workspaceId") DO UPDATE SET
       "billingName" = EXCLUDED."billingName",
       "billingEmail" = EXCLUDED."billingEmail",
       "contactNumber" = EXCLUDED."contactNumber",
       "billingAddress1" = EXCLUDED."billingAddress1",
       "billingAddress2" = EXCLUDED."billingAddress2",
       "billingCity" = EXCLUDED."billingCity",
       "billingState" = EXCLUDED."billingState",
       "billingPostcode" = EXCLUDED."billingPostcode",
       "billingCountry" = EXCLUDED."billingCountry",
       "taxNumber" = EXCLUDED."taxNumber",
       "updatedAt" = NOW()
     RETURNING *`,
    [
      createRecordId(),
      input.workspaceId,
      details.billingName,
      billingEmail,
      details.billingPhoneNumber,
      details.billingAddressLine1,
      details.billingAddressLine2 || null,
      details.billingCity,
      details.billingState,
      details.billingPostcode,
      details.billingCountry,
      details.billingTaxId || null
    ],
    input.executor
  );
}

export async function listBillingHistory(workspaceId: string, page = 1, pageSize = 10, sort = "desc") {
  await ensureBillingManagementStore();
  const safePage = Math.max(1, Math.floor(page));
  const safePageSize = Math.min(50, Math.max(1, Math.floor(pageSize)));
  const direction = sort === "asc" ? "ASC" : "DESC";
  const [rows, count] = await Promise.all([
    queryMany<BillingHistoryRow>(
      `SELECT h.*, i."invoiceNo", i."orderNo", i."pdfPath"
       FROM "BillingHistory" h
       LEFT JOIN "Invoice" i ON i.id = h."invoiceId"
       WHERE h."workspaceId" = $1
       ORDER BY h."createdAt" ${direction}
       LIMIT $2 OFFSET $3`,
      [workspaceId, safePageSize, (safePage - 1) * safePageSize]
    ),
    queryOne<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM "BillingHistory" WHERE "workspaceId" = $1`,
      [workspaceId]
    )
  ]);

  return {
    items: rows.map((row) => ({
      ...row,
      amount: toNumber(row.amount),
      createdAtIso: row.createdAt.toISOString()
    })),
    page: safePage,
    pageSize: safePageSize,
    total: Number(count?.count ?? 0)
  };
}

export async function getBillingPageData(workspaceId: string, fallbackName: string, fallbackEmail: string) {
  const [subscription, profile, history, config] = await Promise.all([
    getCurrentSubscriptionOverview(workspaceId),
    getBillingProfile(workspaceId),
    listBillingHistory(workspaceId),
    getPlatformSubscriptionConfig()
  ]);
  const expiredAt = subscription?.expiryDate ?? subscription?.endedAt ?? null;
  const cleanupAt = expiredAt ? addDays(expiredAt, config.expiredAccountCleanupDays) : null;

  return {
    profile: profile ?? {
      id: "",
      workspaceId,
      billingName: fallbackName,
      billingEmail: fallbackEmail,
      contactNumber: "",
      billingAddress1: createEmptyBillingDetails().billingAddressLine1,
      billingAddress2: null,
      billingCity: createEmptyBillingDetails().billingCity,
      billingState: createEmptyBillingDetails().billingState,
      billingPostcode: createEmptyBillingDetails().billingPostcode,
      billingCountry: createEmptyBillingDetails().billingCountry,
      taxNumber: null,
      createdAt: new Date(),
      updatedAt: new Date()
    },
    subscription,
    history,
    cleanupDays: config.expiredAccountCleanupDays,
    cleanupAt
  };
}

export type BillingDocumentView = {
  id: string;
  source: "invoice" | "upgrade";
  invoiceNo: string;
  packageName: string;
  status: "open" | "paid" | "overdue" | "void" | "cancelled" | "expired";
  issueDateIso: string;
  dueDateIso: string | null;
  total: number;
  balance: number;
  currency: string;
  invoiceAvailable: boolean;
  receiptAvailable: boolean;
  paymentPending: boolean;
  payable: boolean;
};

const BILLING_PAGE_DATA_TIMEOUT_MS = Math.max(
  1000,
  Number.parseInt(process.env.BILLING_PAGE_DATA_TIMEOUT_MS ?? "4000", 10) || 4000
);
const BILLING_OVERVIEW_TIMEOUT_MS = Math.max(
  1000,
  Number.parseInt(process.env.BILLING_OVERVIEW_TIMEOUT_MS ?? "4000", 10) || 4000
);

export async function getSubscriberBillingOverview(
  workspaceId: string,
  page = 1,
  perPage = 20
) {
  await Promise.all([
    ensureBillingManagementStore(),
    ensurePendingWorkspacePackageUpgradeStore()
  ]);
  const subscription = await getCurrentSubscriptionOverview(workspaceId);
  const safePage = Math.max(1, Math.floor(page));
  const safePerPage = Math.min(50, Math.max(5, Math.floor(perPage)));
  const [invoiceRows, upgradeRows] = await Promise.all([
    queryMany<InvoiceRow>(
      `SELECT * FROM "Invoice" WHERE "workspaceId" = $1 ORDER BY "issueDate" DESC`,
      [workspaceId]
    ),
    queryMany<{
      id: string;
      invoiceNumber: string;
      targetPlan: string;
      amount: string | null;
      currency: string | null;
      status: string;
      operationType: string | null;
      currentPlan: string;
      createdAt: Date;
      updatedAt: Date;
      receiptNumber: string | null;
      receiptIssuedAt: Date | null;
    }>(
      `SELECT id, "invoiceNumber", "targetPlan", "currentPlan", "operationType", amount, currency, status, "createdAt", "updatedAt", "receiptNumber", "receiptIssuedAt"
       FROM "PendingWorkspacePackageUpgrade"
       WHERE "workspaceId" = $1
       ORDER BY "createdAt" DESC`,
      [workspaceId]
    )
  ]);
  const subscriptionIds = Array.from(
    new Set(
      invoiceRows
        .map((row) => row.subscriptionId)
        .filter((subscriptionId): subscriptionId is string => Boolean(subscriptionId))
    )
  );
  const subscriptionStates = subscriptionIds.length
    ? await queryMany<{
        id: string;
        status: string;
        endedAt: Date | null;
        nextBillingAt: Date | null;
      }>(
        `SELECT id, status, "endedAt", "nextBillingAt"
         FROM "WorkspacePackageSubscription"
         WHERE id = ANY($1::text[])`,
        [subscriptionIds]
      )
    : [];
  const subscriptionStateById = new Map(
    subscriptionStates.map((subscription) => [subscription.id, subscription])
  );

  const documents: BillingDocumentView[] = [
    ...invoiceRows.map((row) => {
      const total = toNumber(row.totalAmount ?? row.amount);
      const paid = toNumber(row.paidAmount ?? (row.status === "PAID" ? total : 0));
      const balance = toNumber(row.balanceAmount ?? Math.max(0, total - paid));
      const dueDate = row.dueDate ?? addDays(row.issueDate ?? row.createdAt, 7);
      const subscriptionState = row.subscriptionId
        ? subscriptionStateById.get(row.subscriptionId) ?? null
        : null;
      const isExpiredSubscriptionInvoice =
        balance > 0 &&
        (subscriptionState?.status === "EXPIRED" ||
          Boolean(subscriptionState?.endedAt && subscriptionState.endedAt.getTime() <= Date.now()));
      const normalizedStatus: BillingDocumentView["status"] =
        row.status === "PAID"
          ? "paid"
          : row.status === "CANCELLED"
            ? "cancelled"
            : row.status === "VOID" || row.status === "REFUNDED"
              ? "void"
              : isExpiredSubscriptionInvoice
                ? "expired"
              : dueDate.getTime() < Date.now()
                ? "overdue"
                : "open";
      return {
        id: `invoice:${row.id}`,
        source: "invoice" as const,
        invoiceNo: row.invoiceNo,
        packageName: row.packageName,
        status: normalizedStatus,
        issueDateIso: (row.issueDate ?? row.createdAt).toISOString(),
        dueDateIso: dueDate.toISOString(),
        total,
        balance,
        currency: row.currency,
        invoiceAvailable: true,
        receiptAvailable: normalizedStatus === "paid" && Boolean(row.receiptNumber),
        paymentPending: false,
        payable: normalizedStatus === "open"
      };
    }),
    ...upgradeRows.map((row) => {
      const dueDate = addDays(row.createdAt, 7);
      const inactive =
        row.status === "CANCELLED" ||
        row.status === "SUPERSEDED" ||
        row.status === "SCHEDULED" ||
        row.status === "EXPIRED";
      const processing = row.status === "PAYMENT_PROCESSING";
      const paid = row.status === "PAID";
      const status = inactive
        ? row.status === "SCHEDULED" || row.status === "EXPIRED"
          ? "expired"
          : "cancelled"
        : paid
          ? "paid"
          : processing
            ? "open"
            : dueDate.getTime() < Date.now()
              ? "overdue"
              : "open";
      return {
        id: `upgrade:${row.id}`,
        source: "upgrade" as const,
        invoiceNo: row.invoiceNumber,
        packageName: `${row.operationType ?? "PLAN_CHANGE"}: ${titleCase(row.currentPlan)} to ${titleCase(row.targetPlan)}`,
        status,
        issueDateIso: row.createdAt.toISOString(),
        dueDateIso: dueDate.toISOString(),
        total: toNumber(row.amount),
        balance: inactive || paid ? 0 : toNumber(row.amount),
        currency: row.currency ?? "MYR",
        invoiceAvailable: true,
        receiptAvailable: paid && Boolean(row.receiptNumber),
        paymentPending: processing,
        payable:
          status === "open" &&
          (row.status === "ISSUED" ||
            row.status === "PENDING" ||
            row.status === "PAYMENT_FAILED")
      } satisfies BillingDocumentView;
    })
  ].sort((left, right) => right.issueDateIso.localeCompare(left.issueDateIso));

  const openDocuments = documents.filter((item) => item.status === "open" || item.status === "overdue");
  const gracePeriodEndDate =
    subscription?.status === "PAST_DUE" && subscription.nextBillingAt
      ? addDays(subscription.nextBillingAt, 14)
      : null;
  const start = (safePage - 1) * safePerPage;

  return {
    currentPackage: subscription
      ? {
          id: subscription.packageId,
          name: subscription.packageName,
          price: subscription.subscribedPrice ?? 0,
          currency: subscription.currency ?? "MYR",
          billingCycle: subscription.billingPeriod ?? "MONTHLY",
          status: normalizeSubscriptionStatus(subscription.status),
          subscriptionStartDate: subscription.startedAt.toISOString(),
          subscriptionEndDate: (subscription.trialEndsAt ?? subscription.nextBillingAt ?? subscription.endedAt)?.toISOString() ?? null,
          gracePeriodEndDate: gracePeriodEndDate?.toISOString() ?? null
        }
      : null,
    summary: {
      openInvoices: openDocuments.length,
      outstandingAmount: openDocuments.reduce((sum, item) => sum + item.balance, 0),
      receiptsReady: documents.filter((item) => item.status === "paid" && item.receiptAvailable).length
    },
    documents: documents.slice(start, start + safePerPage),
    pagination: {
      page: safePage,
      perPage: safePerPage,
      total: documents.length
    }
  };
}

export type SubscriberBillingOverview = Awaited<ReturnType<typeof getSubscriberBillingOverview>>;
export type BillingPageData = Awaited<ReturnType<typeof getBillingPageData>>;

export async function getBillingPageDataForPage(
  workspaceId: string,
  fallbackName: string,
  fallbackEmail: string,
  timeoutMs = BILLING_PAGE_DATA_TIMEOUT_MS
): Promise<BillingPageData> {
  const dataPromise = getBillingPageData(workspaceId, fallbackName, fallbackEmail).catch(() =>
    buildBillingPageDataFallback(workspaceId, fallbackName, fallbackEmail)
  );

  let timeout: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<BillingPageData>((resolve) => {
    timeout = setTimeout(() => {
      resolve(buildBillingPageDataFallback(workspaceId, fallbackName, fallbackEmail));
    }, Math.max(1000, timeoutMs));
  });

  try {
    return await Promise.race([dataPromise, timeoutPromise]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

export async function getSubscriberBillingOverviewForPage(
  workspaceId: string,
  page = 1,
  perPage = 20,
  timeoutMs = BILLING_OVERVIEW_TIMEOUT_MS
): Promise<SubscriberBillingOverview> {
  const safePage = Math.max(1, Math.floor(page));
  const safePerPage = Math.min(50, Math.max(5, Math.floor(perPage)));
  const overviewPromise = getSubscriberBillingOverview(workspaceId, safePage, safePerPage).catch(() =>
    buildSubscriberBillingOverviewFallback(safePage, safePerPage)
  );

  let timeout: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<SubscriberBillingOverview>((resolve) => {
    timeout = setTimeout(() => {
      resolve(buildSubscriberBillingOverviewFallback(safePage, safePerPage));
    }, Math.max(1000, timeoutMs));
  });

  try {
    return await Promise.race([overviewPromise, timeoutPromise]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function buildBillingPageDataFallback(
  workspaceId: string,
  fallbackName: string,
  fallbackEmail: string
): BillingPageData {
  return {
    profile: {
      id: "",
      workspaceId,
      billingName: fallbackName,
      billingEmail: fallbackEmail,
      contactNumber: "",
      billingAddress1: createEmptyBillingDetails().billingAddressLine1,
      billingAddress2: null,
      billingCity: createEmptyBillingDetails().billingCity,
      billingState: createEmptyBillingDetails().billingState,
      billingPostcode: createEmptyBillingDetails().billingPostcode,
      billingCountry: createEmptyBillingDetails().billingCountry,
      taxNumber: null,
      createdAt: new Date(),
      updatedAt: new Date()
    },
    subscription: null,
    history: {
      items: [],
      page: 1,
      pageSize: 10,
      total: 0
    },
    cleanupDays: 60,
    cleanupAt: null
  };
}

function buildSubscriberBillingOverviewFallback(page: number, perPage: number): SubscriberBillingOverview {
  return {
    currentPackage: null,
    summary: {
      openInvoices: 0,
      outstandingAmount: 0,
      receiptsReady: 0
    },
    documents: [],
    pagination: {
      page,
      perPage,
      total: 0
    }
  };
}

export async function cancelCurrentSubscription(workspaceId: string) {
  await ensureBillingManagementStore();
  const subscription = await getCurrentSubscriptionOverview(workspaceId);
  if (!subscription) {
    throw new Error("Subscription not found.");
  }
  if (subscription.status === "TRIAL") {
    throw new Error("Free trials do not use auto-renewal.");
  }

  return queryOne<SubscriptionOverviewRow>(
    `UPDATE "WorkspacePackageSubscription"
     SET "autoRenew" = FALSE, "cancelledAt" = NOW(), "updatedAt" = NOW()
     WHERE id = $1
     RETURNING *`,
    [subscription.id]
  );
}

export async function createPaidInvoice(input: {
  workspaceId: string;
  subscriptionId: string;
  packageId?: string | null;
  customerName: string;
  customerEmail: string;
  customerInformation?: string | null;
  packageName: string;
  amount: number;
  currency: string;
  transactionType: "NEW_SUBSCRIPTION" | "UPGRADE" | "DOWNGRADE" | "RENEWAL" | "MANUAL_PAYMENT";
  subscriptionStartDate: Date;
  subscriptionEndDate?: Date | null;
  paymentDate?: Date | null;
  providerReference?: string | null;
  executor?: DbExecutor;
}): Promise<InvoiceRow> {
  if (!input.executor) {
    return transaction((client) => createPaidInvoice({ ...input, executor: client }));
  }

  await ensureBillingManagementStore(input.executor);
  const emailConfig = await getResolvedPlatformEmailConfig();
  if (input.providerReference) {
    const existing = await queryOne<InvoiceRow>(
      `SELECT * FROM "Invoice" WHERE "orderNo" = $1 LIMIT 1`,
      [input.providerReference],
      input.executor
    );
    if (existing) {
      return existing;
    }
  }

  const invoiceNo = buildReference("INV");
  const orderNo = input.providerReference || buildReference("ORD");
  const invoiceId = createRecordId();
  const receipt = await issueReceiptNumber({
    paidAt: input.paymentDate ?? new Date(),
    executor: input.executor!
  });
  const customerInformation =
    input.customerInformation ?? (await buildWorkspaceCustomerInformation(input.workspaceId, input.executor));
  const invoice = await queryOne<InvoiceRow>(
    `INSERT INTO "Invoice" (
       id, "invoiceNo", "orderNo", "workspaceId", "subscriptionId", "packageId",
       "customerName", "customerEmail", "customerInformation", "packageName", amount, currency, status,
       "transactionType", "subscriptionStartDate", "subscriptionEndDate", "paymentDate",
       "companyInformation", "issueDate", "dueDate", "totalAmount", "paidAmount",
       "balanceAmount", "paidAt", "receiptNumber", "receiptIssuedAt", "createdAt", "updatedAt"
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'PAID',
       $13, $14, $15, $16, $17, NOW(), NOW() + INTERVAL '7 days',
       $11, $11, 0, $16, $18, $19, NOW(), NOW()
     ) RETURNING *`,
    [
      invoiceId,
      invoiceNo,
      orderNo,
      input.workspaceId,
      input.subscriptionId,
      input.packageId ?? null,
      input.customerName,
      input.customerEmail,
      customerInformation,
      input.packageName,
      input.amount,
      input.currency,
      input.transactionType,
      input.subscriptionStartDate,
      input.subscriptionEndDate ?? null,
      input.paymentDate ?? new Date(),
      emailConfig.emailBrandName || null,
      receipt.receiptNumber,
      receipt.receiptIssuedAt
    ],
    input.executor
  );
  if (!invoice) {
    throw new Error("Unable to create invoice.");
  }

  await execute(
    `INSERT INTO "BillingHistory" (
       id, "workspaceId", "invoiceId", "transactionType", description, amount, currency, "createdAt"
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
    [
      createRecordId(),
      input.workspaceId,
      invoice.id,
      input.transactionType,
      `${input.packageName} ${formatTransactionType(input.transactionType)}`,
      input.amount,
      input.currency
    ],
    input.executor
  );

  return invoice;
}

export async function createOpenInvoice(input: {
  workspaceId: string;
  subscriptionId: string;
  packageId?: string | null;
  customerName: string;
  customerEmail: string;
  customerInformation?: string | null;
  packageName: string;
  amount: number;
  currency: string;
  transactionType: "NEW_SUBSCRIPTION" | "UPGRADE" | "DOWNGRADE" | "RENEWAL" | "MANUAL_PAYMENT";
  subscriptionStartDate: Date;
  subscriptionEndDate?: Date | null;
  issueDate?: Date | null;
  dueDate?: Date | null;
  providerReference?: string | null;
  executor?: DbExecutor;
}) {
  await ensureBillingManagementStore(input.executor);
  const emailConfig = await getResolvedPlatformEmailConfig();
  if (input.providerReference) {
    const existing = await queryOne<InvoiceRow>(
      `SELECT * FROM "Invoice" WHERE "providerReference" = $1 LIMIT 1`,
      [input.providerReference],
      input.executor
    );
    if (existing) {
      return existing;
    }
  }

  const invoiceNo = buildReference("INV");
  const orderNo = input.providerReference || buildReference("ORD");
  const invoiceId = createRecordId();
  const issueDate = input.issueDate ?? new Date();
  const dueDate = input.dueDate ?? addDays(issueDate, 7);
  const customerInformation =
    input.customerInformation ?? (await buildWorkspaceCustomerInformation(input.workspaceId, input.executor));
  const invoice = await queryOne<InvoiceRow>(
    `INSERT INTO "Invoice" (
       id, "invoiceNo", "orderNo", "workspaceId", "subscriptionId", "packageId",
       "customerName", "customerEmail", "customerInformation", "packageName", amount, currency, status,
       "transactionType", "subscriptionStartDate", "subscriptionEndDate",
       "companyInformation", "issueDate", "dueDate", "totalAmount", "paidAmount",
       "balanceAmount", "providerReference", "createdAt", "updatedAt"
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'OPEN',
       $13, $14, $15, $16, $17, $18, $11, 0, $11, $19, NOW(), NOW()
     ) RETURNING *`,
    [
      invoiceId,
      invoiceNo,
      orderNo,
      input.workspaceId,
      input.subscriptionId,
      input.packageId ?? null,
      input.customerName,
      input.customerEmail,
      customerInformation,
      input.packageName,
      input.amount,
      input.currency,
      input.transactionType,
      input.subscriptionStartDate,
      input.subscriptionEndDate ?? null,
      emailConfig.emailBrandName || null,
      issueDate,
      dueDate,
      input.providerReference ?? null
    ],
    input.executor
  );
  if (!invoice) {
    throw new Error("Unable to create invoice.");
  }

  return invoice;
}

async function getInvoiceDocumentContext(invoice: InvoiceRow): Promise<InvoiceDocumentContext> {
  const [billingProfile, paymentTransaction, pricing, emailConfig] = await Promise.all([
    getBillingProfile(invoice.workspaceId),
    invoice.subscriptionId
      ? queryOne<{ provider: string | null; providerReference: string | null }>(
          `SELECT provider, "providerReference"
           FROM "PaymentTransaction"
           WHERE "subscriptionId" = $1
           ORDER BY COALESCE("paidAt", "createdAt") DESC
           LIMIT 1`,
          [invoice.subscriptionId]
        )
      : Promise.resolve(null),
    invoice.subscriptionId
      ? queryOne<{ billingPeriod: string | null; unitPrice: string | null }>(
          `SELECT
              COALESCE(s."billingPeriod", p."billingPeriod") AS "billingPeriod",
              COALESCE(s."subscribedPrice", p."priceAmount")::text AS "unitPrice"
           FROM "WorkspacePackageSubscription" s
           LEFT JOIN "Package" p ON p.id = s."packageId"
           WHERE s.id = $1
           LIMIT 1`,
          [invoice.subscriptionId]
        )
      : Promise.resolve(null),
    getResolvedPlatformEmailConfig()
  ]);

  const company = resolveCompanyParty(invoice.companyInformation, emailConfig);
  const customer = resolveCustomerParty(invoice.customerInformation, billingProfile, {
    fallbackName: invoice.customerName,
    fallbackEmail: invoice.customerEmail
  });
  const currency = normalizeCurrencyCode(invoice.currency);
  const totalAmount = toNumber(invoice.totalAmount ?? invoice.amount);
  const paidAmount = toNumber(invoice.paidAmount ?? (invoice.status === "PAID" ? totalAmount : 0));
  const balanceAmount = toNumber(invoice.balanceAmount ?? Math.max(0, totalAmount - paidAmount));
  const billingPeriod = pricing?.billingPeriod ?? null;
  const item = {
    description: `${invoice.packageName} package${billingPeriod ? ` (${formatBillingPeriodLabel(billingPeriod)})` : ""}`,
    qty: 1,
    unitPrice: toNumber(pricing?.unitPrice ?? invoice.totalAmount ?? invoice.amount),
    lineTotal: totalAmount
  };

  return {
    type: "invoice",
    title: "INVOICE",
    invoiceNo: invoice.invoiceNo,
    receiptNo: invoice.receiptNumber,
    orderNo: invoice.orderNo,
    issueDate: invoice.issueDate ?? invoice.createdAt,
    dueDate: invoice.dueDate,
    paymentDate: invoice.paidAt ?? invoice.paymentDate,
    paymentMethod: normalizePaymentMethod(paymentTransaction?.provider),
    currency,
    status: normalizeDocumentStatus(invoice.status, invoice.dueDate, balanceAmount),
    company,
    customer,
    items: [item],
    summaryRows: [
      { label: "Subtotal", amount: totalAmount },
      { label: "Discount", amount: 0 },
      { label: "Tax", amount: 0 },
      { label: "Total", amount: totalAmount, highlight: true }
    ],
    metaRows: [
      { label: "Invoice No", value: invoice.invoiceNo },
      { label: "Invoice Date", value: formatDocumentDate(invoice.issueDate ?? invoice.createdAt) },
      { label: "Due Date", value: formatDocumentDate(invoice.dueDate) },
      { label: "Currency", value: currency }
    ],
    notes: [
      "Please include the invoice number with your payment reference.",
      "This is a system generated invoice."
    ]
  };
}

async function buildInvoiceDocumentContextFromSnapshot(snapshot: InvoiceEmailSnapshot): Promise<InvoiceDocumentContext> {
  const [billingProfile, emailConfig] = await Promise.all([
    snapshot.workspaceId ? getBillingProfile(snapshot.workspaceId) : Promise.resolve(null),
    getResolvedPlatformEmailConfig()
  ]);
  const company = resolveCompanyParty(snapshot.companyInformation, emailConfig);
  const customer = resolveCustomerParty(snapshot.customerInformation, billingProfile, {
    fallbackName: snapshot.customerName,
    fallbackEmail: snapshot.customerEmail,
    fallbackContactNumber: snapshot.customerContactNumber ?? null,
    fallbackAddress: snapshot.customerAddress ?? null
  });
  const currency = normalizeCurrencyCode(snapshot.currency);
  const totalAmount = snapshot.amount;

  return {
    type: "invoice",
    title: "INVOICE",
    invoiceNo: snapshot.invoiceNo,
    receiptNo: null,
    orderNo: snapshot.orderNo,
    issueDate: snapshot.issueDate,
    dueDate: snapshot.dueDate,
    paymentDate: null,
    paymentMethod: null,
    currency,
    status: normalizeDocumentStatus(snapshot.status, snapshot.dueDate, totalAmount),
    company,
    customer,
    items: [{
      description: `${snapshot.packageName} package${snapshot.billingPeriod ? ` (${formatBillingPeriodLabel(snapshot.billingPeriod)})` : ""}`,
      qty: 1,
      unitPrice: totalAmount,
      lineTotal: totalAmount
    }],
    summaryRows: [
      { label: "Subtotal", amount: totalAmount },
      { label: "Discount", amount: 0 },
      { label: "Tax", amount: 0 },
      { label: "Total", amount: totalAmount, highlight: true }
    ],
    metaRows: [
      { label: "Invoice No", value: snapshot.invoiceNo },
      { label: "Invoice Date", value: formatDocumentDate(snapshot.issueDate) },
      { label: "Due Date", value: formatDocumentDate(snapshot.dueDate) },
      { label: "Currency", value: currency }
    ],
    notes: [
      "Please include the invoice number with your payment reference.",
      "This is a system generated invoice."
    ]
  };
}

function buildReceiptDocumentContext(invoice: InvoiceRow, company: DocumentParty, customer: DocumentParty, paymentMethod: string | null): InvoiceDocumentContext {
  const currency = normalizeCurrencyCode(invoice.currency);
  const totalAmount = toNumber(invoice.totalAmount ?? invoice.amount);
  const paidAmount = toNumber(invoice.paidAmount ?? totalAmount);
  const balanceAmount = toNumber(invoice.balanceAmount ?? Math.max(0, totalAmount - paidAmount));
  const paymentStatus = normalizeDocumentStatus(invoice.status, invoice.dueDate, balanceAmount);
  const transactionId = invoice.providerReference ?? invoice.orderNo;
  const paidAt = invoice.paidAt ?? invoice.paymentDate;
  return {
    type: "receipt",
    title: "RECEIPT",
    invoiceNo: invoice.invoiceNo,
    receiptNo: invoice.receiptNumber,
    orderNo: invoice.orderNo,
    issueDate: invoice.issueDate ?? invoice.createdAt,
    dueDate: invoice.dueDate,
    paymentDate: paidAt,
    paymentMethod,
    currency,
    status: paymentStatus,
    company,
    customer,
    items: [{
      description: invoice.packageName,
      qty: 1,
      unitPrice: totalAmount,
      lineTotal: paidAmount
    }],
    summaryRows: [
      { label: "Transaction ID", text: transactionId },
      { label: "Payment Status", text: paymentStatus },
      { label: "Amount Paid", text: formatMoney(paidAmount, currency) },
      { label: "Currency", text: currency }
    ],
    metaRows: [
      { label: "Receipt No", value: invoice.receiptNumber ?? "Unavailable" },
      { label: "Invoice No", value: invoice.invoiceNo },
      { label: "Transaction ID", value: transactionId },
      { label: "Payment Date", value: formatDocumentDate(paidAt) },
      { label: "Payment Method", value: paymentMethod ?? "Not recorded" },
      { label: "Amount Paid", value: formatMoney(paidAmount, currency) },
      { label: "Currency", value: currency },
      { label: "Payment Status", value: paymentStatus }
    ],
    notes: [
      `Company: ${company.name ?? "Connexa"}`,
      "This is a system generated receipt."
    ]
  };
}

export async function finalizeInvoiceDocumentAndEmail(invoiceId: string) {
  await ensureBillingManagementStore();
  const invoice = await queryOne<InvoiceRow>(`SELECT * FROM "Invoice" WHERE id = $1 LIMIT 1`, [invoiceId]);
  if (!invoice) {
    throw new Error("Invoice not found.");
  }

  const documents = await writePaidInvoiceDocuments(invoice);

  const html = await renderEmailTemplate({
    eyebrow: "Payment confirmation",
    title: `Invoice ${invoice.invoiceNo}`,
    intro: `Your payment for ${invoice.packageName} has been confirmed.`,
    bodyHtml: `
      <div style="padding:16px;border-radius:14px;background:rgba(255,255,255,0.05)">
        <div>Order: <strong>${escapeHtml(invoice.orderNo)}</strong></div>
        <div style="margin-top:8px">Amount: <strong>${escapeHtml(formatMoney(toNumber(invoice.amount), invoice.currency))}</strong></div>
        <div style="margin-top:8px">Status: <strong>${escapeHtml(invoice.status)}</strong></div>
      </div>
    `
  });

  await sendEmail({
    to: invoice.customerEmail,
    subject: `Connexa payment confirmation - ${invoice.invoiceNo}`,
    text: `Payment confirmed for ${invoice.packageName}. Invoice ${invoice.invoiceNo}. Amount ${formatMoney(
      toNumber(invoice.amount),
      invoice.currency
    )}.`,
    html,
    attachments: documents.receiptFileName
      ? [
          {
            filename: documents.receiptFileName,
            content: documents.receiptBuffer,
            contentType: "application/pdf"
          }
        ]
      : []
  });

  return {
    ...invoice,
    pdfPath: documents.pdfPath,
    invoicePdfPath: documents.pdfPath,
    receiptPdfPath: documents.receiptPdfPath
  };
}

export async function sendInvoiceIssuedEmail(invoiceId: string) {
  await ensureBillingManagementStore();
  const invoice = await queryOne<InvoiceRow>(`SELECT * FROM "Invoice" WHERE id = $1 LIMIT 1`, [invoiceId]);
  if (!invoice) {
    throw new Error("Invoice not found.");
  }

  const documents = await writePaidInvoiceDocuments(invoice);
  return sendInvoiceIssuedEmailFromSnapshot({
    workspaceId: invoice.workspaceId,
    invoiceNo: invoice.invoiceNo,
    orderNo: invoice.orderNo,
    customerName: invoice.customerName,
    customerEmail: invoice.customerEmail,
    customerInformation: invoice.customerInformation,
    packageName: invoice.packageName,
    amount: toNumber(invoice.totalAmount ?? invoice.amount),
    currency: invoice.currency,
    issueDate: invoice.issueDate ?? invoice.createdAt,
    dueDate: invoice.dueDate,
    status: invoice.status,
    companyInformation: invoice.companyInformation,
    taxInformation: invoice.taxInformation
  }, {
    fileName: documents.fileName,
    pdfBuffer: documents.pdfBuffer
  });
}

export async function sendInvoiceIssuedEmailFromSnapshot(
  snapshot: InvoiceEmailSnapshot,
  existingAttachment?: {
    fileName: string;
    pdfBuffer: Buffer;
  }
) {
  const context = await buildInvoiceDocumentContextFromSnapshot(snapshot);
  const attachment =
    existingAttachment ??
    {
      fileName: `invoice-${context.invoiceNo}.pdf`,
      pdfBuffer: buildInvoicePdf(context)
    };

  const html = await renderEmailTemplate({
    eyebrow: "Invoice issued",
    title: `Invoice ${snapshot.invoiceNo}`,
    intro: `Your invoice for ${snapshot.packageName} is ready.`,
    bodyHtml: `
      <div style="padding:16px;border-radius:14px;background:rgba(255,255,255,0.05)">
        <div>Order: <strong>${escapeHtml(snapshot.orderNo)}</strong></div>
        <div style="margin-top:8px">Amount: <strong>${escapeHtml(formatMoney(snapshot.amount, snapshot.currency))}</strong></div>
        <div style="margin-top:8px">Due date: <strong>${escapeHtml(formatDate(snapshot.dueDate))}</strong></div>
        <div style="margin-top:8px">Status: <strong>${escapeHtml(context.status)}</strong></div>
      </div>
    `
  });

  await sendEmail({
    to: snapshot.customerEmail,
    subject: `Connexa invoice - ${snapshot.invoiceNo}`,
    text: `Invoice ${snapshot.invoiceNo} for ${snapshot.packageName}. Amount ${formatMoney(snapshot.amount, snapshot.currency)}. Due ${formatDate(snapshot.dueDate)}.`,
    html,
    attachments: [
      {
        filename: attachment.fileName,
        content: attachment.pdfBuffer,
        contentType: "application/pdf"
      }
    ]
  });
}

export async function resendInvoice(workspaceId: string, invoiceId: string) {
  const invoice = await queryOne<InvoiceRow>(
    `SELECT * FROM "Invoice" WHERE id = $1 AND "workspaceId" = $2 LIMIT 1`,
    [invoiceId, workspaceId]
  );
  if (!invoice) {
    throw new Error("Invoice not found.");
  }
  return sendInvoiceIssuedEmail(invoice.id);
}

export async function beginSubscriberInvoicePayment(input: {
  workspaceId: string;
  invoiceId: string;
  requestedByName: string;
  requestedByEmail: string;
}) {
  await ensureBillingManagementStore();
  const appBaseUrl = getAppBaseUrl();
  const billplzConfig = await getBillplzCheckoutConfig();

  const invoice = await queryOne<InvoiceRow>(
    `SELECT * FROM "Invoice" WHERE id = $1 AND "workspaceId" = $2 LIMIT 1`,
    [input.invoiceId, input.workspaceId]
  );
  if (!invoice) {
    throw new Error("Invoice not found.");
  }

  const dueDate = invoice.dueDate ?? addDays(invoice.issueDate ?? invoice.createdAt, 7);
  if (invoice.status === "PAID") {
    throw new Error("This invoice has already been paid.");
  }
  if (invoice.status === "CANCELLED" || invoice.status === "VOID" || invoice.status === "REFUNDED") {
    throw new Error("This invoice is no longer payable.");
  }
  if (dueDate.getTime() < Date.now()) {
    throw new Error("This invoice is past due and can no longer be paid online.");
  }
  if (invoice.providerCheckoutUrl && invoice.providerReference) {
    return { paymentUrl: invoice.providerCheckoutUrl };
  }

  const bill = await createBillplzBill(billplzConfig, {
    name: input.requestedByName,
    email: input.requestedByEmail,
    amount: toNumber(invoice.totalAmount ?? invoice.amount),
    description: `${invoice.packageName} invoice ${invoice.invoiceNo}`,
    callbackUrl: `${appBaseUrl}/api/billing/billplz/subscriber-invoice/callback`,
    redirectUrl: `${appBaseUrl}/api/account/billing/documents/complete`
  });

  await execute(
    `UPDATE "Invoice"
     SET provider = 'billplz',
         "providerReference" = $2,
         "providerCheckoutUrl" = $3,
         "updatedAt" = NOW()
     WHERE id = $1`,
    [invoice.id, bill.id, bill.url]
  );

  return { paymentUrl: bill.url };
}

async function completeSubscriberInvoicePayment(providerReference: string, paidAt: Date | null) {
  return transaction(async (client) => {
    await ensureBillingManagementStore(client);
    const invoice = await queryOne<InvoiceRow>(
      `SELECT * FROM "Invoice" WHERE "providerReference" = $1 LIMIT 1 FOR UPDATE`,
      [providerReference],
      client
    );
    if (!invoice) {
      throw new Error("Invoice not found.");
    }

    if (invoice.status === "PAID") {
      return invoice;
    }

    if (invoice.status === "CANCELLED" || invoice.status === "VOID" || invoice.status === "REFUNDED") {
      throw new Error("This invoice is no longer payable.");
    }

    const dueDate = invoice.dueDate ?? addDays(invoice.issueDate ?? invoice.createdAt, 7);
    if (dueDate.getTime() < Date.now()) {
      throw new Error("This invoice is past due and can no longer be paid online.");
    }

    const completedAt = paidAt ?? new Date();
    const receipt = await issueReceiptNumber({
      paidAt: completedAt,
      executor: client
    });
    const updatedInvoice = await queryOne<InvoiceRow>(
      `UPDATE "Invoice"
       SET status = 'PAID',
           "paidAmount" = COALESCE("totalAmount", amount),
           "balanceAmount" = 0,
           "paymentDate" = $2,
           "paidAt" = $2,
             "receiptNumber" = $3,
             "receiptIssuedAt" = $4,
           "updatedAt" = NOW()
       WHERE id = $1
       RETURNING *`,
      [invoice.id, completedAt, receipt.receiptNumber, receipt.receiptIssuedAt],
      client
    );
    if (!updatedInvoice) {
      throw new Error("Unable to complete invoice payment.");
    }

    if (invoice.subscriptionId) {
      const subscription = await queryOne<SubscriptionOverviewRow>(
        `SELECT s.*, p.code AS "packageCode", p.name AS "packageName"
         FROM "WorkspacePackageSubscription" s
         INNER JOIN "Package" p ON p.id = s."packageId"
         WHERE s.id = $1
         LIMIT 1
         FOR UPDATE`,
        [invoice.subscriptionId],
        client
      );

      if (subscription && subscription.status === SubscriptionStatus.TRIAL) {
        const activeFrom = subscription.trialEndsAt ?? completedAt;
        const nextBillingAt = getNextBillingAtFromBase(activeFrom, subscription.billingPeriod);
        await execute(
          `UPDATE "WorkspacePackageSubscription"
           SET status = 'ACTIVE',
               "nextBillingAt" = $2,
               "autoRenew" = TRUE,
               "paidAt" = $3,
               "updatedAt" = NOW()
           WHERE id = $1`,
          [subscription.id, nextBillingAt, completedAt],
          client
        );
        await execute(
          `UPDATE "Workspace"
           SET "trialEndsAt" = NULL, "updatedAt" = NOW()
           WHERE id = $1`,
          [subscription.workspaceId],
          client
        );
      }

      await recordWorkspacePayment({
        workspaceId: updatedInvoice.workspaceId,
        subscriptionId: invoice.subscriptionId,
          invoiceId: updatedInvoice.id,
          transactionId: providerReference,
        amount: toNumber(updatedInvoice.totalAmount ?? updatedInvoice.amount),
        currency: updatedInvoice.currency,
        provider: updatedInvoice.provider ?? "billplz",
        providerReference,
          paymentMethod: updatedInvoice.provider ?? "Billplz",
          receiptNumber: updatedInvoice.receiptNumber,
          receiptIssuedAt: updatedInvoice.receiptIssuedAt,
        status: PaymentStatus.PAID,
        paidAt: completedAt,
        executor: client
      });
    }

    return updatedInvoice;
  });
}

export async function finalizeSubscriberInvoicePaymentFromRedirect(params: Record<string, string>) {
  await ensureBillingManagementStore();
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
      status: "PENDING" as const,
      invoice: await queryOne<InvoiceRow>(`SELECT * FROM "Invoice" WHERE "providerReference" = $1 LIMIT 1`, [billId])
    };
  }

  return {
    status: "COMPLETED" as const,
    invoice: await completeSubscriberInvoicePayment(billId, paidAt)
  };
}

export async function finalizeSubscriberInvoicePaymentFromCallback(params: Record<string, string>) {
  await ensureBillingManagementStore();
  const config = await getBillplzCheckoutConfig();

  if (!verifyBillplzCallbackSignature(params, config.xSignatureKey)) {
    throw new Error("Invalid Billplz callback signature.");
  }

  if (!params.id) {
    throw new Error("Missing Billplz bill id.");
  }

  if (params.paid !== "true") {
    return queryOne<InvoiceRow>(`SELECT * FROM "Invoice" WHERE "providerReference" = $1 LIMIT 1`, [params.id]);
  }

  const paidAt = params.paid_at ? new Date(params.paid_at) : new Date();
  const invoice = await completeSubscriberInvoicePayment(params.id, paidAt);
  await finalizeInvoiceDocumentAndEmail(invoice.id).catch((error) => {
    console.error("[billing] unable to finalize subscriber invoice", error);
  });
  return invoice;
}

export async function getBillingDocumentPdf(
  workspaceId: string,
  documentId: string,
  type: "invoice" | "receipt"
) {
  await Promise.all([
    ensureBillingManagementStore(),
    ensurePendingWorkspacePackageUpgradeStore()
  ]);
  const [source, id] = documentId.split(":", 2);
  if (!id || (source !== "invoice" && source !== "upgrade")) {
    throw new Error("Billing document not found.");
  }

  if (source === "invoice") {
    let invoice = await queryOne<InvoiceRow>(
      `SELECT * FROM "Invoice" WHERE id = $1 AND "workspaceId" = $2 LIMIT 1`,
      [id, workspaceId]
    );
    if (!invoice) {
      throw new Error("Billing document not found.");
    }
	    if (type === "receipt" && invoice.status !== "PAID") {
	      throw new Error("A receipt is available only after payment.");
	    }
    if (type === "receipt" && !invoice.receiptNumber) {
      throw new Error("Receipt has not been issued for this transaction.");
    }
	    if (
	      !(invoice.invoicePdfPath ?? invoice.pdfPath) ||
	      (invoice.status === "PAID" && invoice.receiptNumber && !invoice.receiptPdfPath)
	    ) {
      await writePaidInvoiceDocuments(invoice);
      invoice = (await queryOne<InvoiceRow>(`SELECT * FROM "Invoice" WHERE id = $1`, [invoice.id]))!;
    }
    const invoiceContext = await getInvoiceDocumentContext(invoice);
    const receiptContext = buildReceiptDocumentContext(
      invoice,
      invoiceContext.company,
      invoiceContext.customer,
      invoiceContext.paymentMethod
    );
    const buffer = type === "receipt" ? buildReceiptPdf(receiptContext) : buildInvoicePdf(invoiceContext);
    return {
      buffer,
      fileName:
        type === "receipt"
          ? `receipt-${receiptContext.receiptNo}.pdf`
          : `invoice-${invoiceContext.invoiceNo}.pdf`
    };
  }

	  const upgrade = await queryOne<{
	    invoiceNumber: string;
    receiptNumber: string | null;
    receiptIssuedAt: Date | null;
	    targetPlan: string;
    amount: string | null;
    currency: string | null;
    status: string;
    paidAt: Date | null;
    providerReference: string | null;
    createdAt: Date;
    updatedAt: Date;
    requestedByAgentId: string;
  }>(
	    `SELECT "invoiceNumber", "receiptNumber", "receiptIssuedAt", "targetPlan", amount, currency, status, "paidAt", "providerReference", "createdAt", "updatedAt", "requestedByAgentId"
	     FROM "PendingWorkspacePackageUpgrade"
     WHERE id = $1 AND "workspaceId" = $2 LIMIT 1`,
    [id, workspaceId]
  );
  if (!upgrade) {
    throw new Error("Billing document not found.");
  }
  const customer = await queryOne<{ name: string; email: string }>(
    `SELECT name, email FROM "Agent" WHERE id = $1 LIMIT 1`,
    [upgrade.requestedByAgentId]
  );
  const invoiceContext = await buildInvoiceDocumentContextFromSnapshot({
    workspaceId,
    invoiceNo: upgrade.invoiceNumber,
    orderNo: upgrade.invoiceNumber,
    customerName: customer?.name ?? "",
    customerEmail: customer?.email ?? "",
    packageName: titleCase(upgrade.targetPlan),
    amount: toNumber(upgrade.amount),
    currency: upgrade.currency ?? "MYR",
    issueDate: upgrade.createdAt,
    dueDate: addDays(upgrade.createdAt, 7),
    status: "OPEN"
  });
  if (type === "receipt") {
	    if (upgrade.status !== "PAID") {
	      throw new Error("A receipt is available only after payment.");
	    }
    if (!upgrade.receiptNumber) {
      throw new Error("Receipt has not been issued for this transaction.");
    }
	    const paidAt = upgrade.paidAt ?? upgrade.updatedAt;
    const receiptContext: InvoiceDocumentContext = {
      ...invoiceContext,
      type: "receipt",
      title: "RECEIPT",
	      receiptNo: upgrade.receiptNumber,
      paymentDate: paidAt,
      paymentMethod: "Billplz",
      status: "PAID",
      summaryRows: [
	        { label: "Transaction ID", text: upgrade.providerReference ?? upgrade.invoiceNumber },
	        { label: "Payment Status", text: "PAID" },
	        { label: "Amount Paid", text: formatMoney(toNumber(upgrade.amount), upgrade.currency ?? "MYR") },
	        { label: "Currency", text: upgrade.currency ?? "MYR" }
	      ],
	      metaRows: [
	        { label: "Receipt No", value: upgrade.receiptNumber },
	        { label: "Invoice No", value: upgrade.invoiceNumber },
	        { label: "Transaction ID", value: upgrade.providerReference ?? upgrade.invoiceNumber },
	        { label: "Payment Date", value: formatDocumentDate(paidAt) },
	        { label: "Payment Method", value: "Billplz" },
	        { label: "Amount Paid", value: formatMoney(toNumber(upgrade.amount), upgrade.currency ?? "MYR") },
	        { label: "Currency", value: upgrade.currency ?? "MYR" },
	        { label: "Payment Status", value: "PAID" }
	      ],
      notes: [
        `Company: ${invoiceContext.company.name ?? DOCUMENT_COMPANY_NAME}`,
        "This is a system generated receipt."
      ]
    };
    return {
      buffer: buildReceiptPdf(receiptContext),
      fileName: `receipt-${receiptContext.receiptNo}.pdf`
    };
  }
  return {
    buffer: buildInvoicePdf(invoiceContext),
    fileName: `invoice-${upgrade.invoiceNumber}.pdf`
  };
}

export type SubscriptionExpiryReminderJobResult = {
  checkedCount: number;
  eligibleCount: number;
  sentCount: number;
  duplicateCount: number;
  skippedCount: number;
  failedCount: number;
};

export async function sendSubscriptionExpiryReminderEmails(input?: {
  now?: Date;
  listCandidatesImpl?: () => Promise<ExpiryReminderCandidateRow[]>;
  reserveEventImpl?: (event: { eventKey: string; workspaceId: string; subscriptionId: string; emailType: string; recipientEmail: string }) => Promise<boolean>;
  markSentImpl?: (eventKey: string) => Promise<void>;
  releaseEventImpl?: (eventKey: string) => Promise<void>;
  resolvePackageImpl?: (packageKey: ReturnType<typeof normalizeWorkspacePackageKey>) => Promise<ReminderPackageDefinition>;
  sendReminderEmailImpl?: (payload: ExpiryReminderEmailPayload) => Promise<void>;
}) {
  const isUsingDefaultStore =
    !input?.listCandidatesImpl ||
    !input?.reserveEventImpl ||
    !input?.markSentImpl ||
    !input?.releaseEventImpl;

  if (isUsingDefaultStore) {
    await ensureBillingManagementStore();
  }

  const now = input?.now ?? new Date();
  const candidates = await (input?.listCandidatesImpl ?? listSubscriptionExpiryReminderCandidates)();
  const reserveEvent = input?.reserveEventImpl ?? reserveEmailLogEvent;
  const markSent = input?.markSentImpl ?? markEmailLogSent;
  const releaseEvent = input?.releaseEventImpl ?? releaseEmailLogEvent;
  const resolvePackage = input?.resolvePackageImpl ?? getResolvedPublicPackageDefinition;
  const sendReminderEmail = input?.sendReminderEmailImpl ?? sendSubscriptionExpiryReminderEmail;

  let eligibleCount = 0;
  let sentCount = 0;
  let duplicateCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  for (const row of candidates) {
    const candidate = toExpiryReminderCandidate(row, now);
    if (!candidate) {
      skippedCount += 1;
      continue;
    }

    eligibleCount += 1;
    const eventKey = buildExpiryReminderEventKey(candidate);
    const emailType = candidate.kind === "trial" ? "trial_expiry_reminder" : "plan_expiry_reminder";
    const reserved = await reserveEvent({
      eventKey,
      workspaceId: candidate.workspaceId,
      subscriptionId: candidate.subscriptionId,
      emailType,
      recipientEmail: candidate.recipientEmail
    });

    if (!reserved) {
      duplicateCount += 1;
      continue;
    }

    try {
      const packageDefinition = await resolvePackage(
        candidate.kind === "trial" ? "starter" : normalizeWorkspacePackageKey(candidate.packageCode)
      );
      await sendReminderEmail(buildExpiryReminderEmailPayload(candidate, packageDefinition));
      await markSent(eventKey);
      sentCount += 1;
    } catch (error) {
      failedCount += 1;
      await releaseEvent(eventKey).catch(() => undefined);
      console.error("[billing] unable to send subscription expiry reminder", {
        subscriptionId: candidate.subscriptionId,
        workspaceId: candidate.workspaceId,
        kind: candidate.kind,
        error
      });
    }
  }

  return {
    checkedCount: candidates.length,
    eligibleCount,
    sentCount,
    duplicateCount,
    skippedCount,
    failedCount
  } satisfies SubscriptionExpiryReminderJobResult;
}

export async function cleanupExpiredWorkspaces() {
  const config = await getPlatformSubscriptionConfig();
  await ensureBillingManagementStore();
  const rows = await queryMany<{ workspaceId: string }>(
    `SELECT DISTINCT s."workspaceId"
     FROM "WorkspacePackageSubscription" s
     WHERE (
       s.status = 'EXPIRED'
       OR (s.status = 'TRIAL' AND s."trialEndsAt" IS NOT NULL AND s."trialEndsAt" <= NOW())
       OR (s.status IN ('ACTIVE', 'PAST_DUE') AND s."nextBillingAt" IS NOT NULL AND s."nextBillingAt" <= NOW())
     )
     AND COALESCE(s."endedAt", s."trialEndsAt", s."nextBillingAt") <= NOW() - ($1::text || ' days')::interval`,
    [config.expiredAccountCleanupDays]
  );

  for (const row of rows) {
    await execute(`DELETE FROM "Workspace" WHERE id = $1`, [row.workspaceId]);
  }

  return { deletedWorkspaceCount: rows.length };
}

async function listSubscriptionExpiryReminderCandidates() {
  return queryMany<ExpiryReminderCandidateRow>(
    `SELECT
        s.id AS "subscriptionId",
        s."workspaceId",
        w.name AS "workspaceName",
        p.code AS "packageCode",
        p.name AS "packageName",
        s.status,
        s."subscribedPrice"::text AS "subscribedPrice",
        s.currency,
        COALESCE(s."billingPeriod", p."billingPeriod")::text AS "billingPeriod",
        s."startedAt",
        s."trialStartedAt",
        s."trialEndsAt",
        s."endedAt",
        s."nextBillingAt",
        s."autoRenew",
        manager.id AS "managerId",
        manager.name AS "managerName",
        manager.email AS "managerEmail",
        manager.status AS "managerStatus"
      FROM "WorkspacePackageSubscription" s
      INNER JOIN "Workspace" w ON w.id = s."workspaceId"
      INNER JOIN "Package" p ON p.id = s."packageId"
      LEFT JOIN LATERAL (
        SELECT a.id, a.name, a.email, a.status
        FROM "Agent" a
        WHERE a."workspaceId" = w.id
          AND a.role = 'MANAGER'
        ORDER BY
          CASE WHEN a.status = '${AgentStatus.ACTIVE}' THEN 0 ELSE 1 END,
          a."createdAt" ASC
        LIMIT 1
      ) manager ON TRUE
      WHERE s.status IN ('TRIAL', 'ACTIVE', 'PAST_DUE')`
  );
}

function toExpiryReminderCandidate(row: ExpiryReminderCandidateRow, now: Date) {
  const recipientEmail = normalizeReminderEmail(row.managerEmail);
  const recipientName = row.managerName?.trim() || row.workspaceName.trim();
  if (!recipientEmail || !recipientName) {
    return null;
  }

  const kind: ExpiryReminderKind = row.status === SubscriptionStatus.TRIAL ? "trial" : "plan";
  const periodEnd = kind === "trial" ? row.trialEndsAt : row.nextBillingAt ?? row.endedAt;
  if (!periodEnd || Number.isNaN(periodEnd.getTime()) || periodEnd.getTime() <= now.getTime()) {
    return null;
  }

  const tomorrowKey = getMalaysiaDateKey(addMalaysiaDays(now, 1));
  if (getMalaysiaDateKey(periodEnd) !== tomorrowKey) {
    return null;
  }

  return {
    subscriptionId: row.subscriptionId,
    workspaceId: row.workspaceId,
    workspaceName: row.workspaceName,
    packageCode: row.packageCode,
    packageName: row.packageName,
    recipientName,
    recipientEmail,
    kind,
    periodEnd,
    startedAt: row.startedAt,
    trialStartedAt: row.trialStartedAt,
    trialEndsAt: row.trialEndsAt,
    billingPeriod: row.billingPeriod,
    subscribedPrice: row.subscribedPrice === null ? null : toNumber(row.subscribedPrice),
    currency: row.currency,
    autoRenew: row.autoRenew
  } satisfies ExpiryReminderCandidate;
}

async function reserveEmailLogEvent(input: {
  eventKey: string;
  workspaceId: string;
  subscriptionId: string;
  emailType: string;
  recipientEmail: string;
}) {
  const row = await queryOne<Pick<EmailLogRow, "id">>(
    `INSERT INTO "EmailLog" (
       id, "workspaceId", "subscriptionId", "eventKey", "emailType", "recipientEmail", "createdAt", "updatedAt"
     ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
     ON CONFLICT ("eventKey") DO NOTHING
     RETURNING id`,
    [
      createRecordId(),
      input.workspaceId,
      input.subscriptionId,
      input.eventKey,
      input.emailType,
      input.recipientEmail
    ]
  );

  return Boolean(row?.id);
}

async function markEmailLogSent(eventKey: string) {
  await execute(
    `UPDATE "EmailLog"
     SET "sentAt" = NOW(), "updatedAt" = NOW()
     WHERE "eventKey" = $1`,
    [eventKey]
  );
}

async function releaseEmailLogEvent(eventKey: string) {
  await execute(`DELETE FROM "EmailLog" WHERE "eventKey" = $1 AND "sentAt" IS NULL`, [eventKey]);
}

function buildExpiryReminderEventKey(candidate: ExpiryReminderCandidate) {
  const prefix = candidate.kind === "trial" ? "trial_expiry_reminder" : "plan_expiry_reminder";
  return `${prefix}:${candidate.subscriptionId}:${candidate.periodEnd.toISOString()}`;
}

function buildExpiryReminderEmailPayload(
  candidate: ExpiryReminderCandidate,
  packageDefinition: ReminderPackageDefinition
): ExpiryReminderEmailPayload {
  const appUrl = `${getAppBaseUrl()}/account-settings/billing`;
  const benefits = (packageDefinition.features.length ? packageDefinition.features : packageDefinition.highlights)
    .slice(0, 4);
  const resolvedCurrency = candidate.currency ?? packageDefinition.currency ?? "MYR";
  const cycleLabel = formatBillingPeriodLabel(
    candidate.kind === "trial" ? packageDefinition.billingPeriod : candidate.billingPeriod ?? packageDefinition.billingPeriod
  );
  const priceAmount =
    candidate.kind === "trial"
      ? packageDefinition.priceAmount
      : candidate.subscribedPrice ?? packageDefinition.priceAmount;
  const priceLabel = priceAmount === null ? null : formatMoney(priceAmount, resolvedCurrency);
  const startDateLabel =
    candidate.kind === "trial"
      ? formatDate(candidate.periodEnd)
      : candidate.startedAt
        ? formatDate(candidate.startedAt)
        : null;
  const renewalLabel = formatDate(candidate.periodEnd);

  if (candidate.kind === "trial") {
    return {
      candidate,
      appUrl,
      benefits,
      priceLabel,
      cycleLabel,
      startDateLabel,
      renewalLabel: null,
      actionLabel: "Open Connexa",
      introLine: "Your free trial expires tomorrow. Upgrade to Starter to continue using Connexa without interruption.",
      panelTitle: "Here's what you'll get with Starter",
      summaryLines: [
        `Free trial expiry: ${renewalLabel}`,
        priceLabel ? `Starter price: ${priceLabel}` : null,
        cycleLabel ? `Billing cycle: ${cycleLabel}` : null,
        startDateLabel ? `Starter access starts: ${startDateLabel}` : null
      ].filter(Boolean) as string[]
    };
  }

  const renewsTomorrow = candidate.autoRenew;
  return {
    candidate,
    appUrl,
    benefits,
    priceLabel,
    cycleLabel,
    startDateLabel: null,
    renewalLabel,
    actionLabel: "Open Connexa",
    introLine: renewsTomorrow
      ? `Your current ${escapeHtml(candidate.packageName)} plan renews tomorrow.`
      : `Your current ${escapeHtml(candidate.packageName)} plan expires tomorrow.`,
    panelTitle: `Here's what you'll keep with ${candidate.packageName}`,
    summaryLines: [
      priceLabel ? `Current plan price: ${priceLabel}` : null,
      cycleLabel ? `Billing cycle: ${cycleLabel}` : null,
      `${renewsTomorrow ? "Renews" : "Expires"}: ${renewalLabel}`
    ].filter(Boolean) as string[]
  };
}

async function sendSubscriptionExpiryReminderEmail(payload: ExpiryReminderEmailPayload) {
  const { candidate } = payload;
  const logoPath = path.join(process.cwd(), "public", "recurvos_connexa_transparent.png");
  const expiryLabel = payload.renewalLabel ?? formatDate(candidate.periodEnd);
  const expiryHeading = candidate.autoRenew && candidate.kind === "plan" ? "PLAN RENEWAL" : "PLAN EXPIRY";
  const detailRows = [
    `Plan: ${candidate.packageName}`,
    payload.priceLabel ? `Current plan price: ${payload.priceLabel}` : null
  ].filter(Boolean) as string[];
  const nextStepCopy =
    candidate.kind === "trial"
      ? "To continue enjoying your workspace without interruption, please review your plan before the trial expiry date."
      : "To continue enjoying your benefits without interruption, please review your plan before the expiry date.";
  const bodyHtml = `
    <div style="margin:0 0 22px;padding:24px;border:1px solid rgba(45,212,191,0.28);border-radius:22px;background:linear-gradient(180deg,rgba(16,38,53,0.72),rgba(15,23,42,0.82));box-shadow:inset 0 0 0 1px rgba(34,211,238,0.06)">
      <div style="margin:0 0 8px;font-size:13px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#7debdc">${expiryHeading}</div>
      <div style="margin:0;font-size:17px;line-height:1.5;color:#e2e8f0">Expires on: <strong style="color:#ffffff">${escapeHtml(expiryLabel)}</strong></div>
    </div>
    <div style="margin:0 0 22px;padding:24px;border:1px solid rgba(148,163,184,0.24);border-radius:22px;background:linear-gradient(180deg,rgba(15,23,42,0.72),rgba(11,18,32,0.78))">
      ${detailRows
        .map(
          (line, index) =>
            `<div style="margin:${index === 0 ? "0" : "14px 0 0"};padding:${index === 0 ? "0 0 14px" : "14px 0 0"};${index < detailRows.length - 1 ? "border-bottom:1px solid rgba(148,163,184,0.14);" : ""}color:#dbe7f5;font-size:17px;line-height:1.5">${escapeHtml(
              line
            )}</div>`
        )
        .join("")}
    </div>
    <div style="margin:0 0 22px;padding:24px;border:1px solid rgba(148,163,184,0.24);border-radius:22px;background:linear-gradient(180deg,rgba(15,23,42,0.72),rgba(11,18,32,0.78))">
      <div style="margin:0 0 18px;color:#e2e8f0;font-size:17px;line-height:1.6">${escapeHtml(nextStepCopy)}</div>
      <p style="margin:0 0 4px">
        <a
          href="${payload.appUrl}"
          style="display:inline-block;min-width:180px;padding:15px 24px;border:1px solid rgba(253,224,71,0.58);border-radius:14px;background:linear-gradient(90deg,#f59e0b 0%,#f97316 50%,#ef4444 100%);box-shadow:0 14px 34px rgba(249,115,22,0.34);color:#fff7ed;text-decoration:none;font-size:16px;font-weight:700;text-align:center"
        >
          Manage Plan
        </a>
      </p>
    </div>
    <p style="margin:0;color:#cbd5e1;font-size:16px;line-height:1.7">
      If you have any questions, we're here to help.
    </p>
    <p style="margin:16px 0 0;color:#ffffff;font-size:16px;font-weight:700">
      The Connexa Team
    </p>
    <div style="margin:28px 0 0;text-align:center;color:#7debdc;font-size:20px;line-height:1">+</div>
    <p style="margin:0;color:#cbd5e1;font-size:14px">
      Review your current package and billing details in Connexa any time.
    </p>
  `;

  const subject =
    candidate.kind === "trial"
      ? "Reminder: Your Connexa trial expires tomorrow"
      : `Reminder: Your Connexa ${candidate.packageName} plan ${candidate.autoRenew ? "renews" : "expires"} tomorrow`;
  const text = [
    payload.introLine.replace(/&[#A-Za-z0-9]+;/g, ""),
    "",
    `${expiryHeading}: ${expiryLabel}`,
    ...detailRows,
    "",
    nextStepCopy,
    ...payload.benefits.map((benefit) => `- ${benefit}`),
    "",
    `Manage plan: ${payload.appUrl}`
  ].join("\n");

  const html = await renderEmailTemplate({
    preheader:
      candidate.kind === "trial"
        ? "Your Connexa free trial ends tomorrow. Continue with Starter without interruption."
        : `Your ${candidate.packageName} plan ${candidate.autoRenew ? "renews" : "expires"} tomorrow.`,
    eyebrow: candidate.kind === "trial" ? "Free trial reminder" : "Plan reminder",
    title:
      candidate.kind === "trial"
        ? "Your trial expires tomorrow"
        : `Your ${candidate.packageName} plan ${candidate.autoRenew ? "renews" : "expires"} tomorrow`,
    intro: `Hi ${escapeHtml(candidate.recipientName)},`,
    logoSrc: "cid:connexa-logo",
    introHtml: `
      <p style="margin:0 0 14px;color:#e2e8f0;font-size:18px;line-height:1.6">Hi ${escapeHtml(candidate.recipientName)},</p>
      <p style="margin:0 0 28px;color:#dbe7f5;font-size:18px;line-height:1.75">${payload.introLine}</p>
    `,
    footerNote: "This is an automated billing reminder.",
    bodyHtml
  });

  await sendEmail({
    to: candidate.recipientEmail,
    subject,
    text,
    html,
    attachments: [
      {
        filename: "recurvos_connexa_transparent.png",
        path: logoPath,
        cid: "connexa-logo"
      }
    ]
  });
}

function normalizeReminderEmail(value: string | null | undefined) {
  const email = value?.trim().toLowerCase() ?? "";
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function buildSimpleInvoicePdf(invoice: InvoiceRow) {
  const company = resolveCompanyParty(invoice.companyInformation, {
    emailBrandName: null,
    supportEmail: null,
    smtpFrom: null
  });
  const customer: DocumentParty = {
    name: invoice.customerName,
    registrationNo: null,
    email: invoice.customerEmail,
    contactNumber: null,
    addressLines: []
  };
  const context: InvoiceDocumentContext = {
    type: "invoice",
    title: "INVOICE",
    invoiceNo: invoice.invoiceNo,
    receiptNo: invoice.receiptNumber,
    orderNo: invoice.orderNo,
    issueDate: invoice.issueDate ?? invoice.createdAt,
    dueDate: invoice.dueDate,
    paymentDate: invoice.paidAt ?? invoice.paymentDate,
    paymentMethod: null,
    currency: normalizeCurrencyCode(invoice.currency),
    status: normalizeDocumentStatus(invoice.status, invoice.dueDate, toNumber(invoice.balanceAmount ?? 0)),
    company,
    customer,
    items: [
      {
        description: invoice.packageName,
        qty: 1,
        unitPrice: toNumber(invoice.totalAmount ?? invoice.amount),
        lineTotal: toNumber(invoice.totalAmount ?? invoice.amount)
      }
    ],
    summaryRows: [
      { label: "Subtotal", amount: toNumber(invoice.totalAmount ?? invoice.amount) },
      { label: "Discount", amount: 0 },
      { label: "Tax", amount: 0 },
      { label: "Total", amount: toNumber(invoice.totalAmount ?? invoice.amount), highlight: true }
    ],
    metaRows: [
      { label: "Invoice No", value: invoice.invoiceNo },
      { label: "Invoice Date", value: formatDocumentDate(invoice.issueDate ?? invoice.createdAt) },
      { label: "Due Date", value: formatDocumentDate(invoice.dueDate) },
      { label: "Currency", value: normalizeCurrencyCode(invoice.currency) }
    ],
    notes: [
      "Please include the invoice number with your payment reference.",
      "This is a system generated invoice."
    ]
  };
  return buildInvoicePdf(context);
}

export function buildInvoicePdf(context: InvoiceDocumentContext) {
  return buildBusinessDocumentPdf(context);
}

export function buildReceiptPdf(context: InvoiceDocumentContext) {
  return buildBusinessDocumentPdf(context);
}

async function writePaidInvoiceDocuments(invoice: InvoiceRow) {
  const isPaid = invoice.status === "PAID";
  const canWriteReceipt = isPaid && Boolean(invoice.receiptNumber);
  const invoiceContext = await getInvoiceDocumentContext(invoice);
  const receiptContext = buildReceiptDocumentContext(
    invoice,
    invoiceContext.company,
    invoiceContext.customer,
    invoiceContext.paymentMethod
  );
  const pdfBuffer = buildInvoicePdf(invoiceContext);
  const receiptBuffer = buildReceiptPdf(receiptContext);
  const fileName = `invoice-${invoiceContext.invoiceNo}.pdf`;
  const receiptFileName = receiptContext.receiptNo ? `receipt-${receiptContext.receiptNo}.pdf` : null;
  const pdfPath = `/uploads/invoices/${fileName}`;
  const receiptPdfPath = receiptFileName ? `/uploads/invoices/${receiptFileName}` : null;
  await mkdir(INVOICE_UPLOAD_DIR, { recursive: true });
  await writeFile(path.join(INVOICE_UPLOAD_DIR, fileName), pdfBuffer);
  if (canWriteReceipt && receiptFileName) {
    await writeFile(path.join(INVOICE_UPLOAD_DIR, receiptFileName), receiptBuffer);
  }
  await execute(
    canWriteReceipt
      ? `UPDATE "Invoice"
         SET "pdfPath" = $2,
             "invoicePdfPath" = $2,
             "receiptPdfPath" = $3,
             "paidAmount" = COALESCE("totalAmount", amount),
             "balanceAmount" = 0,
             "paidAt" = COALESCE("paidAt", "paymentDate", NOW()),
             "updatedAt" = NOW()
         WHERE id = $1`
      : `UPDATE "Invoice"
	         SET "pdfPath" = $2, "invoicePdfPath" = $2, "updatedAt" = NOW()
	         WHERE id = $1`,
    canWriteReceipt ? [invoice.id, pdfPath, receiptPdfPath] : [invoice.id, pdfPath]
  );
  return {
    pdfBuffer,
    receiptBuffer,
    fileName,
    receiptFileName,
    pdfPath,
    receiptPdfPath
  };
}

function buildBusinessDocumentPdf(context: InvoiceDocumentContext) {
  const page = { width: 595.28, height: 841.89, margin: 42.52 };
  const canvas = createPdfCanvas(page.width, page.height);
  const colors = {
    text: [0.05, 0.12, 0.3] as [number, number, number],
    label: [0.18, 0.35, 0.74] as [number, number, number],
    muted: [0.17, 0.22, 0.34] as [number, number, number],
    border: [0.79, 0.86, 0.97] as [number, number, number],
    statusFill: [0.83, 0.97, 0.84] as [number, number, number],
    statusText: [0.08, 0.57, 0.21] as [number, number, number]
  };
  const layout = {
    contentWidth: page.width - page.margin * 2,
    headerTop: 36,
    headerGap: 26,
    headerMetaWidth: 246,
    topSectionGap: 14,
    sectionGap: 16
  };
  const leftColumnX = page.margin + 8;
  const rightColumnX = page.width - page.margin - layout.headerMetaWidth;
  const companyLines = buildDocumentCompanyLines(context.company);
  const companyColumnWidth = layout.contentWidth - layout.headerMetaWidth - layout.headerGap;
  const companyNameLines = companyLines[0]
    ? wrapText(companyLines[0], companyColumnWidth - 12, 31, true)
    : [];
  const companyDetailLines = companyLines.slice(1).flatMap((line) => wrapText(line, companyColumnWidth - 12, 10.6));
  const companyNameLineHeight = 34;
  const companyDetailLineHeight = 17;

  companyNameLines.forEach((line, index) => {
    canvas.text(line, leftColumnX, layout.headerTop + 8 + index * companyNameLineHeight, {
      font: "bold",
      size: 31,
      color: colors.text
    });
  });

  const companyDetailTop =
    layout.headerTop + 8 + companyNameLines.length * companyNameLineHeight + (companyDetailLines.length ? 14 : 0);
  companyDetailLines.forEach((line, index) => {
    canvas.text(line, leftColumnX, companyDetailTop + index * companyDetailLineHeight, {
      size: 10.6,
      color: colors.muted
    });
  });

  const companyBottom =
    companyDetailLines.length > 0
      ? companyDetailTop + (companyDetailLines.length - 1) * companyDetailLineHeight + 12
      : layout.headerTop + 8 + companyNameLines.length * companyNameLineHeight;
  const metaPanelHeight = renderMetadataBox(canvas, {
    x: rightColumnX,
    top: layout.headerTop,
    width: layout.headerMetaWidth,
    title: context.title,
    rows: context.metaRows,
    colors
  });

  let cursorTop = Math.max(companyBottom, layout.headerTop + metaPanelHeight) + 24;
  const boxWidth = (layout.contentWidth - layout.topSectionGap) / 2;
  const billLines = buildBillToLines(context.customer);
  const summaryHeight = measureSummaryBoxHeight(context.summaryRows, boxWidth, context.currency);
  const billHeight = measureInfoBoxHeight(billLines, boxWidth);
  const topSectionHeight = Math.max(summaryHeight, billHeight);
  renderInfoBox(canvas, {
    x: page.margin,
    top: cursorTop,
    width: boxWidth,
    height: topSectionHeight,
    title: context.type === "receipt" ? "Received From" : "Bill To",
    lines: billLines,
    colors
  });
  renderSummaryBox(canvas, {
    x: page.margin + boxWidth + layout.topSectionGap,
    top: cursorTop,
    width: boxWidth,
    height: topSectionHeight,
    rows: context.summaryRows,
    currency: context.currency,
    colors
  });

  cursorTop += topSectionHeight + layout.sectionGap;
  cursorTop = renderItemsTable(canvas, {
    x: page.margin,
    top: cursorTop,
    width: layout.contentWidth,
    items: context.items,
    colors,
    currency: context.currency,
    type: context.type
  });

  cursorTop += 16;
  canvas.line(page.margin + 2, cursorTop, page.width - page.margin + 2, cursorTop, colors.border);
  cursorTop += 10;
  const noteLines = context.notes.flatMap((note) => wrapText(note, page.width - page.margin * 2, 10.5));
  noteLines.forEach((line, index) => {
    canvas.text(line, page.margin + 4, cursorTop + index * 17, {
      size: 10.5,
      color: colors.label
    });
  });

  return canvas.build();
}

type DocumentPalette = {
  text: [number, number, number];
  label: [number, number, number];
  muted: [number, number, number];
  border: [number, number, number];
  statusFill: [number, number, number];
  statusText: [number, number, number];
};

type DocumentBoxColors = DocumentPalette;

type DocumentTextCanvas = ReturnType<typeof createPdfCanvas>;

type DocumentTableColumn = {
  label: string;
  width: number;
  align: "left" | "right" | "center";
};

const DOCUMENT_META_LABEL_WIDTH = 84;
const DOCUMENT_META_LABEL_VALUE_GAP = 12;
const DOCUMENT_SUMMARY_LABEL_WIDTH = 116;
const DOCUMENT_SUMMARY_LABEL_VALUE_GAP = 12;
const DOCUMENT_TABLE_HORIZONTAL_PADDING = 16;
const DOCUMENT_TABLE_CELL_PADDING = 8;

function getFixedColumns(totalWidth: number, definitions: Array<{ label: string; width: number; align: "left" | "right" | "center" }>) {
  let consumedWidth = 0;

  return definitions.map((definition, index) => {
    const width =
      index === definitions.length - 1
        ? totalWidth - consumedWidth
        : definition.width;
    consumedWidth += width;
    return {
      label: definition.label,
      width,
      align: definition.align
    } satisfies DocumentTableColumn;
  });
}

function getColumnRightEdge(startX: number, columns: DocumentTableColumn[], index: number) {
  return startX + columns.slice(0, index + 1).reduce((sum, column) => sum + column.width, 0) - DOCUMENT_TABLE_CELL_PADDING;
}

function renderMetadataBox(
  canvas: DocumentTextCanvas,
  input: {
    x: number;
    top: number;
    width: number;
    title: string;
    rows: Array<{ label: string; value: string }>;
    colors: DocumentBoxColors;
  }
) {
  const paddingX = 16;
  const labelWidth = DOCUMENT_META_LABEL_WIDTH;
  const labelValueGap = DOCUMENT_META_LABEL_VALUE_GAP;
  const valueWidth = Math.max(96, input.width - paddingX * 2 - labelWidth - labelValueGap);
  const labelX = input.x + paddingX;
  const valueRightX = labelX + labelWidth + labelValueGap + valueWidth;
  const headingTop = input.top + 16;
  const dividerTop = input.top + 64;
  const rowStartTop = dividerTop + 20;
  const rowHeights = input.rows.map((row) => {
    const valueLines = wrapIdentifierText(row.value, valueWidth, 10.8);
    return Math.max(28, valueLines.length * 14 + 8);
  });
  const panelHeight = rowStartTop - input.top + rowHeights.reduce((sum, height) => sum + height, 0) + 12;
  canvas.rect(input.x, input.top, input.width, panelHeight, input.colors.border);
  canvas.text(input.title, input.x + input.width - paddingX, headingTop, {
    align: "right",
    font: "bold",
    size: 34,
    color: input.colors.text
  });
  canvas.line(input.x + paddingX, dividerTop, input.x + input.width - paddingX, dividerTop, input.colors.border);

  let rowTop = rowStartTop;
  input.rows.forEach((row, index) => {
    const valueLines = wrapIdentifierText(row.value, valueWidth, 10.8);
    canvas.text(row.label, labelX, rowTop, { size: 10.8, color: input.colors.label });
    valueLines.forEach((line, lineIndex) => {
      canvas.text(line, valueRightX, rowTop + lineIndex * 14, {
        size: 10.8,
        color: input.colors.text,
        align: "right"
      });
    });
    rowTop += rowHeights[index] ?? 24;
  });
  return panelHeight;
}

function renderInfoBox(
  canvas: DocumentTextCanvas,
  input: {
    x: number;
    top: number;
    width: number;
    height: number;
    title: string;
    lines: string[];
    colors: DocumentBoxColors;
  }
) {
  canvas.rect(input.x, input.top, input.width, input.height, input.colors.border);
  canvas.text(input.title, input.x + 18, input.top + 20, {
    font: "bold",
    size: 11.5,
    color: input.colors.label
  });
  let lineTop = input.top + 56;
  input.lines.forEach((line, index) => {
    const fontSize = index === 0 ? 12.5 : 10.8;
    const wrappedLines = wrapText(line, input.width - 36, fontSize, index === 0);
    wrappedLines.forEach((wrappedLine, wrappedIndex) => {
      canvas.text(wrappedLine, input.x + 18, lineTop + wrappedIndex * 15, {
        size: fontSize,
        color: input.colors.text,
        font: index === 0 ? "bold" : "regular"
      });
    });
    lineTop += wrappedLines.length * 15 + 2;
  });
}

function renderSummaryBox(
  canvas: DocumentTextCanvas,
  input: {
    x: number;
    top: number;
    width: number;
    height: number;
    rows: DocumentAmountRow[];
    currency: string;
    colors: DocumentBoxColors;
  }
) {
  canvas.rect(input.x, input.top, input.width, input.height, input.colors.border);
  const paddingX = 16;
  const labelWidth = DOCUMENT_SUMMARY_LABEL_WIDTH;
  const valueWidth = input.width - paddingX * 2 - labelWidth - DOCUMENT_SUMMARY_LABEL_VALUE_GAP;
  const labelX = input.x + paddingX;
  const valueRightX = labelX + labelWidth + DOCUMENT_SUMMARY_LABEL_VALUE_GAP + valueWidth;
  canvas.text("Summary", input.x + paddingX, input.top + 20, {
    font: "bold",
    size: 11.5,
    color: input.colors.label
  });
  let rowTop = input.top + 58;
  input.rows.forEach((row, index) => {
    const isReceiptStatus = row.label === "Payment Status";
    const isTotalRow = row.highlight;
    const valueText = row.text ?? formatMoney(row.amount ?? 0, input.currency);
    const valueLines = wrapIdentifierText(valueText, valueWidth, 10.8, Boolean(isTotalRow));
    canvas.text(row.label, labelX, rowTop, {
      size: 10.8,
      color: isTotalRow ? input.colors.text : input.colors.muted,
      font: isTotalRow ? "bold" : "regular"
    });
    valueLines.forEach((line, lineIndex) => {
      canvas.text(line, valueRightX, rowTop + lineIndex * 14, {
        size: 10.8,
        color: input.colors.text,
        font: isTotalRow ? "bold" : "regular",
        align: "right"
      });
    });
    rowTop += Math.max(28, valueLines.length * 14 + 8);
    if ((input.rows.length === 4 && index === 0 && !isReceiptStatus) || (input.rows.length === 4 && index === 1 && isReceiptStatus)) {
      canvas.line(input.x + paddingX, rowTop - 10, input.x + input.width - paddingX, rowTop - 10, input.colors.border);
      rowTop += 2;
    }
  });
}

function renderItemsTable(
  canvas: DocumentTextCanvas,
  input: {
    x: number;
    top: number;
    width: number;
    items: DocumentItem[];
    colors: DocumentBoxColors;
    currency: string;
    type: "invoice" | "receipt";
  }
) {
  const horizontalPadding = DOCUMENT_TABLE_HORIZONTAL_PADDING;
  const usableWidth = input.width - horizontalPadding * 2;
  const columns = input.type === "invoice"
    ? getFixedColumns(usableWidth, [
        { label: "Description", width: Math.floor(usableWidth * 0.49), align: "left" },
        { label: "Qty", width: Math.floor(usableWidth * 0.07), align: "right" },
        { label: "Unit Price", width: Math.floor(usableWidth * 0.20), align: "right" },
        { label: "Line Total", width: 0, align: "right" }
      ])
    : getFixedColumns(usableWidth, [
        { label: "Description", width: Math.floor(usableWidth * 0.58), align: "left" },
        { label: "Payment Status", width: Math.floor(usableWidth * 0.16), align: "center" },
        { label: "Amount", width: 0, align: "right" }
      ]);
  const totalWidth = usableWidth;
  const startX = input.x + horizontalPadding;
  const lastColumnRightEdge = getColumnRightEdge(startX, columns, columns.length - 1);
  const title = input.type === "invoice" ? "Invoice Items" : "Receipt Items";
  const headerTop = input.top + 34;
  const rowHeights = input.items.map((item) => {
    const descriptionLines = wrapText(item.description, columns[0].width - DOCUMENT_TABLE_CELL_PADDING * 2, 10.5);
    const amountValue = input.type === "invoice"
      ? formatMoney(item.lineTotal, input.currency)
      : formatMoney(item.lineTotal, input.currency);
    const amountLines = wrapIdentifierText(
      amountValue,
      columns[columns.length - 1].width - DOCUMENT_TABLE_CELL_PADDING * 2,
      10.5
    );
    return Math.max(30, Math.max(descriptionLines.length, amountLines.length) * 14 + 10);
  });
  const rowsHeight = rowHeights.reduce((sum, height) => sum + height, 0);
  const panelHeight = Math.max(138, 34 + 18 + 12 + rowsHeight + 34);
  canvas.rect(input.x, input.top, input.width, panelHeight, input.colors.border);
  canvas.text(title, input.x + 16, input.top + 20, {
    font: "bold",
    size: 11.5,
    color: input.colors.label
  });

  let currentX = startX;
  columns.forEach((column) => {
    canvas.text(
      column.label,
      column.align === "right"
        ? currentX + column.width - DOCUMENT_TABLE_CELL_PADDING
        : column.align === "center"
          ? currentX + column.width / 2
          : currentX + DOCUMENT_TABLE_CELL_PADDING,
      headerTop,
      {
        font: "regular",
        size: 10.6,
        color: input.colors.label,
        align: column.align === "right" ? "right" : column.align === "center" ? "center" : "left"
      }
    );
    currentX += column.width;
  });
  canvas.line(startX, headerTop + 18, startX + totalWidth, headerTop + 18, input.colors.border);

  let rowTop = headerTop + 34;
  input.items.forEach((item, index) => {
    const descriptionLines = wrapText(item.description, columns[0].width - DOCUMENT_TABLE_CELL_PADDING * 2, 10.5);
    const rowHeight = rowHeights[index] ?? Math.max(28, descriptionLines.length * 14 + 8);
    let rowX = startX;
    descriptionLines.forEach((line, index) => {
      canvas.text(line, rowX + DOCUMENT_TABLE_CELL_PADDING, rowTop + 2 + index * 14, { size: 10.5, color: input.colors.text });
    });
    rowX += columns[0].width;
    if (input.type === "invoice") {
      const qtyValue = Number.isInteger(item.qty) ? String(item.qty) : item.qty.toFixed(2);
      canvas.text(qtyValue, rowX + columns[1].width - DOCUMENT_TABLE_CELL_PADDING, rowTop + 2, {
        size: 10.5,
        color: input.colors.text,
        align: "right"
      });
      rowX += columns[1].width;
      renderRightAlignedWrappedText(
        canvas,
        formatMoney(item.unitPrice, input.currency),
        rowX + columns[2].width - DOCUMENT_TABLE_CELL_PADDING,
        rowTop + 2,
        columns[2].width - DOCUMENT_TABLE_CELL_PADDING * 2,
        {
        size: 10.5,
        color: input.colors.text
      });
      rowX += columns[2].width;
      renderRightAlignedWrappedText(
        canvas,
        formatMoney(item.lineTotal, input.currency),
        rowX + columns[3].width - DOCUMENT_TABLE_CELL_PADDING,
        rowTop + 2,
        columns[3].width - DOCUMENT_TABLE_CELL_PADDING * 2,
        {
        size: 10.5,
        color: input.colors.text
      });
    } else {
      canvas.text("PAID", rowX + columns[1].width / 2, rowTop + 2, {
        size: 10.5,
        color: input.colors.text,
        align: "center"
      });
      rowX += columns[1].width;
      renderRightAlignedWrappedText(canvas, formatMoney(item.lineTotal, input.currency), rowX + columns[2].width - DOCUMENT_TABLE_CELL_PADDING, rowTop + 2, columns[2].width - DOCUMENT_TABLE_CELL_PADDING * 2, {
        size: 10.5,
        color: input.colors.text
      });
    }
    rowTop += rowHeight;
  });
  canvas.line(startX, rowTop + 4, startX + totalWidth, rowTop + 4, input.colors.border);
  const totalLabel = input.type === "invoice" ? "Total" : "Total Received:";
  const totalText = formatMoney(input.items.reduce((sum, item) => sum + item.lineTotal, 0), input.currency);
  const totalValueWidth = estimateTextWidth(totalText, 11.5, true);
  const totalAmountLeftX = lastColumnRightEdge - totalValueWidth;
  canvas.text(totalLabel, totalAmountLeftX - 12, rowTop + 24, {
    font: "bold",
    size: 11.5,
    color: input.colors.text,
    align: "right"
  });
  canvas.text(totalText, lastColumnRightEdge, rowTop + 24, {
    font: "bold",
    size: 11.5,
    color: input.colors.text,
    align: "right"
  });
  return input.top + panelHeight;
}

function measureInfoBoxHeight(lines: string[], width: number) {
  let contentHeight = 56;
  lines.forEach((line, index) => {
    const fontSize = index === 0 ? 12.5 : 10.8;
    const wrappedLines = wrapText(line, width - 36, fontSize, index === 0);
    contentHeight += wrappedLines.length * 15 + 2;
  });
  return Math.max(148, contentHeight + 8);
}

function measureSummaryBoxHeight(rows: DocumentAmountRow[], width: number, currency: string) {
  let contentHeight = 58;
  const valueWidth = width - 16 * 2 - DOCUMENT_SUMMARY_LABEL_WIDTH - DOCUMENT_SUMMARY_LABEL_VALUE_GAP;
  rows.forEach((row) => {
    const valueText = row.text ?? formatMoney(row.amount ?? 0, currency);
    const valueLines = wrapIdentifierText(valueText, valueWidth, 10.8, Boolean(row.highlight));
    contentHeight += Math.max(28, valueLines.length * 14 + 8);
  });
  return Math.max(148, contentHeight + 8);
}

function createPdfCanvas(pageWidth: number, pageHeight: number) {
  const commands: string[] = [];
  const toPdfY = (top: number, height = 0) => pageHeight - top - height;

  return {
    text(value: string, x: number, top: number, options?: {
      size?: number;
      font?: "regular" | "bold";
      color?: [number, number, number];
      align?: "left" | "right" | "center";
    }) {
      if (!value) return;
      const size = options?.size ?? 11;
      const font = options?.font === "bold" ? "F2" : "F1";
      const color = options?.color ?? [0, 0, 0];
      const width = estimateTextWidth(value, size, options?.font === "bold");
      const alignedX =
        options?.align === "right"
          ? x - width
          : options?.align === "center"
            ? x - width / 2
            : x;
      commands.push(
        `BT /${font} ${size} Tf ${color.join(" ")} rg 1 0 0 1 ${alignedX.toFixed(2)} ${toPdfY(top, size).toFixed(2)} Tm (${escapePdfText(value)}) Tj ET`
      );
    },
    rect(x: number, top: number, width: number, height: number, color: [number, number, number]) {
      commands.push(`${color.join(" ")} RG 1 w ${x.toFixed(2)} ${toPdfY(top, height).toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re S`);
    },
    fillRect(x: number, top: number, width: number, height: number, color: [number, number, number]) {
      commands.push(`${color.join(" ")} rg ${x.toFixed(2)} ${toPdfY(top, height).toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re f`);
    },
    line(x1: number, top1: number, x2: number, top2: number, color: [number, number, number]) {
      commands.push(`${color.join(" ")} RG 1 w ${x1.toFixed(2)} ${toPdfY(top1).toFixed(2)} m ${x2.toFixed(2)} ${toPdfY(top2).toFixed(2)} l S`);
    },
    build() {
      const stream = commands.join("\n");
      const objects = [
        "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
        "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
        `3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >> endobj`,
        "4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
        "5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >> endobj",
        `6 0 obj << /Length ${Buffer.byteLength(stream)} >> stream\n${stream}\nendstream endobj`
      ];
      let body = "%PDF-1.4\n";
      const offsets = [0];
      for (const object of objects) {
        offsets.push(Buffer.byteLength(body));
        body += `${object}\n`;
      }
      const xrefOffset = Buffer.byteLength(body);
      body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
      body += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
      body += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
      return Buffer.from(body);
    }
  };
}

function formatTransactionType(value: string) {
  return value.toLowerCase().replaceAll("_", " ");
}

function titleCase(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function normalizeSubscriptionStatus(value: string) {
  if (value === "TRIAL") return "free_trial";
  if (value === "PAST_DUE") return "grace_period";
  if (value === "CANCELLED") return "cancelled";
  if (value === "EXPIRED") return "expired";
  return "active";
}

function formatMoney(amount: number, currency: string) {
  return `${normalizeCurrencyCode(currency)} ${amount.toFixed(2)}`;
}

function renderRightAlignedWrappedText(
  canvas: DocumentTextCanvas,
  value: string,
  rightX: number,
  top: number,
  maxWidth: number,
  options: {
    size: number;
    color: [number, number, number];
    font?: "regular" | "bold";
  }
) {
  const lines = wrapIdentifierText(value, maxWidth, options.size, options.font === "bold");
  lines.forEach((line, index) => {
    canvas.text(line, rightX, top + index * 14, {
      size: options.size,
      color: options.color,
      font: options.font,
      align: "right"
    });
  });
}

function formatDate(value: Date | null) {
  if (!value) {
    return "N/A";
  }

  return new Intl.DateTimeFormat("en-MY", {
    year: "numeric",
    month: "short",
    day: "numeric"
  }).format(value);
}

function formatDocumentDate(value: Date | null) {
  return formatDate(value);
}

function formatDocumentDateTime(value: Date | null) {
  if (!value) {
    return "N/A";
  }
  return new Intl.DateTimeFormat("en-MY", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(value);
}

function normalizeCurrencyCode(value: string | null | undefined) {
  return !value || value === "RM" ? "MYR" : value;
}

function normalizePaymentMethod(value: string | null | undefined) {
  if (!value) return null;
  return titleCase(value);
}

function formatBillingPeriodLabel(value: string | null | undefined) {
  if (value === "YEARLY") return "Yearly";
  if (value === "MONTHLY") return "Monthly";
  return "Subscription";
}

function normalizeDocumentStatus(status: string, dueDate: Date | null, balanceAmount: number) {
  if (status === "PAID") return "PAID";
  if (status === "CANCELLED") return "CANCELLED";
  if (status === "VOID" || status === "REFUNDED") return "VOID";
  if (balanceAmount > 0 && dueDate && dueDate.getTime() < Date.now()) return "OVERDUE";
  return balanceAmount > 0 ? "OPEN" : titleCase(status);
}

function buildReceiptNumber(invoiceNo: string) {
  return invoiceNo.startsWith("INV-") ? invoiceNo.replace(/^INV-/, "RCT-") : `RCT-${invoiceNo}`;
}

function resolveCompanyParty(
  companyInformation: string | null | undefined,
  emailConfig: { emailBrandName?: string | null; supportEmail?: string | null; smtpFrom?: string | null }
): DocumentParty {
  const parsed = parseStructuredInfo(companyInformation);
  const addressLines = parsed.addressLines.length ? parsed.addressLines : [];
  return {
    name: normalizeDocumentCompanyName(
      parsed.name ?? normalizeNullableText(companyInformation) ?? normalizeNullableText(emailConfig.emailBrandName)
    ),
    registrationNo: parsed.registrationNo,
    email: parsed.email ?? normalizeNullableText(emailConfig.supportEmail) ?? normalizeNullableText(emailConfig.smtpFrom),
    contactNumber: parsed.contactNumber,
    addressLines
  };
}

function normalizeDocumentCompanyName(value: string | null | undefined) {
  const name = normalizeNullableText(value);
  if (!name) return DOCUMENT_COMPANY_NAME;
  return name.toLowerCase() === "connexa" ? DOCUMENT_COMPANY_NAME : name;
}

function parseStructuredInfo(value: string | null | undefined) {
  const empty = {
    name: null as string | null,
    registrationNo: null as string | null,
    email: null as string | null,
    contactNumber: null as string | null,
    addressLines: [] as string[]
  };
  const text = normalizeNullableText(value);
  if (!text) return empty;
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    return {
      name: normalizeNullableText(asString(parsed.name)),
      registrationNo: normalizeNullableText(
        asString(parsed.registrationNo ?? parsed.registration_number ?? parsed.taxId ?? parsed.tax_id)
      ),
      email: normalizeNullableText(asString(parsed.email)),
      contactNumber: normalizeNullableText(asString(parsed.contactNumber ?? parsed.phone)),
      addressLines: collectAddressLines(parsed)
    };
  } catch {
    return {
      ...empty,
      name: text
    };
  }
}

function collectAddressLines(parsed: Record<string, unknown>) {
  const addressCandidate = parsed.addressLines;
  if (Array.isArray(addressCandidate)) {
    return addressCandidate.map((item) => normalizeNullableText(asString(item))).filter(Boolean) as string[];
  }
  const single = normalizeNullableText(asString(parsed.address));
  return single ? [single] : [];
}

function resolveCustomerParty(
  customerInformation: string | null | undefined,
  billingProfile: BillingProfileRow | null,
  fallback: {
    fallbackName: string | null | undefined;
    fallbackEmail: string | null | undefined;
    fallbackContactNumber?: string | null;
    fallbackAddress?: string | null;
  }
): DocumentParty {
  const parsed = parseStructuredInfo(customerInformation);
  const hasSnapshot =
    parsed.name ||
    parsed.registrationNo ||
    parsed.email ||
    parsed.contactNumber ||
    parsed.addressLines.length > 0;

  if (hasSnapshot) {
    return {
      name: parsed.name ?? normalizeNullableText(fallback.fallbackName),
      registrationNo: parsed.registrationNo,
      email: parsed.email ?? normalizeNullableText(fallback.fallbackEmail),
      contactNumber: parsed.contactNumber ?? normalizeNullableText(fallback.fallbackContactNumber),
      addressLines: parsed.addressLines.length
        ? parsed.addressLines
        : fallback.fallbackAddress
          ? [fallback.fallbackAddress]
          : []
    };
  }

  if (billingProfile) {
    return buildDocumentPartyFromBillingProfile(billingProfile);
  }

  return {
    name: normalizeNullableText(fallback.fallbackName),
    registrationNo: null,
    email: normalizeNullableText(fallback.fallbackEmail),
    contactNumber: normalizeNullableText(fallback.fallbackContactNumber),
    addressLines: fallback.fallbackAddress ? [fallback.fallbackAddress] : []
  };
}

function buildDocumentPartyFromBillingProfile(profile: BillingProfileRow): DocumentParty {
  return {
    name: profile.billingName,
    registrationNo: profile.taxNumber ?? null,
    email: profile.billingEmail,
    contactNumber: profile.contactNumber,
    addressLines: buildBillingAddressLines({
      billingName: profile.billingName,
      billingPhoneNumber: profile.contactNumber,
      billingAddressLine1: profile.billingAddress1,
      billingAddressLine2: profile.billingAddress2 ?? "",
      billingCity: profile.billingCity,
      billingState: profile.billingState,
      billingPostcode: profile.billingPostcode,
      billingCountry: profile.billingCountry,
      billingTaxId: profile.taxNumber ?? ""
    })
  };
}

async function buildWorkspaceCustomerInformation(workspaceId: string, executor?: DbExecutor) {
  const profile = await getBillingProfile(workspaceId, executor);
  return profile ? serializeBillingProfile(profile) : null;
}

function serializeBillingProfile(profile: {
  billingName: string;
  billingEmail: string;
  contactNumber: string;
  billingAddress1: string;
  billingAddress2: string | null;
  billingCity: string;
  billingState: string;
  billingPostcode: string;
  billingCountry: string;
  taxNumber: string | null;
}) {
  return JSON.stringify({
    name: profile.billingName,
    registrationNo: profile.taxNumber ?? null,
    email: profile.billingEmail,
    contactNumber: profile.contactNumber,
    addressLines: buildBillingAddressLines({
      billingName: profile.billingName,
      billingPhoneNumber: profile.contactNumber,
      billingAddressLine1: profile.billingAddress1,
      billingAddressLine2: profile.billingAddress2 ?? "",
      billingCity: profile.billingCity,
      billingState: profile.billingState,
      billingPostcode: profile.billingPostcode,
      billingCountry: profile.billingCountry,
      billingTaxId: profile.taxNumber ?? ""
    })
  });
}

export function serializeBillingDetailsForInvoice(
  details: BillingDetails,
  billingEmail?: string | null
) {
  return JSON.stringify({
    name: details.billingName,
    registrationNo: normalizeNullableText(details.billingTaxId),
    email: normalizeNullableText(billingEmail),
    contactNumber: details.billingPhoneNumber,
    addressLines: buildBillingAddressLines(details)
  });
}

function buildBillingAddressLines(details: BillingDetails) {
  const cityLine = [details.billingPostcode, details.billingCity].filter(Boolean).join(" ");
  return [
    normalizeNullableText(details.billingAddressLine1),
    normalizeNullableText(details.billingAddressLine2),
    normalizeNullableText(cityLine),
    normalizeNullableText(details.billingState),
    normalizeNullableText(details.billingCountry)
  ].filter(Boolean) as string[];
}

function asString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function normalizeNullableText(value: string | null | undefined) {
  const text = value?.trim();
  return text ? text : null;
}

function buildPartyLines(party: DocumentParty, options: { includeContact: boolean }) {
  const lines = [
    party.name,
    party.registrationNo ? `Registration No: ${party.registrationNo}` : null,
    party.email ? `Email: ${party.email}` : null,
    options.includeContact && party.contactNumber ? `Phone: ${party.contactNumber}` : null,
    ...party.addressLines
  ];
  return lines.filter(Boolean) as string[];
}

function buildBillToLines(party: DocumentParty) {
  const addressLines = party.addressLines.length ? party.addressLines : ["-"];
  const lines = [
    party.name,
    party.email ? `Email: ${party.email}` : "Email: -",
    party.contactNumber ? `Phone: ${party.contactNumber}` : null,
    ...addressLines.map((line, index) => index === 0 ? `Address: ${line}` : line),
    party.registrationNo ? `Tax ID / SST: ${party.registrationNo}` : null
  ];
  return lines.filter(Boolean) as string[];
}

function buildDocumentCompanyLines(party: DocumentParty) {
  return [
    party.name,
    party.registrationNo ? `Registration No: ${party.registrationNo}` : null,
    party.email ? `Email: ${party.email}` : null,
    ...party.addressLines
  ].filter(Boolean) as string[];
}

function wrapText(value: string, maxWidth: number, fontSize: number, isBold = false) {
  const words = value.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (estimateTextWidth(word, fontSize, isBold) > maxWidth) {
      if (current) {
        lines.push(current);
        current = "";
      }
      const fragments = splitLongToken(word, maxWidth, fontSize, isBold);
      if (fragments.length > 1) {
        lines.push(...fragments.slice(0, -1));
        current = fragments[fragments.length - 1] ?? "";
        continue;
      }
    }
    const next = current ? `${current} ${word}` : word;
    if (estimateTextWidth(next, fontSize, isBold) <= maxWidth || !current) {
      current = next;
      continue;
    }
    lines.push(current);
    current = word;
  }
  if (current) lines.push(current);
  return lines.length ? lines : [value];
}

function wrapIdentifierText(value: string, maxWidth: number, fontSize: number, isBold = false) {
  const normalized = value.trim();
  if (!normalized) return [value];
  if (estimateTextWidth(normalized, fontSize, isBold) <= maxWidth) {
    return [normalized];
  }
  if (normalized.includes("-")) {
    const lines: string[] = [];
    let current = "";
    for (const part of normalized.split(/(?<=-)/)) {
      const next = `${current}${part}`;
      if (current && estimateTextWidth(next, fontSize, isBold) > maxWidth) {
        lines.push(current);
        current = part;
        continue;
      }
      current = next;
    }
    if (current) lines.push(current);
    return lines.flatMap((line) =>
      estimateTextWidth(line, fontSize, isBold) > maxWidth
        ? splitLongToken(line, maxWidth, fontSize, isBold)
        : [line]
    );
  }
  return splitLongToken(normalized, maxWidth, fontSize, isBold);
}

function splitLongToken(value: string, maxWidth: number, fontSize: number, isBold: boolean) {
  const fragments: string[] = [];
  let current = "";
  for (const character of value) {
    const next = `${current}${character}`;
    if (current && estimateTextWidth(next, fontSize, isBold) > maxWidth) {
      fragments.push(current);
      current = character;
      continue;
    }
    current = next;
  }
  if (current) fragments.push(current);
  return fragments;
}

function estimateTextWidth(value: string, fontSize: number, isBold: boolean) {
  return value.length * fontSize * (isBold ? 0.56 : 0.52);
}

function escapePdfText(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
