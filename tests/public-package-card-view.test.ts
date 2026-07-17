import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPackageCardView,
  getPlanCta,
  getPlanHref,
  type VisiblePackageCard
} from "../lib/public-package-card-view";
import { PACKAGE_BILLING_PERIOD } from "../lib/package-pricing";

function createPlan(overrides: Partial<VisiblePackageCard> = {}): VisiblePackageCard {
  return {
    key: "professional",
    name: "Professional",
    priceAmount: 119,
    featured: true,
    summary: "Best for teams that need stronger coordination and cleaner daily operating flow.",
    highlights: ["More team seats", "Stronger handoff flow", "Daily operator ready"],
    features: ["Shared inbox", "Automations", "Campaign visibility"],
    pricing: {
      monthly: {
        priceAmount: 119,
        formattedPrice: "RM119/mo"
      },
      yearly: {
        discountPercentage: 17,
        payablePriceAmount: 1190,
        effectiveMonthlyPriceAmount: 99,
        formattedBasePrice: "RM1,428/yr",
        formattedPayablePrice: "RM1,190/yr",
        formattedEffectiveMonthlyPrice: "RM99/mo"
      }
    },
    ...overrides
  };
}

test("yearly mode displays the total yearly amount as the main price", () => {
  const view = buildPackageCardView(createPlan(), PACKAGE_BILLING_PERIOD.YEARLY);

  assert.equal(view.displayPrice, "RM1,190");
  assert.notEqual(view.displayPrice, "RM99");
});

test("yearly mode shows original price and savings badge when discount exists", () => {
  const view = buildPackageCardView(createPlan(), PACKAGE_BILLING_PERIOD.YEARLY);

  assert.equal(view.showYearlyOriginalPrice, true);
  assert.equal(view.yearlyOriginalPrice, "RM1,428");
  assert.equal(view.showYearlySavingsBadge, true);
  assert.equal(view.yearlySavingsBadge, "Save 17% at RM99/month");
  assert.equal(view.yearlyEffectiveMonthlyHeading, "Equivalent to RM99/month");
});

test("yearly mode hides original price and savings badge when discount is zero", () => {
  const view = buildPackageCardView(
    createPlan({
      featured: false,
      pricing: {
        monthly: {
          priceAmount: 119,
          formattedPrice: "RM119/mo"
        },
        yearly: {
          discountPercentage: 0,
          payablePriceAmount: 1428,
          effectiveMonthlyPriceAmount: 119,
          formattedBasePrice: "RM1,428/yr",
          formattedPayablePrice: "RM1,428/yr",
          formattedEffectiveMonthlyPrice: "RM119/mo"
        }
      }
    }),
    PACKAGE_BILLING_PERIOD.YEARLY
  );

  assert.equal(view.displayPrice, "RM1,428");
  assert.equal(view.showYearlyOriginalPrice, false);
  assert.equal(view.yearlyOriginalPrice, null);
  assert.equal(view.showYearlySavingsBadge, false);
  assert.equal(view.yearlySavingsBadge, null);
  assert.equal(view.yearlyEffectiveMonthlyHeading, "Equivalent to RM119/month");
});

test("yearly mode removes recommendation wording and badges", () => {
  const view = buildPackageCardView(createPlan({ featured: true }), PACKAGE_BILLING_PERIOD.YEARLY);

  assert.equal(view.planLabel, "Workspace plan");
  assert.equal(view.showFeaturedBadge, false);
});

test("monthly mode remains on the existing monthly presentation branch", () => {
  const view = buildPackageCardView(createPlan({ featured: true }), PACKAGE_BILLING_PERIOD.MONTHLY);

  assert.equal(view.displayPrice, "RM119");
  assert.equal(view.planLabel, "Recommended plan");
  assert.equal(view.showFeaturedBadge, true);
  assert.equal(view.showSummary, true);
  assert.equal(view.pricePeriodLabel, "One-time monthly payment");
});

test("checkout still receives the correct yearly billing period for public plans", () => {
  assert.equal(getPlanHref("professional", null, PACKAGE_BILLING_PERIOD.YEARLY), "/checkout?plan=professional&billingPeriod=yearly");
  assert.equal(getPlanHref("professional", null, PACKAGE_BILLING_PERIOD.MONTHLY), "/checkout?plan=professional&billingPeriod=monthly");
});

test("starter monthly uses the existing free trial registration flow", () => {
  assert.equal(getPlanHref("starter", null, PACKAGE_BILLING_PERIOD.MONTHLY), "/register");
  assert.equal(getPlanHref("starter", null, PACKAGE_BILLING_PERIOD.YEARLY), "/checkout?plan=starter&billingPeriod=yearly");
});

test("current-plan and manage-in-billing behavior remains unchanged", () => {
  const currentPlan = createPlan();

  assert.equal(getPlanCta(currentPlan, "professional"), "This is your current plan");
  assert.equal(
    getPlanHref("professional", "professional", PACKAGE_BILLING_PERIOD.YEARLY),
    "/account-settings?planSelection=current"
  );

  assert.equal(getPlanCta(createPlan({ key: "starter", name: "Starter", featured: false }), "professional"), "Manage in billing");
  assert.equal(
    getPlanHref("starter", "professional", PACKAGE_BILLING_PERIOD.YEARLY),
    "/account-settings/billing#package-management"
  );
});
