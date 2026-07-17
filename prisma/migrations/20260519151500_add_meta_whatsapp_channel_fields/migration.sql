ALTER TABLE "WhatsAppChannel"
ADD COLUMN "provider" TEXT,
ADD COLUMN "channelType" TEXT,
ADD COLUMN "tokenExpiresAt" TIMESTAMP(3),
ADD COLUMN "disconnectedAt" TIMESTAMP(3),
ADD COLUMN "lastWebhookAt" TIMESTAMP(3);

CREATE INDEX "WhatsAppChannel_provider_channelType_idx"
ON "WhatsAppChannel"("provider", "channelType");
