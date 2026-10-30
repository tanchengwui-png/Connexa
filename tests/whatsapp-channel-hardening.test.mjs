import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  canCreateAnotherChannel,
  pickOnlyChannelId,
  resolveBackfillChannelId,
  shouldDeleteChannelRecord
} from "../lib/whatsapp-channel-hardening.js";

const repoRoot = process.cwd();
const whatsappRuntimeSource = readFileSync(join(repoRoot, "lib", "whatsapp-web.ts"), "utf8");
const whatsappRuntimeEventsSource = readFileSync(
  join(repoRoot, "lib", "whatsapp-runtime-events.ts"),
  "utf8"
);
const senderServiceSource = readFileSync(join(repoRoot, "scripts", "sender-service.ts"), "utf8");

test("pickOnlyChannelId returns one distinct id", () => {
  assert.equal(pickOnlyChannelId(["a", "a", "a"]), "a");
  assert.equal(pickOnlyChannelId(["a", null, "a", undefined]), "a");
});

test("pickOnlyChannelId returns null when channel ids conflict", () => {
  assert.equal(pickOnlyChannelId(["a", "b"]), null);
  assert.equal(pickOnlyChannelId([null, undefined]), null);
});

test("resolveBackfillChannelId prefers current channel id", () => {
  assert.equal(
    resolveBackfillChannelId({
      currentChannelId: "current",
      relatedChannelIds: ["a", "b"],
      workspaceDefaultChannelId: "default"
    }),
    "current"
  );
});

test("resolveBackfillChannelId uses single related id before default", () => {
  assert.equal(
    resolveBackfillChannelId({
      currentChannelId: null,
      relatedChannelIds: ["related", "related"],
      workspaceDefaultChannelId: "default"
    }),
    "related"
  );
});

test("resolveBackfillChannelId refuses ambiguous related ids", () => {
  assert.equal(
    resolveBackfillChannelId({
      currentChannelId: null,
      relatedChannelIds: ["a", "b"],
      workspaceDefaultChannelId: "default"
    }),
    null
  );
});

test("resolveBackfillChannelId falls back to workspace default only when no related ids exist", () => {
  assert.equal(
    resolveBackfillChannelId({
      currentChannelId: null,
      relatedChannelIds: [],
      workspaceDefaultChannelId: "default"
    }),
    "default"
  );
});

test("canCreateAnotherChannel respects plan limit", () => {
  assert.equal(canCreateAnotherChannel({ currentChannelCount: 0, numberLimit: 1 }), true);
  assert.equal(canCreateAnotherChannel({ currentChannelCount: 1, numberLimit: 1 }), false);
  assert.equal(canCreateAnotherChannel({ currentChannelCount: 99, numberLimit: null }), true);
});

test("shouldDeleteChannelRecord preserves the last channel shell", () => {
  assert.equal(shouldDeleteChannelRecord(1), false);
  assert.equal(shouldDeleteChannelRecord(2), true);
});

