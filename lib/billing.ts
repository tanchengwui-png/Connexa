import { randomUUID } from "node:crypto";
import { type DbExecutor, queryOne } from "@/lib/db";
import { getResolvedPublicPackageDefinition } from "@/lib/platform-packages";
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
  amount: number;
  currency?: string;
  provider?: string | null;
  providerReference?: string | null;
  status: PaymentStatus;
  paidAt?: Date | null;
  executor?: DbExecutor;
}) {
  return queryOne(
    `INSERT INTO "PaymentTransaction" (
       id, "subscriptionId", "workspaceId", amount, currency, status, provider, "providerReference", "paidAt", "createdAt", "updatedAt"
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
     RETURNING *`,
    [
      randomUUID().replace(/-/g, ""),
      input.subscriptionId,
      input.workspaceId,
      input.amount,
      input.currency ?? "MYR",
      input.status,
      input.provider ?? null,
      input.providerReference ?? null,
      input.paidAt ?? null
    ],
    input.executor
  );
}

export async function getPackageBillingSnapshot(packageKey: PublicPackageKey) {
  const pkg = await getResolvedPublicPackageDefinition(packageKey);

  return {
    code: pkg.code,
    name: pkg.name,
    description: pkg.summary,
    priceAmount: pkg.priceAmount,
    currency: pkg.currency,
    billingPeriod: pkg.billingPeriod
  };
}

export function normalizeWorkspacePackageKey(plan: string | null | undefined): PublicPackageKey {
  const normalized = plan?.trim().toLowerCase();

  if (normalized === "professional" || normalized === "growth" || normalized === "enterprise") {
    return normalized;
  }

  return "starter";
}
