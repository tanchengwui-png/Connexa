ALTER TABLE "PlatformPackageConfig"
  ADD COLUMN IF NOT EXISTS "yearlyDiscountPercentage" DECIMAL(5, 2) NOT NULL DEFAULT 0;

UPDATE "PlatformPackageConfig"
SET "yearlyDiscountPercentage" = 0
WHERE "yearlyDiscountPercentage" IS NULL;

ALTER TABLE "PendingWorkspaceCheckout"
  ADD COLUMN IF NOT EXISTS "billingPeriod" "BillingPeriod";

UPDATE "PendingWorkspaceCheckout"
SET "billingPeriod" = 'MONTHLY'
WHERE "billingPeriod" IS NULL;
