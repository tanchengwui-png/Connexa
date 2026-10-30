CREATE TABLE "PersonalWhatsAppNotificationLedger" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "chatId" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PersonalWhatsAppNotificationLedger_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PersonalWhatsAppNotificationLedger_workspaceId_channelId_chatId_fingerprint_key"
  ON "PersonalWhatsAppNotificationLedger"("workspaceId", "channelId", "chatId", "fingerprint");
CREATE INDEX "PersonalWhatsAppNotificationLedger_workspaceId_channelId_createdAt_idx"
  ON "PersonalWhatsAppNotificationLedger"("workspaceId", "channelId", "createdAt");
