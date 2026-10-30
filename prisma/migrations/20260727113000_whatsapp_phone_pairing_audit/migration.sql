CREATE TABLE IF NOT EXISTS "WhatsAppPhonePairingAudit" (
  id TEXT PRIMARY KEY,
  "workspaceId" TEXT NOT NULL REFERENCES "Workspace"(id) ON DELETE CASCADE,
  "channelId" TEXT NOT NULL REFERENCES "WhatsAppChannel"(id) ON DELETE CASCADE,
  "agentId" TEXT NOT NULL REFERENCES "Agent"(id) ON DELETE CASCADE,
  "phoneNumberCiphertext" TEXT NOT NULL,
  "pairingCodeCiphertext" TEXT NOT NULL,
  "maskedPhoneNumber" TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'GENERATED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "WhatsAppPhonePairingAudit_workspaceId_createdAt_idx"
  ON "WhatsAppPhonePairingAudit" ("workspaceId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "WhatsAppPhonePairingAudit_channelId_createdAt_idx"
  ON "WhatsAppPhonePairingAudit" ("channelId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "WhatsAppPhonePairingAudit_agentId_createdAt_idx"
  ON "WhatsAppPhonePairingAudit" ("agentId", "createdAt" DESC);