test("WhatsApp runtime hardening adds initialize timeouts and bounded reconnect backoff", () => {
  assert.match(whatsappRuntimeSource, /const WHATSAPP_INITIALIZE_TIMEOUT_MS = Math\.max\(/);
  assert.match(whatsappRuntimeSource, /await Promise\.race\(\[\s*state\.client\.initialize\(\),/s);
  assert.match(whatsappRuntimeSource, /scheduleWhatsAppRuntimeRecovery\(\{/);
  assert.match(whatsappRuntimeSource, /isWhatsAppRuntimeRecoveryCurrent\(\{/);
});

test("temporary Chromium executable lookups retry without requiring a QR session reset", () => {
  assert.match(whatsappRuntimeSource, /function isTransientBrowserExecutableError/);
  assert.match(whatsappRuntimeSource, /message\.includes\("tried to find the browser at the configured path"\)/);
  assert.match(whatsappRuntimeSource, /isTransientBrowserExecutableError\(error\)/);
  assert.match(
    whatsappRuntimeSource,
    /isTransientBrowserExecutableError\(error\)[\s\S]*\? WHATSAPP_BROWSER_RETRY_DELAY_MS[\s\S]*: WHATSAPP_RECONNECT_BASE_MS/
  );
});

test("WhatsApp runtime recycles stale cached sessions instead of reusing them forever", () => {
  assert.match(
    whatsappRuntimeSource,
    /function shouldRecycleRuntimeState\(state: RuntimeState\) \{[\s\S]*runtimeRecoveryTimers\.has\(state\.channelId\) \|\| isUnrecoverableRuntimeStatus\(state\.connectionStatus\)[\s\S]*Date\.now\(\) - state\.statusUpdatedAt > WHATSAPP_STALE_RUNTIME_MS[\s\S]*\}/
  );
  assert.match(whatsappRuntimeSource, /eventType: WHATSAPP_RUNTIME_EVENT_TYPES\.RUNTIME_RECYCLED/);
  assert.match(whatsappRuntimeEventsSource, /RUNTIME_RECYCLED: "RUNTIME_RECYCLED"/);
});

test("provider logout signals preserve LocalAuth and require explicit re-auth", () => {
  assert.match(
    whatsappRuntimeSource,
    /if \(isSessionInvalidationDisconnectReason\(reason\)\) \{[\s\S]*markWhatsAppRuntimeReauthRequired\(\{[\s\S]*errorCode: "SESSION_INVALIDATED"/
  );
  assert.doesNotMatch(
    whatsappRuntimeSource,
    /isSessionInvalidationDisconnectReason\(reason\)[\s\S]{0,500}clearWhatsAppChannelSession/
  );
});

test("retired WhatsApp clients cannot emit events into the active runtime", () => {
  assert.match(
    whatsappRuntimeSource,
    /previousClient\.removeAllListeners\(\);[\s\S]*replacing runtime client \$\{state\.channelId\}[\s\S]*browserProcess\?\.kill\("SIGKILL"\)/
  );
  assert.match(
    whatsappRuntimeSource,
    /const boundClient = state\.client;[\s\S]*const isCurrentClient = \(\) => isActiveRuntimeState\(state\) && state\.client === boundClient;/
  );
  assert.match(
    whatsappRuntimeSource,
    /boundClient\.on\("disconnected"[\s\S]*if \(!isCurrentClient\(\)\) \{\s*return;/
  );
  assert.match(
    whatsappRuntimeSource,
    /boundClient\.on\("message"[\s\S]*boundClient\.on\("message_ack"[\s\S]*boundClient\.on\("message_reaction"/
  );
  assert.match(
    whatsappRuntimeSource,
    /boundClient\.on\("authenticated"[\s\S]*\["AUTHENTICATED", "CONNECTED", "READY", "SYNCING_HISTORY"\]\.includes\(state\.connectionStatus\)/
  );
  assert.match(
    whatsappRuntimeSource,
    /boundClient\.on\("ready"[\s\S]*\["CONNECTED", "READY", "SYNCING_HISTORY"\]\.includes\(state\.connectionStatus\)/
  );
});

test("Inbox new-conversation sends through the single sender-service runtime facade", () => {
  const newConversationSource = readFileSync(
    join(process.cwd(), "lib", "inbox-new-conversation.ts"),
    "utf8"
  );

  assert.match(newConversationSource, /import \{ sendWhatsAppMessage \} from "@\/lib\/whatsapp-runtime";/);
  assert.doesNotMatch(newConversationSource, /from "@\/lib\/whatsapp-web"/);
  assert.match(newConversationSource, /await sendWhatsAppMessage\(\{/);
});

test("WhatsApp history sync tears down runtimes by channel id, not workspace id", () => {
  assert.match(whatsappRuntimeSource, /await teardownActiveRuntimeStateSerialized\(runtime\);/);
  assert.match(
    whatsappRuntimeSource,
    /runSerializedChannelLifecycle\(state\.channelId,[\s\S]*await teardownRuntimeState\(state\.channelId, options\);/
  );
  assert.doesNotMatch(whatsappRuntimeSource, /teardownRuntimeState\(workspaceId\)/);
});

test("WhatsApp history sync preserves partial browser history and retries failed chats", () => {
  assert.match(
    whatsappRuntimeSource,
    /fetchChatMessagesDirectly\(\{ client: input\.client, chatId, limit: 0 \}\)/
  );
  assert.match(
    whatsappRuntimeSource,
    /messages: snapshotMessages,\s*needsRetry: true,/s
  );
  assert.match(
    whatsappRuntimeSource,
    /if \(historyFetch\.needsRetry\) \{\s*deferredChatIds\.add\(chatId\);/s
  );
});

test("WhatsApp history sync cannot be blocked by one hanging bulk chat model", () => {
  assert.match(whatsappRuntimeSource, /const WHATSAPP_HISTORY_OPERATION_TIMEOUT_MS = Math\.max\(/);
  assert.match(
    whatsappRuntimeSource,
    /browserGlobal\.require\?\.\("WAWebCollections"\)\?\.Chat/
  );
  assert.match(
    whatsappRuntimeSource,
    /const chats = importableChatCandidates\.map\(\(chatCandidate\) => \{[\s\S]*fetchChatMessagesDirectly\(\{ client, chatId, limit \}\)/
  );
  assert.match(
    whatsappRuntimeSource,
    /const snapshot = chat\.attributes \?\? chat;[\s\S]*Reading optional metadata must never discard an otherwise[\s\S]*const id = chat\.id\?\._serialized/
  );
  assert.match(
    whatsappRuntimeSource,
    /if \(!isTransientWhatsAppSyncError\(error\) \|\| attempt === attempts\)/
  );
  assert.match(
    whatsappRuntimeSource,
    /browserGlobal\.require\?\.\("WAWebWidFactory"\)/
  );
  assert.match(
    whatsappRuntimeSource,
    /browserGlobal\.require\?\.\("WAWebChatLoadMessages"\)/
  );
  assert.match(
    whatsappRuntimeSource,
    /Do not delay browser restoration with a channel-wide message count\.[\s\S]*const hasImportedHistory = channel\.connectionStatus === "READY";/
  );
  assert.match(
    whatsappRuntimeSource,
    /const unseenChats = importableChats\.filter\([\s\S]*!importedRemoteIds\.has\(chatId\)[\s\S]*unseenChats\.slice\(0, batchSize\)/
  );
  assert.match(
    whatsappRuntimeSource,
    /!runtime\.historyAttemptedUnseenChatIds\.has\(chatId\)[\s\S]*runtime\.historyAttemptedUnseenChatIds\.add\(chatId\)/
  );
});

test("WhatsApp history sync quarantines timed-out chats without recycling healthy live sessions", () => {
  assert.match(whatsappRuntimeSource, /const WHATSAPP_HISTORY_SYNC_WATCHDOG_MS = Math\.max\(/);
  assert.match(
    whatsappRuntimeSource,
    /runtime\.isSyncingHistory = true;\s*runtime\.historySyncProgressAt = Date\.now\(\);\s*updateRuntimeStatus\(runtime, "SYNCING_HISTORY"\);\s*scheduleHistorySyncWatchdog\(runtime\);/
  );
  assert.match(
    whatsappRuntimeSource,
    /if \(isWhatsAppHistoryOperationTimeout\(error\)\) \{[\s\S]*runtime\.historyTimedOutChatIds\.add\(chatId\);[\s\S]*chat-timeout-quarantined/
  );
  assert.match(
    whatsappRuntimeSource,
    /runWhatsAppHistoryOperation\([\s\S]*recovering fallback history for \$\{chatId \?\? "chat"\}[\s\S]*WHATSAPP_HISTORY_CHAT_TIMEOUT_MS/
  );
  assert.match(
    whatsappRuntimeSource,
    /!runtime\.historyTimedOutChatIds\.has\(chatId\)[\s\S]*processedChatCount = chatIndex \+ 1/
  );
  assert.doesNotMatch(
    whatsappRuntimeSource,
    /trigger: "history-operation-timeout"/
  );
  assert.match(
    whatsappRuntimeSource,
    /forced browser termination after teardown timeout[\s\S]*browserProcess\?\.kill\("SIGKILL"\)/
  );
});

test("completed large accounts pace periodic history batches", () => {
  assert.match(
    whatsappRuntimeSource,
    /runtime\.hasCompletedInitialSync && !isUnseenBatch[\s\S]*getRoutineHistoryDelayMs\(\)[\s\S]*WHATSAPP_HISTORY_RETRY_BASE_MS/
  );
});

test("automatic runtime recovery preserves completed-history state", () => {
  assert.match(
    whatsappRuntimeSource,
    /restartRuntimePreservingSession[\s\S]*scheduleRuntimeReconnect\(state\)/
  );
  assert.match(
    whatsappRuntimeSource,
    /const hasImportedHistory =\s*input\.initialHistorySyncCompleted \?\?[\s\S]*initialHistorySyncCompleted: hasImportedHistory/
  );
  assert.match(
    whatsappRuntimeSource,
    /const previousDurableState = await readWhatsAppHistorySyncState[\s\S]*if \(previousDurableState\?\.lastSuccessfulSyncAt\) \{[\s\S]*runtime\.hasCompletedInitialSync = true;/
  );
});

test("relinking a mature channel preserves completed-history state", () => {
  assert.match(
    whatsappRuntimeSource,
    /History state is loaded from its durable checkpoint immediately before[\s\S]*const hasImportedHistory = input\.initialHistorySyncCompleted \?\? channel\.connectionStatus === "READY";/
  );
  const ensurePath = whatsappRuntimeSource.slice(
    whatsappRuntimeSource.indexOf("async function ensureWorkspaceWhatsAppClientUnlocked"),
    whatsappRuntimeSource.indexOf("export async function requestWhatsAppWebClientPairingCode")
  );
  assert.doesNotMatch(ensurePath, /prisma\.message\.count/);
});

test("WhatsApp history sync defers a cursor-only import instead of appearing stuck forever", () => {
  assert.match(
    whatsappRuntimeSource,
    /const hasImportedUsableHistory = importedChats > 0 \|\| importedMessages > 0;/
  );
  assert.match(
    whatsappRuntimeSource,
    /!runtime\.hasCompletedInitialSync[\s\S]*hasMoreChatsToSync[\s\S]*!hasImportedUsableHistory[\s\S]*historyImportElapsedMs >= WHATSAPP_HISTORY_STUCK_MS[\s\S]*deferHistoryImport\(runtime\)/
  );
});

test("partial imported history becomes ready while failed chats continue in the background", () => {
  assert.match(
    whatsappRuntimeSource,
    /const existingImportedMessageCount = await prisma\.message\.count\([\s\S]*channelId: runtime\.channelId[\s\S]*if \(existingImportedMessageCount > 0\) \{[\s\S]*syncCompleted = true;/
  );
  assert.match(
    whatsappRuntimeSource,
    /if \(isTransientWhatsAppSyncError\(error\)\) \{[\s\S]*existingImportedMessageCount = await prisma\.message\.count\([\s\S]*finalized partial history after transient sync failure[\s\S]*syncCompleted = true;/
  );
});

test("manual history-sync timeouts schedule the same automatic recovery as background syncs", () => {
  assert.match(
    whatsappRuntimeSource,
    /if \(isTransientWhatsAppSyncError\(error\)\) \{[\s\S]*All automatic imports are sender-owned[\s\S]*shouldRetryInBackground = true;[\s\S]*return \{ importedChats: 0, importedMessages: 0 \};/
  );
  assert.doesNotMatch(
    whatsappRuntimeSource,
    /if \(isTransientWhatsAppSyncError\(error\)\) \{\s*if \(resolvedOptions\.triggeredBy === "background"\)/
  );
});

test("a minified WhatsApp Web hydration rejection is retried instead of stranding history sync", () => {
  assert.match(
    whatsappRuntimeSource,
    /function isTransientWhatsAppSyncError\(error: unknown\) \{[\s\S]*message === "r"[\s\S]*isTransientSetupMessage\(message\)[\s\S]*isTransientExecutionContextError\(error\)/
  );
});

test("sender startup resumes a channel that was persisted mid-history-sync", () => {
  assert.match(senderServiceSource, /SELECT "id", "workspaceId", "connectionStatus", "connectedAt", "nextRecoveryAt"/);
  assert.match(
    senderServiceSource,
    /restorePersistedWhatsAppSessions\(\)[\s\S]*restoreWorkspaceWhatsAppClient\(channel\.workspaceId, channel\.id\)/
  );
  assert.doesNotMatch(senderServiceSource, /restorePersistedWhatsAppSessions\(\)[\s\S]*syncWorkspaceHistory\(/);
  assert.match(
    whatsappRuntimeSource,
    /boundClient\.on\("ready"[\s\S]*scheduleBackgroundSync\(state, WHATSAPP_BOOTSTRAP_START_DELAY_MS, "bootstrap"\)/
  );
});

test("sender startup repairs the additive push-name schema before restoring sessions", () => {
  assert.match(
    senderServiceSource,
    /ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "whatsappPushName" TEXT/
  );
  assert.ok(
    senderServiceSource.indexOf("await ensureSenderDatabaseSchema();") <
      senderServiceSource.indexOf("server.listen(port, host")
  );
  assert.match(
    senderServiceSource,
    /CREATE TABLE IF NOT EXISTS "PersonalWhatsAppNotificationLedger"/
  );
});

test("non-transient history failures preserve live messaging and schedule a retry", () => {
  assert.match(
    whatsappRuntimeSource,
    /A schema mismatch or another persistent per-batch failure[\s\S]*runtime\.connectionStatus = runtime\.hasCompletedInitialSync \? "READY" : "CONNECTED";[\s\S]*runtime\.lastError = `Historical import will retry automatically:[\s\S]*shouldRetryInBackground = true;[\s\S]*return \{ importedChats: 0, importedMessages: 0 \};/
  );
});

test("WhatsApp history fetch bypasses the broken getChat helper for LID chats", () => {
  assert.match(
    whatsappRuntimeSource,
    /const chatCollection = browserGlobal\.Store\?\.Chat \?\? collections\?\.Chat;[\s\S]*chatCollection\?\.get\?\.\(wid\)/
  );
  assert.match(
    whatsappRuntimeSource,
    /browserGlobal\.Store\?\.ConversationMsgs[\s\S]*historyLoader\?\.loadEarlierMsgs\?\.\(chat, chat\.msgs\)/
  );
  assert.doesNotMatch(
    whatsappRuntimeSource,
    /activeChat\.fetchMessages\(\{ limit: input\.limit \}\)/
  );
  assert.match(
    whatsappRuntimeSource,
    /isUnsupportedHistoryLoader = paginationError\.includes\("waitForChatLoading"\);\s*needsRetry = !isUnsupportedHistoryLoader;/s
  );
});
