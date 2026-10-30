import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const source = (...parts) => readFileSync(join(root, ...parts), "utf8");
const inboxWorkspace = source("components", "inbox-workspace.tsx");
const statusStrip = source("components", "inbox", "status-strip.tsx");
const conversationRoute = source("app", "api", "conversations", "route.ts");
const detailRoute = source("app", "api", "conversations", "[id]", "route.ts");
const dbConversations = source("lib", "db-conversations.ts");
const inbox = source("lib", "inbox.ts");
const historyState = source("lib", "whatsapp-history-sync-state.ts");
const historyRuntime = source("lib", "whatsapp-web.ts");
const whatsappPersistence = source("lib", "whatsapp.ts");
const envelopes = source("lib", "whatsapp-message-envelope.ts");
const migration = source("prisma", "migrations", "20261020170000_inbox_sync_optimization", "migration.sql");

test("sync presentation uses explicit phases and only animates active work", () => {
  assert.match(statusStrip, /whatsapp\.historySyncActive/);
  assert.match(statusStrip, /historySyncPhase/);
  assert.match(statusStrip, /historySyncProgressAt/);
  assert.match(statusStrip, /is-active/);
  assert.doesNotMatch(inboxWorkspace, /!liveWhatsApp\.historySyncFullyCaughtUp[;\n]/);
  assert.match(inboxWorkspace, /historySyncPhase === "deferred"/);
  assert.match(inboxWorkspace, /historySyncPhase === "error"/);
});

test("conversation list and detail endpoints are purpose-built and paginated", () => {
  assert.match(conversationRoute, /getInboxConversationListPage/);
  assert.doesNotMatch(conversationRoute, /getInboxData/);
  assert.match(conversationRoute, /if-none-match/i);
  assert.match(conversationRoute, /status: 304/);
  assert.match(detailRoute, /getInboxConversationData/);
  assert.doesNotMatch(detailRoute, /getInboxData/);
  assert.match(inbox, /getConversationScheduledStats\(workspaceId, \[conversationId\]\)/);
  assert.match(dbConversations, /conv\."lastMessageAt" < \$\$\{values\.length - 1\}[\s\S]*conv\.id < \$\$\{values\.length\}/);
  assert.match(dbConversations, /m\."sentAt" < \$2[\s\S]*m\.id < \$3/);
  assert.match(inboxWorkspace, /loadMoreConversations/);
  assert.match(inboxWorkspace, /loadOlderMessages/);
});

test("realtime is primary and fallback recovery is visibility-aware and sparse", () => {
  assert.match(inboxWorkspace, /new EventSource\(`/);
  assert.match(inboxWorkspace, /document\.visibilityState !== "visible"/);
  assert.match(inboxWorkspace, /90_000 \+ Math\.floor\(Math\.random\(\) \* 15_000\)/);
  assert.match(inboxWorkspace, /refreshTimer !== null/);
  assert.match(inboxWorkspace, /Date\.now\(\) - lastErrorRecoveryAt < 30_000/);
  assert.match(inboxWorkspace, /Promise\.all\(\[/);
  assert.match(inboxWorkspace, /\/api\/inbox\/history-sync-status/);
});

test("history deduplicates before media work and preserves incomplete-media repair", () => {
  const batchLookup = historyRuntime.indexOf("loadStoredHistoryMessages({");
  const mediaExtraction = historyRuntime.indexOf("extractIncomingMediaAttachment({", batchLookup);
  assert.ok(batchLookup >= 0 && mediaExtraction > batchLookup);
  assert.match(historyRuntime, /storedMediaComplete = message\.hasMedia && isStoredHistoryMediaComplete/);
  assert.match(historyRuntime, /mediaDownloadsAvoided \+= 1/);
  assert.match(historyRuntime, /mediaDownloadFailures \+= 1/);
  assert.match(historyRuntime, /mediaBytesDownloaded \+=/);
});

test("unchanged history records use conditional writes", () => {
  assert.match(whatsappPersistence, /UPDATE "Message"[\s\S]*IS DISTINCT FROM/);
  assert.match(whatsappPersistence, /UPDATE "Conversation"[\s\S]*IS DISTINCT FROM/);
  assert.match(whatsappPersistence, /UPDATE "Contact"[\s\S]*IS DISTINCT FROM/);
  assert.match(whatsappPersistence, /tagsManualOverride \? contact\.tags/);
  assert.match(envelopes, /ON CONFLICT \("providerMessageId"\) DO UPDATE SET[\s\S]*WHERE "WhatsAppMessageEnvelope"/);
  assert.match(envelopes, /written: writeResult\.rowCount === 1/);
});

test("durable checkpoints and expiring fenced leases are additive and tenant scoped", () => {
  assert.match(migration, /CREATE TABLE "WhatsAppHistorySyncState"/);
  assert.match(migration, /CREATE TABLE "WhatsAppHistoryCheckpoint"/);
  assert.match(migration, /CREATE TABLE "WhatsAppHistoryLease"/);
  assert.match(migration, /UNIQUE INDEX "WhatsAppHistoryCheckpoint_workspaceId_channelId_remoteChatId_key"/);
  assert.doesNotMatch(migration, /DROP TABLE|TRUNCATE|DELETE FROM/);
  assert.match(historyState, /WHERE "workspaceId" = \$1 AND "channelId" = \$2/);
  assert.match(historyState, /"expiresAt" <= NOW\(\)/);
  assert.match(historyState, /"ownerId" = \$2 AND generation = \$3/);
  assert.match(historyState, /"channelId" = \$2 AND generation = \$14/);
  assert.match(historyState, /lease\."expiresAt" > NOW\(\)/);
  assert.match(historyState, /interrupted = row\.active && !row\.leaseActive/);
  assert.match(historyState, /active: row\.active && row\.leaseActive/);
  assert.match(historyRuntime, /renewWhatsAppHistoryLease/);
  assert.match(historyRuntime, /releaseWhatsAppHistoryLease/);
});

test("incremental reconciliation is shadowed by default and records recoverable identity failures", () => {
  assert.match(historyState, /\? configured : "shadow"/);
  assert.match(historyRuntime, /incrementalMode === "shadow"/);
  assert.match(historyRuntime, /incrementalMode === "on"/);
  assert.match(historyRuntime, /WHATSAPP_INCREMENTAL_OVERLAP_MESSAGES/);
  assert.match(historyRuntime, /deepAuditChatIds/);
  assert.match(historyRuntime, /Stable phone identity is not available for this LID chat yet/);
  assert.match(historyRuntime, /recordWhatsAppHistoryCheckpointFailure/);
  assert.match(historyRuntime, /recordWhatsAppHistoryCheckpointSuccess/);
});

