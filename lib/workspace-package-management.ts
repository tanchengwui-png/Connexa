import { PACKAGE_BILLING_PERIOD, type PackageBillingPeriod } from "@/lib/package-pricing";

type PendingPlanChangeLike = {
  status: string;
  billingPeriod: string | null;
};

type WorkspacePackagePricingLike = {
  pricing: {
    monthly: {
      formattedPrice: string;
    };
    yearly: {
      discountPercentage: number;
      payablePriceAmount: number | null;
      formattedBasePrice: string;
      formattedPayablePrice: string;
      formattedEffectiveMonthlyPrice: string;
    };
  };
};

export function getDefaultWorkspacePackageBillingPeriod(input: {
  currentBillingPeriod?: string | null;
  pendingPlanChanges?: PendingPlanChangeLike[];
}) {
  const activePlanChange = input.pendingPlanChanges?.find((planChange) =>
    planChange.status === "ISSUED" ||
    planChange.status === "PAYMENT_PROCESSING" ||
    planChange.status === "PAYMENT_FAILED" ||
    planChange.status === "SCHEDULED"
  );
  const preferredPeriod = activePlanChange?.billingPeriod ?? input.currentBillingPeriod ?? null;
  return normalizeWorkspacePackageBillingPeriod(preferredPeriod);
}

export function normalizeWorkspacePackageBillingPeriod(
  value: string | null | undefined
): PackageBillingPeriod {
  return value?.trim().toUpperCase() === PACKAGE_BILLING_PERIOD.YEARLY
    ? PACKAGE_BILLING_PERIOD.YEARLY
    : PACKAGE_BILLING_PERIOD.MONTHLY;
}

export function formatWorkspacePackageBillingPeriodLabel(
  billingPeriod: PackageBillingPeriod
) {
  return billingPeriod === PACKAGE_BILLING_PERIOD.YEARLY ? "Yearly" : "Monthly";
}

export function buildWorkspacePackagePricingView(
  option: WorkspacePackagePricingLike,
  billingPeriod: PackageBillingPeriod
) {
  const isYearly = billingPeriod === PACKAGE_BILLING_PERIOD.YEARLY;
  const effectiveMonthlyPrice = stripBillingSuffix(option.pricing.yearly.formattedEffectiveMonthlyPrice);
  const hasYearlyDiscount =
    isYearly &&
    option.pricing.yearly.payablePriceAmount !== null &&
    option.pricing.yearly.discountPercentage > 0;

  return {
    isYearly,
    displayPrice: stripBillingSuffix(
      isYearly ? option.pricing.yearly.formattedPayablePrice : option.pricing.monthly.formattedPrice
    ),
    pricePeriodLabel: isYearly ? "Billed yearly" : "Billed monthly",
    yearlyOriginalPrice: hasYearlyDiscount
      ? stripBillingSuffix(option.pricing.yearly.formattedBasePrice)
      : null,
    yearlySavingsLabel: hasYearlyDiscount
      ? `Save ${trimTrailingZero(option.pricing.yearly.discountPercentage)}%`
      : null,
    yearlyEquivalentLabel: isYearly ? `${effectiveMonthlyPrice}/month equivalent` : null
  };
}

function stripBillingSuffix(value: string) {
  return value.replace(/\/(mo|yr)$/i, "");
}

function trimTrailingZero(value: number) {
  return Number.isInteger(value) ? String(value) : String(value).replace(/\.0+$/, "");
}
