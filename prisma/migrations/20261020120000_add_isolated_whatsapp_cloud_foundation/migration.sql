-- WhatsApp Cloud API foundation. This migration is additive except for removing
-- the legacy global phone-number uniqueness rule, which is incompatible with
-- Meta's partner-specific messaging-account model. Existing rows are untouched.
ALTER TABLE "WhatsAppChannel"
  ADD COLUMN IF NOT EXISTS "metaBusinessPortfolioId" TEXT,
  ADD COLUMN IF NOT EXISTS "legacyWabaId" TEXT,
  ADD COLUMN IF NOT EXISTS "waacId" TEXT,
  ADD COLUMN IF NOT EXISTS "messagingAccountId" TEXT,
  ADD COLUMN IF NOT EXISTS "integrationIdentity" TEXT,
  ADD COLUMN IF NOT EXISTS "serviceRoutingPartnerId" TEXT,
  ADD COLUMN IF NOT EXISTS "accountModelVersion" TEXT,
  ADD COLUMN IF NOT EXISTS "onboardingMode" TEXT,
  ADD COLUMN IF NOT EXISTS "latestHealthCheckAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastErrorCode" TEXT;

DROP INDEX IF EXISTS "WhatsAppChannel_phoneNumberId_key";

CREATE INDEX IF NOT EXISTS "WhatsAppChannel_provider_integrationIdentity_messagingAcc_idx"
  ON "WhatsAppChannel"("provider", "integrationIdentity", "messagingAccountId", "phoneNumberId");
CREATE INDEX IF NOT EXISTS "WhatsAppChannel_workspaceId_waacId_messagingAccountId_idx"
  ON "WhatsAppChannel"("workspaceId", "waacId", "messagingAccountId");

CREATE TABLE "MetaOnboardingAttempt" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "initiatedByAgentId" TEXT NOT NULL,
  "stateHash" TEXT NOT NULL,
  "configId" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "authorizationCiphertext" TEXT,
  "returnedAssetsJson" TEXT,
  "failureCode" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MetaOnboardingAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MetaOnboardingAttempt_stateHash_key" ON "MetaOnboardingAttempt"("stateHash");
CREATE INDEX "MetaOnboardingAttempt_workspaceId_channelId_status_idx" ON "MetaOnboardingAttempt"("workspaceId", "channelId", "status");
CREATE INDEX "MetaOnboardingAttempt_expiresAt_status_idx" ON "MetaOnboardingAttempt"("expiresAt", "status");

CREATE TABLE "MetaWebhookEvent" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "integrationIdentity" TEXT NOT NULL,
  "waacId" TEXT,
  "messagingAccountId" TEXT,
  "phoneNumberId" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "payloadDigest" TEXT NOT NULL,
  "providerOccurredAt" TIMESTAMP(3),
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processingStatus" TEXT NOT NULL DEFAULT 'RECEIVED',
  "processedAt" TIMESTAMP(3),
  "lastErrorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MetaWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MetaWebhookEvent_provider_integrationIdentity_idempotencyKey_key"
  ON "MetaWebhookEvent"("provider", "integrationIdentity", "idempotencyKey");
CREATE INDEX "MetaWebhookEvent_workspaceId_processingStatus_receivedAt_idx"
  ON "MetaWebhookEvent"("workspaceId", "processingStatus", "receivedAt");
CREATE INDEX "MetaWebhookEvent_channelId_providerOccurredAt_idx"
  ON "MetaWebhookEvent"("channelId", "providerOccurredAt");

CREATE TABLE "WhatsAppCoexistenceSyncJob" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "syncType" TEXT NOT NULL,
  "requestId" TEXT,
  "explicitConsentAt" TIMESTAMP(3) NOT NULL,
  "consentedByAgentId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "progressJson" TEXT,
  "lastErrorCode" TEXT,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WhatsAppCoexistenceSyncJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WhatsAppCoexistenceSyncJob_workspaceId_channelId_status_idx"
  ON "WhatsAppCoexistenceSyncJob"("workspaceId", "channelId", "status");
CREATE INDEX "WhatsAppCoexistenceSyncJob_expiresAt_status_idx"
  ON "WhatsAppCoexistenceSyncJob"("expiresAt", "status");

