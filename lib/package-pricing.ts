export const PACKAGE_BILLING_PERIOD = {
  MONTHLY: "MONTHLY",
  YEARLY: "YEARLY"
} as const;

export type PackageBillingPeriod = (typeof PACKAGE_BILLING_PERIOD)[keyof typeof PACKAGE_BILLING_PERIOD];

const MONEY_SCALE = 100;
const PERCENTAGE_SCALE = 100;

export function normalizePackageBillingPeriod(value: string | null | undefined): PackageBillingPeriod {
  const normalized = value?.trim().toUpperCase();

  if (normalized === PACKAGE_BILLING_PERIOD.MONTHLY || normalized === PACKAGE_BILLING_PERIOD.YEARLY) {
    return normalized;
  }

  throw new Error("Billing period must be monthly or yearly.");
}

export function parseYearlyDiscountPercentage(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return 0;
  }

  const normalized = Number(value);

  if (!Number.isFinite(normalized)) {
    throw new Error("Yearly discount must be numeric.");
  }

  const rounded = Math.round(normalized * PERCENTAGE_SCALE) / PERCENTAGE_SCALE;

  if (rounded < 0) {
    throw new Error("Yearly discount must be 0 or greater.");
  }

  if (rounded >= 100) {
    throw new Error("Yearly discount must be less than 100.");
  }

  return rounded;
}

export function formatPackageAmount(
  amount: number | null,
  currency: string | null,
  billingPeriod: PackageBillingPeriod | null
) {
  if (amount === null) {
    return "Custom";
  }

  const formattedAmount = new Intl.NumberFormat("en-MY", {
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2
  }).format(amount);
  const currencyPrefix = currency === "MYR" || !currency ? "RM" : `${currency} `;
  const periodSuffix = billingPeriod === PACKAGE_BILLING_PERIOD.YEARLY ? "/yr" : billingPeriod === PACKAGE_BILLING_PERIOD.MONTHLY ? "/mo" : "";

  return `${currencyPrefix}${formattedAmount}${periodSuffix}`;
}

export function calculatePackagePricing(
  monthlyPriceAmount: number | null,
  yearlyDiscountPercentage: number,
  currency: string | null
) {
  const normalizedDiscountPercentage = parseYearlyDiscountPercentage(yearlyDiscountPercentage);

  if (monthlyPriceAmount === null) {
    return {
      monthly: {
        priceAmount: null,
        formattedPrice: "Custom"
      },
      yearly: {
        discountPercentage: normalizedDiscountPercentage,
        basePriceAmount: null,
        discountAmount: null,
        payablePriceAmount: null,
        savingsAmount: null,
        effectiveMonthlyPriceAmount: null,
        formattedBasePrice: "Custom",
        formattedDiscountAmount: "Custom",
        formattedPayablePrice: "Custom",
        formattedSavingsAmount: "Custom",
        formattedEffectiveMonthlyPrice: "Custom"
      }
    };
  }

  const monthlyMinorUnits = toMinorUnits(monthlyPriceAmount);
  const yearlyBaseMinorUnits = monthlyMinorUnits * 12;
  const discountBasisPoints = Math.round(normalizedDiscountPercentage * PERCENTAGE_SCALE);
  const yearlyDiscountMinorUnits = Math.round((yearlyBaseMinorUnits * discountBasisPoints) / 10000);
  const yearlyPayableMinorUnits = yearlyBaseMinorUnits - yearlyDiscountMinorUnits;
  const effectiveMonthlyMinorUnits = Math.round(yearlyPayableMinorUnits / 12);

  const basePriceAmount = fromMinorUnits(yearlyBaseMinorUnits);
  const discountAmount = fromMinorUnits(yearlyDiscountMinorUnits);
  const payablePriceAmount = fromMinorUnits(yearlyPayableMinorUnits);
  const effectiveMonthlyPriceAmount = fromMinorUnits(effectiveMonthlyMinorUnits);

  return {
    monthly: {
      priceAmount: monthlyPriceAmount,
      formattedPrice: formatPackageAmount(monthlyPriceAmount, currency, PACKAGE_BILLING_PERIOD.MONTHLY)
    },
    yearly: {
      discountPercentage: normalizedDiscountPercentage,
      basePriceAmount,
      discountAmount,
      payablePriceAmount,
      savingsAmount: discountAmount,
      effectiveMonthlyPriceAmount,
      formattedBasePrice: formatPackageAmount(basePriceAmount, currency, PACKAGE_BILLING_PERIOD.YEARLY),
      formattedDiscountAmount: formatPackageAmount(discountAmount, currency, null),
      formattedPayablePrice: formatPackageAmount(payablePriceAmount, currency, PACKAGE_BILLING_PERIOD.YEARLY),
      formattedSavingsAmount: formatPackageAmount(discountAmount, currency, null),
      formattedEffectiveMonthlyPrice: formatPackageAmount(
        effectiveMonthlyPriceAmount,
        currency,
        PACKAGE_BILLING_PERIOD.MONTHLY
      )
    }
  };
}

export function getPackageChargeAmount(input: {
  monthlyPriceAmount: number | null;
  yearlyDiscountPercentage: number;
  billingPeriod: PackageBillingPeriod;
  currency: string | null;
}) {
  const pricing = calculatePackagePricing(
    input.monthlyPriceAmount,
    input.yearlyDiscountPercentage,
    input.currency
  );

  return input.billingPeriod === PACKAGE_BILLING_PERIOD.YEARLY
    ? pricing.yearly.payablePriceAmount
    : pricing.monthly.priceAmount;
}

function toMinorUnits(amount: number) {
  return Math.round(amount * MONEY_SCALE);
}

function fromMinorUnits(amount: number) {
  return amount / MONEY_SCALE;
}
