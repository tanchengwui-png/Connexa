-- Durable, additive history synchronization state. Existing messages,
-- sessions, LocalAuth profiles, and channel state are intentionally untouched.
CREATE TABLE "WhatsAppHistorySyncState" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "phase" TEXT NOT NULL DEFAULT 'idle',
  "active" BOOLEAN NOT NULL DEFAULT false,
  "startedAt" TIMESTAMP(3),
  "progressAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "lastSuccessfulSyncAt" TIMESTAMP(3),
  "nextReconciliationAt" TIMESTAMP(3),
  "totalChats" INTEGER,
  "processedChats" INTEGER NOT NULL DEFAULT 0,
  "remainingChats" INTEGER NOT NULL DEFAULT 0,
  "deferredChats" INTEGER NOT NULL DEFAULT 0,
  "newMessages" INTEGER NOT NULL DEFAULT 0,
  "knownMessages" INTEGER NOT NULL DEFAULT 0,
  "updatedMessages" INTEGER NOT NULL DEFAULT 0,
  "skippedMessages" INTEGER NOT NULL DEFAULT 0,
  "mediaDownloadsAvoided" INTEGER NOT NULL DEFAULT 0,
  "mediaBytesDownloaded" BIGINT NOT NULL DEFAULT 0,
  "databaseWritesAvoided" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "generation" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WhatsAppHistorySyncState_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WhatsAppHistoryCheckpoint" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "remoteChatId" TEXT NOT NULL,
  "lastProviderMessageId" TEXT,
  "lastMessageTimestamp" TIMESTAMP(3),
  "lastObservedChatActivityAt" TIMESTAMP(3),
  "lastChatSignature" TEXT,
  "lastSuccessfulReconciliationAt" TIMESTAMP(3),
  "lastAttemptedReconciliationAt" TIMESTAMP(3),
  "initialImportComplete" BOOLEAN NOT NULL DEFAULT false,
  "deferred" BOOLEAN NOT NULL DEFAULT false,
  "retryAt" TIMESTAMP(3),
  "lastError" TEXT,
  "schemaVersion" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WhatsAppHistoryCheckpoint_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WhatsAppHistoryLease" (
  "channelId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "generation" INTEGER NOT NULL DEFAULT 1,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WhatsAppHistoryLease_pkey" PRIMARY KEY ("channelId")
);

CREATE UNIQUE INDEX "WhatsAppHistorySyncState_channelId_key" ON "WhatsAppHistorySyncState"("channelId");
CREATE INDEX "WhatsAppHistorySyncState_workspaceId_phase_updatedAt_idx" ON "WhatsAppHistorySyncState"("workspaceId", "phase", "updatedAt");
CREATE UNIQUE INDEX "WhatsAppHistoryCheckpoint_workspaceId_channelId_remoteChatId_key" ON "WhatsAppHistoryCheckpoint"("workspaceId", "channelId", "remoteChatId");
CREATE INDEX "WhatsAppHistoryCheckpoint_channelId_deferred_retryAt_idx" ON "WhatsAppHistoryCheckpoint"("channelId", "deferred", "retryAt");
CREATE INDEX "WhatsAppHistoryCheckpoint_workspaceId_lastSuccessfulReconciliationAt_idx" ON "WhatsAppHistoryCheckpoint"("workspaceId", "lastSuccessfulReconciliationAt");
CREATE INDEX "WhatsAppHistoryLease_workspaceId_expiresAt_idx" ON "WhatsAppHistoryLease"("workspaceId", "expiresAt");
CREATE INDEX "WhatsAppHistoryLease_expiresAt_idx" ON "WhatsAppHistoryLease"("expiresAt");

ALTER TABLE "WhatsAppHistorySyncState" ADD CONSTRAINT "WhatsAppHistorySyncState_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WhatsAppHistorySyncState" ADD CONSTRAINT "WhatsAppHistorySyncState_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "WhatsAppChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WhatsAppHistoryCheckpoint" ADD CONSTRAINT "WhatsAppHistoryCheckpoint_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WhatsAppHistoryCheckpoint" ADD CONSTRAINT "WhatsAppHistoryCheckpoint_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "WhatsAppChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WhatsAppHistoryLease" ADD CONSTRAINT "WhatsAppHistoryLease_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WhatsAppHistoryLease" ADD CONSTRAINT "WhatsAppHistoryLease_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "WhatsAppChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
