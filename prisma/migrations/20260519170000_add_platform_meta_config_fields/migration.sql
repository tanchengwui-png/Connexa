ALTER TABLE "PlatformConfig"
ADD COLUMN "metaAppId" TEXT,
ADD COLUMN "metaAppSecret" TEXT,
ADD COLUMN "metaConfigId" TEXT,
ADD COLUMN "metaGraphVersion" TEXT,
ADD COLUMN "metaRedirectUri" TEXT,
ADD COLUMN "metaWebhookVerifyToken" TEXT;
