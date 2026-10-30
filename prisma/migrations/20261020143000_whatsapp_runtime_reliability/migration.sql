-- Additive, rollback-safe runtime reliability state. LocalAuth data is untouched.
ALTER TABLE "WhatsAppChannel"
  ADD COLUMN "runtimeDesiredState" TEXT NOT NULL DEFAULT 'STOPPED',
  ADD COLUMN "runtimeHealthStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "consecutiveHealthFailures" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "recoveryAttemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "recoveryWindowStartedAt" TIMESTAMP(3),
  ADD COLUMN "nextRecoveryAt" TIMESTAMP(3),
  ADD COLUMN "lastRecoveryAt" TIMESTAMP(3),
  ADD COLUMN "lastHealthyAt" TIMESTAMP(3),
  ADD COLUMN "reauthRequiredAt" TIMESTAMP(3),
  ADD COLUMN "recoveryToken" TEXT;

-- Preserve runtimes which were active before this release. ERROR is included
-- because it represented an unintentional runtime failure; explicit manual
-- disconnects and invalid sessions remain stopped.
UPDATE "WhatsAppChannel"
SET
  "runtimeDesiredState" = 'RUNNING',
  "runtimeHealthStatus" = 'RECOVERING'
WHERE "channelType" = 'web'
  AND "connectedByAgentId" IS NOT NULL
  AND "sessionClientId" IS NOT NULL
  AND "connectionStatus" IN (
    'INITIALIZING', 'AUTHENTICATED', 'CONNECTED', 'SYNCING_HISTORY', 'READY', 'ERROR'
  );

CREATE INDEX "WhatsAppChannel_runtimeDesiredState_runtimeHealthStatus_nextRecoveryAt_idx"
  ON "WhatsAppChannel"("runtimeDesiredState", "runtimeHealthStatus", "nextRecoveryAt");
