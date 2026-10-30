-- Deletion is explicit: expiry no longer schedules any workspace or data deletion.
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "deactivatedAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "DeletionRequest" (
  id TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "Agent"(id) ON DELETE RESTRICT,
  "accountId" TEXT,
  "workspaceId" TEXT NOT NULL REFERENCES "Workspace"(id) ON DELETE RESTRICT,
  "actionType" TEXT NOT NULL CHECK ("actionType" IN ('delete_all_data', 'delete_account')),
  status TEXT NOT NULL CHECK (status IN ('confirmed', 'processing', 'completed', 'failed', 'cancelled')),
  "confirmedAt" TIMESTAMP(3) NOT NULL,
  "processingStartedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "failureReason" TEXT,
  "requestSource" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "DeletionRequest_userId_idx" ON "DeletionRequest" ("userId");
CREATE INDEX IF NOT EXISTS "DeletionRequest_accountId_idx" ON "DeletionRequest" ("accountId");
CREATE INDEX IF NOT EXISTS "DeletionRequest_actionType_idx" ON "DeletionRequest" ("actionType");
CREATE INDEX IF NOT EXISTS "DeletionRequest_status_idx" ON "DeletionRequest" (status);
CREATE INDEX IF NOT EXISTS "DeletionRequest_confirmedAt_idx" ON "DeletionRequest" ("confirmedAt");
CREATE UNIQUE INDEX IF NOT EXISTS "DeletionRequest_one_active_action_per_workspace_idx"
  ON "DeletionRequest" ("workspaceId", "actionType")
  WHERE status IN ('confirmed', 'processing');