CREATE TABLE "TenantFundingAccount" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "billingRoute" TEXT NOT NULL DEFAULT 'unconfigured',
  "providerIdentity" TEXT,
  "verified" BOOLEAN NOT NULL DEFAULT false,
  "allocationReferenceCiphertext" TEXT,
  "billingCurrency" TEXT NOT NULL DEFAULT 'MYR',
  "prepaidBalance" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "monthlyCap" DECIMAL(18,6),
  "spentThisPeriod" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "periodStartedAt" TIMESTAMP(3),
  "gracePolicy" TEXT NOT NULL DEFAULT 'BLOCK_OUTBOUND',
  "verifiedAt" TIMESTAMP(3),
  "verifiedByAdminId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TenantFundingAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TenantFundingAccount_workspaceId_key" ON "TenantFundingAccount"("workspaceId");
CREATE INDEX "TenantFundingAccount_billingRoute_verified_idx" ON "TenantFundingAccount"("billingRoute", "verified");

CREATE TABLE "UsageCreditReservation" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "fundingAccountId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "estimatedAmount" DECIMAL(18,6) NOT NULL,
  "settledAmount" DECIMAL(18,6),
  "status" TEXT NOT NULL DEFAULT 'RESERVED',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "settledAt" TIMESTAMP(3),
  "releasedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UsageCreditReservation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UsageCreditReservation_workspaceId_idempotencyKey_key"
  ON "UsageCreditReservation"("workspaceId", "idempotencyKey");
CREATE INDEX "UsageCreditReservation_fundingAccountId_status_expiresAt_idx"
  ON "UsageCreditReservation"("fundingAccountId", "status", "expiresAt");
CREATE INDEX "UsageCreditReservation_channelId_createdAt_idx"
  ON "UsageCreditReservation"("channelId", "createdAt");

CREATE TABLE "WhatsAppUsageLedger" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "reservationId" TEXT,
  "messageId" TEXT,
  "providerReference" TEXT,
  "direction" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "destinationMarket" TEXT,
  "currency" TEXT NOT NULL,
  "rateCardVersion" TEXT NOT NULL,
  "rateEffectiveAt" TIMESTAMP(3) NOT NULL,
  "estimatedCost" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "finalCost" DECIMAL(18,6),
  "reconciliationStatus" TEXT NOT NULL DEFAULT 'ESTIMATED',
  "deliveryResult" TEXT,
  "billingPeriodKey" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WhatsAppUsageLedger_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WhatsAppUsageLedger_channelId_providerReference_category_period_key"
  ON "WhatsAppUsageLedger"("channelId", "providerReference", "category", "billingPeriodKey");
CREATE INDEX "WhatsAppUsageLedger_workspaceId_billingPeriodKey_category_idx"
  ON "WhatsAppUsageLedger"("workspaceId", "billingPeriodKey", "category");
CREATE INDEX "WhatsAppUsageLedger_channelId_occurredAt_idx" ON "WhatsAppUsageLedger"("channelId", "occurredAt");
CREATE INDEX "WhatsAppUsageLedger_reservationId_idx" ON "WhatsAppUsageLedger"("reservationId");
CREATE INDEX "WhatsAppUsageLedger_reconciliationStatus_occurredAt_idx"
  ON "WhatsAppUsageLedger"("reconciliationStatus", "occurredAt");

ALTER TABLE "MetaOnboardingAttempt"
  ADD CONSTRAINT "MetaOnboardingAttempt_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "MetaOnboardingAttempt_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "WhatsAppChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MetaWebhookEvent"
  ADD CONSTRAINT "MetaWebhookEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "MetaWebhookEvent_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "WhatsAppChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WhatsAppCoexistenceSyncJob"
  ADD CONSTRAINT "WhatsAppCoexistenceSyncJob_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "WhatsAppCoexistenceSyncJob_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "WhatsAppChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TenantFundingAccount"
  ADD CONSTRAINT "TenantFundingAccount_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UsageCreditReservation"
  ADD CONSTRAINT "UsageCreditReservation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "UsageCreditReservation_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "WhatsAppChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "UsageCreditReservation_fundingAccountId_fkey" FOREIGN KEY ("fundingAccountId") REFERENCES "TenantFundingAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WhatsAppUsageLedger"
  ADD CONSTRAINT "WhatsAppUsageLedger_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "WhatsAppUsageLedger_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "WhatsAppChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
