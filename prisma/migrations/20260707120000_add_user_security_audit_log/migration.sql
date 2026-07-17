CREATE TABLE IF NOT EXISTS "UserSecurityAuditLog" (
  id TEXT PRIMARY KEY,
  "agentId" TEXT NOT NULL REFERENCES "Agent"(id) ON DELETE CASCADE,
  "adminId" TEXT REFERENCES "PlatformAdmin"(id) ON DELETE SET NULL,
  "eventType" TEXT NOT NULL,
  "metadataJson" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "UserSecurityAuditLog_agentId_createdAt_idx"
ON "UserSecurityAuditLog" ("agentId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "UserSecurityAuditLog_eventType_createdAt_idx"
ON "UserSecurityAuditLog" ("eventType", "createdAt" DESC);
