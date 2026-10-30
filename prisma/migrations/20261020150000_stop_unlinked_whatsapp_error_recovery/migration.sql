-- Complete the additive schema for databases which applied the original
-- reliability migration before runtimeDegradedAt was introduced.
ALTER TABLE "WhatsAppChannel"
  ADD COLUMN IF NOT EXISTS "runtimeDegradedAt" TIMESTAMP(3);

-- A channel which has never connected cannot be proven to have reusable
-- LocalAuth credentials while INITIALIZING or ERROR. Keep it stopped so
-- deployment cannot start an unattended QR flow. Mature rows retain RUNNING
-- and remain recoverable.
UPDATE "WhatsAppChannel"
SET
  "runtimeDesiredState" = 'STOPPED',
  "runtimeHealthStatus" = 'UNKNOWN',
  "nextRecoveryAt" = NULL,
  "recoveryToken" = NULL,
  "updatedAt" = NOW()
WHERE ("channelType" = 'web' OR ("channelType" IS NULL AND "phoneNumberId" IS NULL))
  AND "connectionStatus" IN ('INITIALIZING', 'ERROR')
  AND "connectedAt" IS NULL
  AND "runtimeDesiredState" = 'RUNNING';

-- Some legacy WhatsApp Web rows predate the explicit channelType marker and
-- were not covered by the original backfill. Resume only states that are
-- unambiguously active or have evidence of a prior successful connection.
UPDATE "WhatsAppChannel"
SET
  "runtimeDesiredState" = 'RUNNING',
  "runtimeHealthStatus" = 'RECOVERING',
  "updatedAt" = NOW()
WHERE ("channelType" = 'web' OR ("channelType" IS NULL AND "phoneNumberId" IS NULL))
  AND "connectedByAgentId" IS NOT NULL
  AND "sessionClientId" IS NOT NULL
  AND "runtimeDesiredState" = 'STOPPED'
  AND "connectionStatus" IN (
    'INITIALIZING', 'AUTHENTICATED', 'CONNECTED', 'SYNCING_HISTORY', 'READY', 'ERROR'
  )
  AND (
    "connectedAt" IS NOT NULL
    OR "connectionStatus" IN ('AUTHENTICATED', 'CONNECTED', 'SYNCING_HISTORY', 'READY')
  );
