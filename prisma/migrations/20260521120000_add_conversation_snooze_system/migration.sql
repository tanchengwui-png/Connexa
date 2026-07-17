CREATE TYPE "ConversationSnoozeStatus" AS ENUM (
  'ACTIVE',
  'MANUAL',
  'EXPIRED',
  'INCOMING_MESSAGE',
  'WORKFLOW'
);

ALTER TABLE "Conversation"
  ADD COLUMN "snoozedById" TEXT,
  ADD COLUMN "snoozeReason" TEXT,
  ADD COLUMN "snoozeStatus" "ConversationSnoozeStatus";

ALTER TABLE "Conversation"
  ADD CONSTRAINT "Conversation_snoozedById_fkey"
  FOREIGN KEY ("snoozedById") REFERENCES "Agent"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

CREATE INDEX "Conversation_workspaceId_snoozeStatus_snoozedUntil_lastMessageAt_idx"
  ON "Conversation"("workspaceId", "snoozeStatus", "snoozedUntil", "lastMessageAt");

CREATE INDEX "Conversation_snoozedById_idx"
  ON "Conversation"("snoozedById");

