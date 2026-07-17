-- Add database-backed receipt numbers without backfilling historic records.
-- Paid historic transactions can be backfilled later with a chronological,
-- audited script that calls the same yearly counter logic.

CREATE TABLE IF NOT EXISTS "ReceiptNumberSequence" (
  year INTEGER PRIMARY KEY,
  "lastValue" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE "Invoice"
  ADD COLUMN IF NOT EXISTS "receiptNumber" TEXT,
  ADD COLUMN IF NOT EXISTS "receiptIssuedAt" TIMESTAMP(3);

ALTER TABLE "PaymentTransaction"
  ADD COLUMN IF NOT EXISTS "invoiceId" TEXT,
  ADD COLUMN IF NOT EXISTS "transactionId" TEXT,
  ADD COLUMN IF NOT EXISTS "paymentMethod" TEXT,
  ADD COLUMN IF NOT EXISTS "receiptNumber" TEXT,
  ADD COLUMN IF NOT EXISTS "receiptIssuedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "failureReason" TEXT,
  ADD COLUMN IF NOT EXISTS "gatewayResponseJson" TEXT;

ALTER TABLE "PendingWorkspacePackageUpgrade"
  ADD COLUMN IF NOT EXISTS "receiptNumber" TEXT,
  ADD COLUMN IF NOT EXISTS "receiptIssuedAt" TIMESTAMP(3);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'PaymentTransaction_invoiceId_fkey'
  ) THEN
    ALTER TABLE "PaymentTransaction"
      ADD CONSTRAINT "PaymentTransaction_invoiceId_fkey"
      FOREIGN KEY ("invoiceId") REFERENCES "Invoice"(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "Invoice_receiptNumber_key"
  ON "Invoice" ("receiptNumber");

CREATE UNIQUE INDEX IF NOT EXISTS "PaymentTransaction_receiptNumber_key"
  ON "PaymentTransaction" ("receiptNumber");

CREATE UNIQUE INDEX IF NOT EXISTS "PendingWorkspacePackageUpgrade_receiptNumber_key"
  ON "PendingWorkspacePackageUpgrade" ("receiptNumber");

CREATE UNIQUE INDEX IF NOT EXISTS "PaymentTransaction_transactionId_key"
  ON "PaymentTransaction" ("transactionId");

CREATE INDEX IF NOT EXISTS "PaymentTransaction_invoiceId_idx"
  ON "PaymentTransaction" ("invoiceId");

CREATE INDEX IF NOT EXISTS "PaymentTransaction_status_paidAt_idx"
  ON "PaymentTransaction" (status, "paidAt");

CREATE INDEX IF NOT EXISTS "Invoice_receiptIssuedAt_idx"
  ON "Invoice" ("receiptIssuedAt");
