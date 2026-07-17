ALTER TABLE "Agent"
ADD COLUMN IF NOT EXISTS "inboxDesktopNotificationsPromptDismissedAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "BrowserPushSubscription" (
  "id" TEXT NOT NULL,
  "accountId" TEXT,
  "agentId" TEXT NOT NULL,
  "endpoint" TEXT NOT NULL,
  "p256dhKey" TEXT NOT NULL,
  "authKey" TEXT NOT NULL,
  "userAgent" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "lastSuccessfulSendAt" TIMESTAMP(3),
  "lastFailureAt" TIMESTAMP(3),
  "lastFailureCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BrowserPushSubscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "BrowserPushSubscription_endpoint_key"
ON "BrowserPushSubscription" ("endpoint");

CREATE INDEX IF NOT EXISTS "BrowserPushSubscription_accountId_enabled_idx"
ON "BrowserPushSubscription" ("accountId", "enabled");

CREATE INDEX IF NOT EXISTS "BrowserPushSubscription_agentId_enabled_idx"
ON "BrowserPushSubscription" ("agentId", "enabled");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'BrowserPushSubscription_accountId_fkey'
  ) THEN
    ALTER TABLE "BrowserPushSubscription"
    ADD CONSTRAINT "BrowserPushSubscription_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'BrowserPushSubscription_agentId_fkey'
  ) THEN
    ALTER TABLE "BrowserPushSubscription"
    ADD CONSTRAINT "BrowserPushSubscription_agentId_fkey"
    FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
