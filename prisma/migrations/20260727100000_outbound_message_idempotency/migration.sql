ALTER TABLE "OutboundMessageJob"
  ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "OutboundMessageJob_workspaceId_idempotencyKey_key"
  ON "OutboundMessageJob" ("workspaceId", "idempotencyKey")
  WHERE "idempotencyKey" IS NOT NULL;
