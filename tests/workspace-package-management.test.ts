import assert from "node:assert/strict";
import test from "node:test";
import { PACKAGE_BILLING_PERIOD } from "../lib/package-pricing";
import {
  buildWorkspacePackagePricingView,
  getDefaultWorkspacePackageBillingPeriod
} from "../lib/workspace-package-management";

test("default package billing period prefers the active pending invoice interval", () => {
  const billingPeriod = getDefaultWorkspacePackageBillingPeriod({
    currentBillingPeriod: PACKAGE_BILLING_PERIOD.MONTHLY,
    pendingPlanChanges: [
      {
        status: "ISSUED",
        billingPeriod: PACKAGE_BILLING_PERIOD.YEARLY
      }
    ]
  });

  assert.equal(billingPeriod, PACKAGE_BILLING_PERIOD.YEARLY);
});

test("default package billing period falls back to the current subscription interval", () => {
  const billingPeriod = getDefaultWorkspacePackageBillingPeriod({
    currentBillingPeriod: PACKAGE_BILLING_PERIOD.YEARLY,
    pendingPlanChanges: []
  });

  assert.equal(billingPeriod, PACKAGE_BILLING_PERIOD.YEARLY);
});

test("workspace package pricing view shows yearly savings and monthly equivalent", () => {
  const view = buildWorkspacePackagePricingView(
    {
      pricing: {
        monthly: {
          formattedPrice: "RM119/mo"
        },
        yearly: {
          discountPercentage: 10,
          payablePriceAmount: 1285.2,
          formattedBasePrice: "RM1,428/yr",
          formattedPayablePrice: "RM1,285.2/yr",
          formattedEffectiveMonthlyPrice: "RM107.1/mo",
          discountAmount: 142.8,
          savingsAmount: 142.8,
          effectiveMonthlyPriceAmount: 107.1,
          basePriceAmount: 1428,
          formattedDiscountAmount: "RM142.8",
          formattedSavingsAmount: "RM142.8"
        }
      }
    },
    PACKAGE_BILLING_PERIOD.YEARLY
  );

  assert.equal(view.displayPrice, "RM1,285.2");
  assert.equal(view.pricePeriodLabel, "Billed yearly");
  assert.equal(view.yearlyOriginalPrice, "RM1,428");
  assert.equal(view.yearlySavingsLabel, "Save 10%");
  assert.equal(view.yearlyEquivalentLabel, "RM107.1/month equivalent");
});

test("workspace package pricing view keeps the monthly presentation unchanged", () => {
  const view = buildWorkspacePackagePricingView(
    {
      pricing: {
        monthly: {
          formattedPrice: "RM79/mo"
        },
        yearly: {
          discountPercentage: 0,
          payablePriceAmount: 948,
          formattedBasePrice: "RM948/yr",
          formattedPayablePrice: "RM948/yr",
          formattedEffectiveMonthlyPrice: "RM79/mo",
          discountAmount: 0,
          savingsAmount: 0,
          effectiveMonthlyPriceAmount: 79,
          basePriceAmount: 948,
          formattedDiscountAmount: "RM0",
          formattedSavingsAmount: "RM0"
        }
      }
    },
    PACKAGE_BILLING_PERIOD.MONTHLY
  );

  assert.equal(view.displayPrice, "RM79");
  assert.equal(view.pricePeriodLabel, "Billed monthly");
  assert.equal(view.yearlyOriginalPrice, null);
  assert.equal(view.yearlySavingsLabel, null);
  assert.equal(view.yearlyEquivalentLabel, null);
});
