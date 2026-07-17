CREATE TABLE IF NOT EXISTS "message_usage_logs" (
  "id" TEXT PRIMARY KEY,
  "workspace_id" TEXT NOT NULL,
  "account_id" TEXT,
  "provider" VARCHAR(32) NOT NULL,
  "message_type" VARCHAR(64) NOT NULL,
  "cost_estimate" DECIMAL(12,4) NOT NULL DEFAULT 0,
  "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "message_usage_logs_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "message_usage_logs_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "WhatsAppChannel"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "message_usage_logs_workspace_id_timestamp_idx"
  ON "message_usage_logs" ("workspace_id", "timestamp");

CREATE INDEX IF NOT EXISTS "message_usage_logs_account_id_timestamp_idx"
  ON "message_usage_logs" ("account_id", "timestamp");

CREATE INDEX IF NOT EXISTS "message_usage_logs_provider_timestamp_idx"
  ON "message_usage_logs" ("provider", "timestamp");

CREATE INDEX IF NOT EXISTS "message_usage_logs_message_type_timestamp_idx"
  ON "message_usage_logs" ("message_type", "timestamp");

