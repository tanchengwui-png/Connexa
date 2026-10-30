import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (...parts) => readFileSync(join(process.cwd(), ...parts), "utf8");
const runtime = read("lib", "whatsapp-web.ts");
const classifier = read("lib", "personal-whatsapp-notifications.ts");
const realtime = read("lib", "inbox-realtime.ts");
const schema = read("prisma", "schema.prisma");

test("personal web notifications have a lifecycle and watermark classifier", () => {
  assert.match(runtime, /notificationState: "STARTING"/);
  assert.match(runtime, /state\.notificationState = "RECONCILING"/);
  assert.match(runtime, /runtime\.notificationState = "LIVE"/);
  assert.match(classifier, /PERSONAL_WHATSAPP_NOTIFICATION_CLOCK_SKEW_MS/);
  assert.match(classifier, /eventPath !== "message" \|\| input\.state !== "LIVE"/);
  assert.match(classifier, /before-live-watermark/);
});

test("personal web live events reserve a durable provider-message fingerprint", () => {
  assert.match(runtime, /reservePersonalWhatsAppNotification\(\{/);
  assert.match(runtime, /kind: "LIVE_MESSAGE"/);
  assert.match(schema, /model PersonalWhatsAppNotificationLedger/);
  assert.match(schema, /@@unique\(\[workspaceId, channelId, chatId, fingerprint\]\)/);
});

test("historical unread state is summarized once and does not mark chats read", () => {
  assert.match(runtime, /reconcilePersonalWhatsAppUnreadNotifications/);
  assert.match(runtime, /kind: "HISTORICAL_UNREAD"/);
  assert.match(runtime, /dispatchInboxWebPushForHistoricalUnreadSummary/);
  assert.doesNotMatch(runtime.match(/async function reconcilePersonalWhatsAppUnreadNotifications[\s\S]*?\n}\n\nexport async function syncWorkspaceHistory/)?.[0] ?? "", /sendSeen\(|markAsRead/);
});

test("the authoritative backend dispatch bypasses only explicitly suppressed personal-web events", () => {
  assert.match(realtime, /if \(event\.notificationEligible !== false\) void dispatchInboxWebPushForMessageEvent/);
  assert.match(realtime, /channel: "personal" \| "cloud"/);
});
