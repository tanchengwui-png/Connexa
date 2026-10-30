ALTER TABLE "PendingWorkspacePackageUpgrade"
  ADD COLUMN IF NOT EXISTS "paymentExpiresAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "paymentReconciledAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "paymentGatewayState" TEXT,
  ADD COLUMN IF NOT EXISTS "paymentReconciliationReason" TEXT,
  ADD COLUMN IF NOT EXISTS "paymentReconciliationLeaseUntil" TIMESTAMP(3);

UPDATE "PendingWorkspacePackageUpgrade"
SET "paymentExpiresAt" = COALESCE("paymentStartedAt", "createdAt") + INTERVAL '20 minutes'
WHERE status = 'PAYMENT_PROCESSING'
  AND "paymentExpiresAt" IS NULL;

CREATE INDEX IF NOT EXISTS "PendingWorkspacePackageUpgrade_status_paymentExpiresAt_idx"
  ON "PendingWorkspacePackageUpgrade" (status, "paymentExpiresAt");

CREATE TABLE IF NOT EXISTS "WorkspacePackagePaymentReconciliation" (
  id TEXT PRIMARY KEY,
  "upgradeId" TEXT NOT NULL REFERENCES "PendingWorkspacePackageUpgrade"(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  reason TEXT,
  "gatewayState" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "WorkspacePackagePaymentReconciliation_upgradeId_createdAt_idx"
  ON "WorkspacePackagePaymentReconciliation" ("upgradeId", "createdAt");
