import { randomUUID } from "node:crypto";
import { type DbExecutor, queryOne } from "@/lib/db";
import { getResolvedPublicPackageDefinition } from "@/lib/platform-packages";
import { getPackageChargeAmount, normalizePackageBillingPeriod, PACKAGE_BILLING_PERIOD } from "@/lib/package-pricing";
import type { PublicPackageKey } from "@/lib/public-packages";

export const BillingPeriod = {
  MONTHLY: "MONTHLY",
  YEARLY: "YEARLY"
} as const;

export type BillingPeriod = (typeof BillingPeriod)[keyof typeof BillingPeriod];

export const SubscriptionStatus = {
  PENDING: "PENDING",
  TRIAL: "TRIAL",
  ACTIVE: "ACTIVE",
  PAST_DUE: "PAST_DUE",
  CANCELLED: "CANCELLED",
  EXPIRED: "EXPIRED"
} as const;

export type SubscriptionStatus = (typeof SubscriptionStatus)[keyof typeof SubscriptionStatus];

export const PaymentStatus = {
  PENDING: "PENDING",
  PAID: "PAID",
  FAILED: "FAILED",
  REFUNDED: "REFUNDED"
} as const;

export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

export function getSubscriptionStatusForNewWorkspace(hasTrial: boolean): SubscriptionStatus {
  return hasTrial ? SubscriptionStatus.TRIAL : SubscriptionStatus.ACTIVE;
}

export async function recordWorkspacePayment(input: {
  workspaceId: string;
  subscriptionId: string;
  invoiceId?: string | null;
  transactionId?: string | null;
  amount: number;
  currency?: string;
  provider?: string | null;
  providerReference?: string | null;
  paymentMethod?: string | null;
  receiptNumber?: string | null;
  receiptIssuedAt?: Date | null;
  failureReason?: string | null;
  gatewayResponseJson?: string | null;
  status: PaymentStatus;
  paidAt?: Date | null;
  executor?: DbExecutor;
}) {
  return queryOne(
    `INSERT INTO "PaymentTransaction" (
       id, "subscriptionId", "workspaceId", "invoiceId", "transactionId", amount, currency, status,
       provider, "providerReference", "paymentMethod", "receiptNumber", "receiptIssuedAt",
       "failureReason", "gatewayResponseJson", "paidAt", "createdAt", "updatedAt"
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW(), NOW())
     ON CONFLICT ("transactionId") DO UPDATE SET
       "invoiceId" = COALESCE(EXCLUDED."invoiceId", "PaymentTransaction"."invoiceId"),
       amount = EXCLUDED.amount,
       currency = EXCLUDED.currency,
       status = EXCLUDED.status,
       provider = COALESCE(EXCLUDED.provider, "PaymentTransaction".provider),
       "providerReference" = COALESCE(EXCLUDED."providerReference", "PaymentTransaction"."providerReference"),
       "paymentMethod" = COALESCE(EXCLUDED."paymentMethod", "PaymentTransaction"."paymentMethod"),
       "receiptNumber" = COALESCE(EXCLUDED."receiptNumber", "PaymentTransaction"."receiptNumber"),
       "receiptIssuedAt" = COALESCE(EXCLUDED."receiptIssuedAt", "PaymentTransaction"."receiptIssuedAt"),
       "failureReason" = COALESCE(EXCLUDED."failureReason", "PaymentTransaction"."failureReason"),
       "gatewayResponseJson" = COALESCE(EXCLUDED."gatewayResponseJson", "PaymentTransaction"."gatewayResponseJson"),
       "paidAt" = COALESCE(EXCLUDED."paidAt", "PaymentTransaction"."paidAt"),
       "updatedAt" = NOW()
     RETURNING *`,
    [
      randomUUID().replace(/-/g, ""),
      input.subscriptionId,
      input.workspaceId,
      input.invoiceId ?? null,
      input.transactionId ?? input.providerReference ?? null,
      input.amount,
      input.currency ?? "MYR",
      input.status,
      input.provider ?? null,
      input.providerReference ?? null,
      input.paymentMethod ?? input.provider ?? null,
      input.receiptNumber ?? null,
      input.receiptIssuedAt ?? null,
      input.failureReason ?? null,
      input.gatewayResponseJson ?? null,
      input.paidAt ?? null
    ],
    input.executor
  );
}

export async function getPackageBillingSnapshot(
  packageKey: PublicPackageKey,
  billingPeriod: string = PACKAGE_BILLING_PERIOD.MONTHLY
) {
  const pkg = await getResolvedPublicPackageDefinition(packageKey);
  const selectedBillingPeriod = normalizePackageBillingPeriod(billingPeriod);

  return {
    code: pkg.code,
    name: pkg.name,
    description: pkg.summary,
    monthlyPriceAmount: pkg.monthlyPriceAmount,
    yearlyDiscountPercentage: pkg.yearlyDiscountPercentage,
    priceAmount: getPackageChargeAmount({
      monthlyPriceAmount: pkg.monthlyPriceAmount,
      yearlyDiscountPercentage: pkg.yearlyDiscountPercentage,
      billingPeriod: selectedBillingPeriod,
      currency: pkg.currency
    }),
    currency: pkg.currency,
    packageBillingPeriod: pkg.billingPeriod,
    billingPeriod: selectedBillingPeriod
  };
}

export function normalizeWorkspacePackageKey(plan: string | null | undefined): PublicPackageKey {
  const normalized = plan?.trim().toLowerCase();

  if (normalized === "professional" || normalized === "growth" || normalized === "enterprise") {
    return normalized;
  }

  return "starter";
}
