import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const repoRoot = process.cwd();
const runtimeSource = readFileSync(join(repoRoot, "lib", "whatsapp-web.ts"), "utf8");
const routeSource = readFileSync(
  join(repoRoot, "app", "api", "inbox", "history-sync-status", "route.ts"),
  "utf8"
);
const bellSource = readFileSync(join(repoRoot, "components", "dashboard-notifications.tsx"), "utf8");

test("runtime only records a full catch-up after all retry queues are empty", () => {
  assert.match(runtimeSource, /const hasDeferredChats = runtime\.deferredHistoryChatIds\.length > 0/);
  assert.match(runtimeSource, /syncFullyCaughtUp = runtime\.historyTimedOutChatIds\.size === 0/);
  assert.match(runtimeSource, /if \(syncFullyCaughtUp\) \{[\s\S]*runtime\.historySyncFullyCaughtUp = true/);
});

test("history sync status requires every active personal WhatsApp channel to be caught up", () => {
  assert.match(routeSource, /channelStatuses\.length > 0 && channelStatuses\.every\(\(channel\) => channel\.isCaughtUp\)/);
  assert.match(routeSource, /historySync\?\.phase === "idle"/);
  assert.match(routeSource, /historySync\.active !== true/);
  assert.match(routeSource, /runtimeStatus === "READY"/);
});

test("the bell invalidates an unread completion on a message and polls for confirmation again", () => {
  assert.match(bellSource, /queueHistorySyncRecheck/);
  assert.match(bellSource, /refreshHistorySyncStatusRef\.current\(\)/);
  assert.match(bellSource, /getHistorySyncNotificationId\(queued\.invalidatedNotificationKey\)/);
  assert.match(bellSource, /\/api\/inbox\/history-sync-status/);
});
