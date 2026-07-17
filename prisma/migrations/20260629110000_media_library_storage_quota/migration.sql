ALTER TABLE "Workspace"
ADD COLUMN IF NOT EXISTS "mediaLibraryUsedBytes" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "PlatformPackageConfig"
ADD COLUMN IF NOT EXISTS "mediaLibraryStorageLimitBytes" INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'MediaAssetSource') THEN
    CREATE TYPE "MediaAssetSource" AS ENUM (
      'MEDIA_LIBRARY',
      'INBOX',
      'QUICK_REPLY',
      'CAMPAIGN',
      'AUTOMATION_RULE',
      'AUTOMATION_WORKFLOW',
      'WHATSAPP_INBOUND'
    );
  END IF;
END $$;

ALTER TABLE "WorkspaceMediaAsset"
ADD COLUMN IF NOT EXISTS "checksumSha256" TEXT,
ADD COLUMN IF NOT EXISTS "sourceModule" "MediaAssetSource" NOT NULL DEFAULT 'MEDIA_LIBRARY';

ALTER TABLE "Message"
ADD COLUMN IF NOT EXISTS "mediaAssetId" TEXT;

ALTER TABLE "OutboundMessageJob"
ADD COLUMN IF NOT EXISTS "mediaAssetId" TEXT;

ALTER TABLE "WhatsAppMessageEnvelope"
ADD COLUMN IF NOT EXISTS "mediaAssetId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'Message_mediaAssetId_fkey'
  ) THEN
    ALTER TABLE "Message"
    ADD CONSTRAINT "Message_mediaAssetId_fkey"
    FOREIGN KEY ("mediaAssetId") REFERENCES "WorkspaceMediaAsset"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'OutboundMessageJob_mediaAssetId_fkey'
  ) THEN
    ALTER TABLE "OutboundMessageJob"
    ADD CONSTRAINT "OutboundMessageJob_mediaAssetId_fkey"
    FOREIGN KEY ("mediaAssetId") REFERENCES "WorkspaceMediaAsset"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'WhatsAppMessageEnvelope_mediaAssetId_fkey'
  ) THEN
    ALTER TABLE "WhatsAppMessageEnvelope"
    ADD CONSTRAINT "WhatsAppMessageEnvelope_mediaAssetId_fkey"
    FOREIGN KEY ("mediaAssetId") REFERENCES "WorkspaceMediaAsset"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "Message_mediaAssetId_idx"
ON "Message"("mediaAssetId");

CREATE INDEX IF NOT EXISTS "OutboundMessageJob_mediaAssetId_availableAt_idx"
ON "OutboundMessageJob"("mediaAssetId", "availableAt");

CREATE INDEX IF NOT EXISTS "WhatsAppMessageEnvelope_mediaAssetId_idx"
ON "WhatsAppMessageEnvelope"("mediaAssetId");

CREATE INDEX IF NOT EXISTS "WorkspaceMediaAsset_workspaceId_createdAt_idx"
ON "WorkspaceMediaAsset"("workspaceId", "createdAt");

CREATE INDEX IF NOT EXISTS "WorkspaceMediaAsset_workspaceId_checksumSha256_idx"
ON "WorkspaceMediaAsset"("workspaceId", "checksumSha256");

CREATE UNIQUE INDEX IF NOT EXISTS "WorkspaceMediaAsset_workspaceId_storagePath_key"
ON "WorkspaceMediaAsset"("workspaceId", "storagePath");
