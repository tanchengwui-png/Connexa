import { PACKAGE_BILLING_PERIOD, type PackageBillingPeriod } from "@/lib/package-pricing";
import { publicPackageKeys, type PublicPackageKey } from "@/lib/public-packages";

export type VisiblePackageCard = {
  key: PublicPackageKey;
  name: string;
  priceAmount: number | null;
  featured: boolean;
  summary: string;
  highlights: [string, string, string];
  features: string[];
  pricing: {
    monthly: {
      priceAmount: number | null;
      formattedPrice: string;
    };
    yearly: {
      discountPercentage: number;
      payablePriceAmount: number | null;
      effectiveMonthlyPriceAmount: number | null;
      formattedBasePrice: string;
      formattedPayablePrice: string;
      formattedEffectiveMonthlyPrice: string;
    };
  };
};

const PACKAGE_RANK: Record<PublicPackageKey, number> = publicPackageKeys.reduce((accumulator, key, index) => {
  accumulator[key] = index;
  return accumulator;
}, {} as Record<PublicPackageKey, number>);

export function buildPackageCardView(plan: VisiblePackageCard, billingPeriod: PackageBillingPeriod) {
  const isYearly = billingPeriod === PACKAGE_BILLING_PERIOD.YEARLY;
  const hasFixedPrice = plan.priceAmount !== null;
  const hasYearlyDiscount =
    isYearly &&
    hasFixedPrice &&
    plan.pricing.yearly.payablePriceAmount !== null &&
    plan.pricing.yearly.discountPercentage > 0;
  const displayPrice = isYearly
    ? formatDisplayPrice(plan.pricing.yearly.formattedPayablePrice)
    : formatDisplayPrice(plan.pricing.monthly.formattedPrice);
  const effectiveMonthlyPrice = formatDisplayPrice(plan.pricing.yearly.formattedEffectiveMonthlyPrice);

  return {
    isYearly,
    hasFixedPrice,
    planLabel: !isYearly && plan.featured ? "Recommended plan" : "Workspace plan",
    showFeaturedBadge: !isYearly && plan.featured,
    displayPrice,
    pricePeriodLabel: isYearly ? "Per month effective" : hasFixedPrice ? "One-time monthly payment" : "Flexible billing",
    showSummary: !isYearly,
    showYearlyOriginalPrice: hasYearlyDiscount,
    yearlyOriginalPrice: hasYearlyDiscount ? formatDisplayPrice(plan.pricing.yearly.formattedBasePrice) : null,
    showYearlySavingsBadge: hasYearlyDiscount,
    yearlySavingsBadge: hasYearlyDiscount ? `Save ${trimTrailingZero(plan.pricing.yearly.discountPercentage)}% at ${effectiveMonthlyPrice}/month` : null,
    yearlyEffectiveMonthlyHeading: `Equivalent to ${effectiveMonthlyPrice}/month`
  };
}

export function getPlanHref(
  planKey: PublicPackageKey,
  currentPlanKey: PublicPackageKey | null,
  billingPeriod: PackageBillingPeriod
) {
  if (!currentPlanKey) {
    if (planKey === "starter" && billingPeriod === PACKAGE_BILLING_PERIOD.MONTHLY) {
      return "/register";
    }
    return `/checkout?plan=${planKey}&billingPeriod=${billingPeriod.toLowerCase()}`;
  }

  if (planKey === "enterprise") {
    return `/checkout?plan=${planKey}&billingPeriod=${billingPeriod.toLowerCase()}`;
  }

  if (PACKAGE_RANK[planKey] > PACKAGE_RANK[currentPlanKey]) {
    return "/account-settings/billing?planSelection=upgrade#package-management";
  }

  if (planKey === currentPlanKey) {
    return "/account-settings?planSelection=current";
  }

  return "/account-settings/billing#package-management";
}

export function getPlanCta(plan: Pick<VisiblePackageCard, "key" | "name" | "priceAmount">, currentPlanKey: PublicPackageKey | null) {
  if (!currentPlanKey) {
    return plan.priceAmount === null ? "Talk to sales" : "Get started";
  }

  if (plan.key === "enterprise") {
    return "Talk to sales";
  }

  if (PACKAGE_RANK[plan.key] > PACKAGE_RANK[currentPlanKey]) {
    return `Upgrade to ${plan.name}`;
  }

  if (plan.key === currentPlanKey) {
    return "This is your current plan";
  }

  return "Manage in billing";
}

function formatDisplayPrice(formattedAmount: string) {
  return formattedAmount.replace("/mo", "").replace("/yr", "");
}

function trimTrailingZero(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, "");
}
