import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const source = (...parts) => readFileSync(join(root, ...parts), "utf8");
const setup = source("components", "web-qr-setup-panel.tsx");
const settingsRoute = source("app", "api", "settings", "whatsapp", "route.ts");
const runtime = source("lib", "whatsapp-web.ts");
const whatsapp = source("lib", "whatsapp.ts");
const historyState = source("lib", "whatsapp-history-sync-state.ts");
const inbox = source("lib", "inbox.ts");
const inboxWorkspace = source("components", "inbox-workspace.tsx");

test("ready owns connection completion and setup never starts history", () => {
  assert.doesNotMatch(setup, /method:\s*"PATCH"/);
  assert.doesNotMatch(setup, /syncWorkspaceHistory|Imported \$\{/);
  assert.doesNotMatch(settingsRoute, /export async function PATCH/);
  assert.match(runtime, /boundClient\.on\("ready"/);
  assert.match(runtime, /connectionStatus:\s*"CONNECTED"/);
  assert.match(runtime, /scheduleBackgroundSync\(state, WHATSAPP_BOOTSTRAP_START_DELAY_MS, "bootstrap"\)/);
  assert.match(setup, /href="\/inbox"/);
});

test("history is progressive, bounded, media-lazy, and timeout-fenced", () => {
  assert.match(runtime, /WHATSAPP_BOOTSTRAP_CHAT_BATCH[\s\S]*"5"/);
  assert.match(runtime, /WHATSAPP_BOOTSTRAP_MESSAGE_LIMIT[\s\S]*"20"/);
  assert.match(runtime, /WHATSAPP_BOOTSTRAP_START_DELAY_MS[\s\S]*\?\? "0"/);
  assert.match(historyState, /"fast_bootstrap"/);
  assert.match(historyState, /"incremental_sync"/);
  assert.match(historyState, /"media_enrichment"/);
  assert.match(runtime, /isMediaEnrichmentPhase\s*\? await extractIncomingMediaAttachment/);
  assert.match(runtime, /historyOperationFence !== operationFence/);
  assert.match(runtime, /history-operation-timeout-fence/);
  assert.match(runtime, /HISTORY_CHAT_TIMEOUT/);
});

test("history imports chats and messages serially from newest to oldest", () => {
  assert.match(
    runtime,
    /\.sort\(\(left, right\) => getChatSortTimestamp\(right\) - getChatSortTimestamp\(left\)\)/
  );
  assert.match(
    runtime,
    /const newestFirstMessages = \[\.\.\.historyFetch\.messages\]\.sort\([\s\S]*?\(right\.timestamp \?\? 0\) - \(left\.timestamp \?\? 0\)/
  );
  assert.match(runtime, /for \(const \[chatIndex, chat\] of chatsToSync\.entries\(\)\)/);
  assert.match(runtime, /for \(const message of messages\)/);
  assert.doesNotMatch(runtime, /Promise\.all\(\s*messages\.map/);
  assert.match(
    whatsapp,
    /const messagesNewestFirst = \[\.\.\.input\.messages\][\s\S]*?\(right\.timestamp \?\? 0\) - \(left\.timestamp \?\? 0\)/
  );
  assert.match(whatsapp, /for \(const message of messagesNewestFirst\)/);
});

test("Inbox defers media and bounds synchronous sender health", () => {
  assert.match(inbox, /mediaAssets:\s*\[\]/);
  assert.match(inbox, /WHATSAPP_INBOX_HEALTH_TIMEOUT_MS[\s\S]*"300"/);
  assert.match(inboxWorkspace, /fetch\("\/api\/inbox\/media-assets"/);
  assert.match(inboxWorkspace, /\["CONNECTED", "READY", "SYNCING_HISTORY"\]\.includes/);
});

test("incremental rollout remains shadowed by default and reports comparisons", () => {
  assert.match(historyState, /WHATSAPP_INCREMENTAL_ROLLOUT_PERCENT/);
  assert.match(runtime, /legacySelectedConversations=/);
  assert.match(runtime, /incrementalSelectedConversations=/);
  assert.match(runtime, /shadowMissedMessages=/);
  assert.match(runtime, /incompleteHistoryTransfers=/);
  assert.match(runtime, /databaseWriteDurationMs=/);
});
