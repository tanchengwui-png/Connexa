import test from "node:test";
import assert from "node:assert/strict";
import {
  calculatePackagePricing,
  getPackageChargeAmount,
  normalizePackageBillingPeriod,
  parseYearlyDiscountPercentage,
  PACKAGE_BILLING_PERIOD
} from "../lib/package-pricing";

test("yearly pricing uses 0 percent discount by default", () => {
  const pricing = calculatePackagePricing(119, 0, "MYR");

  assert.equal(pricing.yearly.basePriceAmount, 1428);
  assert.equal(pricing.yearly.discountAmount, 0);
  assert.equal(pricing.yearly.payablePriceAmount, 1428);
  assert.equal(pricing.yearly.savingsAmount, 0);
  assert.equal(pricing.yearly.effectiveMonthlyPriceAmount, 119);
});

test("yearly pricing applies normal discount", () => {
  const pricing = calculatePackagePricing(119, 10, "MYR");

  assert.equal(pricing.yearly.basePriceAmount, 1428);
  assert.equal(pricing.yearly.discountAmount, 142.8);
  assert.equal(pricing.yearly.payablePriceAmount, 1285.2);
  assert.equal(pricing.yearly.savingsAmount, 142.8);
  assert.equal(pricing.yearly.effectiveMonthlyPriceAmount, 107.1);
});

test("yearly pricing supports decimal discounts and rounds to currency precision", () => {
  const pricing = calculatePackagePricing(79, 12.5, "MYR");

  assert.equal(pricing.yearly.basePriceAmount, 948);
  assert.equal(pricing.yearly.discountAmount, 118.5);
  assert.equal(pricing.yearly.payablePriceAmount, 829.5);
  assert.equal(pricing.yearly.effectiveMonthlyPriceAmount, 69.13);
});

test("yearly pricing differs across package discounts", () => {
  const starter = calculatePackagePricing(79, 5, "MYR");
  const growth = calculatePackagePricing(149, 15, "MYR");

  assert.equal(starter.yearly.payablePriceAmount, 900.6);
  assert.equal(growth.yearly.payablePriceAmount, 1519.8);
});

test("yearly charge recalculates when monthly price changes", () => {
  assert.equal(
    getPackageChargeAmount({
      monthlyPriceAmount: 119,
      yearlyDiscountPercentage: 10,
      billingPeriod: PACKAGE_BILLING_PERIOD.YEARLY,
      currency: "MYR"
    }),
    1285.2
  );

  assert.equal(
    getPackageChargeAmount({
      monthlyPriceAmount: 129,
      yearlyDiscountPercentage: 10,
      billingPeriod: PACKAGE_BILLING_PERIOD.YEARLY,
      currency: "MYR"
    }),
    1393.2
  );
});

test("monthly charge remains unchanged", () => {
  assert.equal(
    getPackageChargeAmount({
      monthlyPriceAmount: 149,
      yearlyDiscountPercentage: 20,
      billingPeriod: PACKAGE_BILLING_PERIOD.MONTHLY,
      currency: "MYR"
    }),
    149
  );
});

test("billing period normalization accepts monthly and yearly", () => {
  assert.equal(normalizePackageBillingPeriod("monthly"), PACKAGE_BILLING_PERIOD.MONTHLY);
  assert.equal(normalizePackageBillingPeriod("YEARLY"), PACKAGE_BILLING_PERIOD.YEARLY);
});

test("yearly discount validation defaults omitted values to zero", () => {
  assert.equal(parseYearlyDiscountPercentage(undefined), 0);
  assert.equal(parseYearlyDiscountPercentage(""), 0);
});

test("yearly discount validation rejects negative values", () => {
  assert.throws(() => parseYearlyDiscountPercentage(-1), /0 or greater/);
});

test("yearly discount validation rejects 100 and above", () => {
  assert.throws(() => parseYearlyDiscountPercentage(100), /less than 100/);
  assert.throws(() => parseYearlyDiscountPercentage(100.01), /less than 100/);
});

test("yearly discount validation rejects non numeric values", () => {
  assert.throws(() => parseYearlyDiscountPercentage("abc"), /numeric/);
});

test("billing period normalization rejects unknown periods", () => {
  assert.throws(() => normalizePackageBillingPeriod("weekly"), /monthly or yearly/);
});
