ALTER TABLE "Message"
ADD COLUMN IF NOT EXISTS "deliveryStatus" TEXT NOT NULL DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS "ack" INTEGER,
ADD COLUMN IF NOT EXISTS "ackUpdatedAt" TIMESTAMP(3);

UPDATE "Message"
SET "deliveryStatus" = CASE
  WHEN "readAt" IS NOT NULL THEN 'read'
  WHEN "deliveredAt" IS NOT NULL THEN 'delivered'
  WHEN "providerMessageId" IS NOT NULL AND direction = 'OUTBOUND' THEN 'sent'
  ELSE "deliveryStatus"
END
WHERE direction = 'OUTBOUND';

CREATE INDEX IF NOT EXISTS "Message_deliveryStatus_idx"
ON "Message"("deliveryStatus");

CREATE INDEX IF NOT EXISTS "Message_ackUpdatedAt_idx"
ON "Message"("ackUpdatedAt");
