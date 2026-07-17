CREATE TABLE "InboxNewConversationRequest" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "displayName" TEXT,
  "messageBody" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "providerMessageId" TEXT,
  "contactId" TEXT,
  "conversationId" TEXT,
  "messageId" TEXT,
  "wasExistingContact" BOOLEAN,
  "wasExistingConversation" BOOLEAN,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "InboxNewConversationRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InboxNewConversationRequest_workspaceId_idempotencyKey_key"
  ON "InboxNewConversationRequest"("workspaceId", "idempotencyKey");

CREATE INDEX "InboxNewConversationRequest_workspaceId_createdAt_idx"
  ON "InboxNewConversationRequest"("workspaceId", "createdAt");

CREATE INDEX "InboxNewConversationRequest_channelId_createdAt_idx"
  ON "InboxNewConversationRequest"("channelId", "createdAt");

ALTER TABLE "InboxNewConversationRequest"
  ADD CONSTRAINT "InboxNewConversationRequest_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InboxNewConversationRequest"
  ADD CONSTRAINT "InboxNewConversationRequest_agentId_fkey"
  FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InboxNewConversationRequest"
  ADD CONSTRAINT "InboxNewConversationRequest_channelId_fkey"
  FOREIGN KEY ("channelId") REFERENCES "WhatsAppChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
