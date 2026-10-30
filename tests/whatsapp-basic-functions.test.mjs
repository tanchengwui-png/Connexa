import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = process.cwd();
const readProjectFile = (...segments) => readFileSync(join(repoRoot, ...segments), "utf8");
const whatsappRuntimeSource = readProjectFile("lib", "whatsapp-web.ts");
const whatsappIngestSource = readProjectFile("lib", "whatsapp.ts");
const inboxPushSource = readProjectFile("lib", "inbox-web-push.ts");
const inboxRealtimeSource = readProjectFile("lib", "inbox-realtime.ts");
const inboxRelayRouteSource = readProjectFile("app", "api", "internal", "inbox-events", "route.ts");
const serviceWorkerSource = readProjectFile("public", "sw.js");

test("live receive, create, acknowledgement, and reaction events are bound", () => {
  assert.match(whatsappRuntimeSource, /boundClient\.on\("message", async \(message\) =>/);
  assert.match(whatsappRuntimeSource, /boundClient\.on\("message_create", async \(message\) =>/);
  assert.match(whatsappRuntimeSource, /boundClient\.on\("message_ack", async \(message, ack\) =>/);
  assert.match(whatsappRuntimeSource, /boundClient\.on\("message_reaction", async \(reaction(?:: Reaction)?\) =>/);
});

test("outbound event capture remains outbound and cannot trigger inbound automation", () => {
  assert.match(
    whatsappIngestSource,
    /direction: input\.direction === "OUTBOUND" \? "OUTBOUND" : "INBOUND"/
  );
  assert.match(
    whatsappIngestSource,
    /if \(input\.direction !== "OUTBOUND"\) \{\s*await processInboundAutomation\(/s
  );
});

test("all send variants normalize and require a trackable provider message id", () => {
  assert.equal(
    (whatsappRuntimeSource.match(/providerMessageId: getAcceptedWhatsAppMessageProviderId\(sentMessage\)/g) ?? []).length,
    4
  );
  assert.doesNotMatch(whatsappRuntimeSource, /providerMessageId: sentMessage\.id\._serialized/);
});

test("live and historical group messages use the same participant-qualified provider id", () => {
  assert.match(
    whatsappRuntimeSource,
    /remote\?\.endsWith\("@g\.us"\)[\s\S]*?author\?\.trim\(\)[\s\S]*?serialized\.endsWith\(`_\$\{participant\}`\)/
  );
  assert.match(
    whatsappIngestSource,
    /isUnqualifiedGroupMessageId[\s\S]*?providerMessageId: \{ startsWith: `\$\{providerMessageId\}_` \}[\s\S]*?existingMessage\.providerMessageId/
  );
});

test("message_create links a running outbound job instead of creating a duplicate message", () => {
  assert.match(
    whatsappRuntimeSource,
    /existingStoredMessage = await linkRunningOutboundWhatsAppMessage\(/
  );
  assert.match(
    whatsappRuntimeSource,
    /status: \{ in: \[OutboundMessageJobStatus\.RUNNING, OutboundMessageJobStatus\.PENDING\] \}/
  );
  assert.match(
    whatsappRuntimeSource,
    /if \(!existingStoredMessage && \(body \|\| mediaAttachment\?\.attachmentUrl \|\| groupNotification\)\)/
  );
});

test("a stale WhatsApp Web id lookup restarts the runtime before the worker retries", () => {
  assert.match(whatsappRuntimeSource, /function isStaleWhatsAppRuntimeError/);
  assert.match(whatsappRuntimeSource, /cannot read properties of undefined[\s\S]*?reading 'id'/i);
  assert.match(
    whatsappRuntimeSource,
    /if \(isStaleWhatsAppRuntimeError\(message\)\) \{[\s\S]*?teardownActiveRuntimeStateSerialized\(connectedRuntime\)/
  );
});

test("mute and read receipts bypass the LID-incompatible chat serializer", () => {
  assert.match(whatsappRuntimeSource, /connectedRuntime\.client\.sendSeen\(chatId\)/);
  assert.match(whatsappRuntimeSource, /connectedRuntime\.client\.muteChat\(chatId, input\.muteUntil \?\? undefined\)/);
  assert.match(whatsappRuntimeSource, /connectedRuntime\.client\.unmuteChat\(chatId\)/);
});

test("muted conversations suppress inbound desktop push until their timed mute expires", () => {
  assert.match(inboxPushSource, /isMuted: true,\s*muteExpiration: true,/s);
  assert.match(
    inboxPushSource,
    /conversation\.isMuted &&\s*\(conversation\.muteExpiration === null \|\| conversation\.muteExpiration\.getTime\(\) > Date\.now\(\)\)/s
  );
});

test("service worker upgrades retain notification mute and deduplication state", () => {
  assert.match(
    serviceWorkerSource,
    /key !== APP_SHELL_CACHE && key !== STATIC_CACHE && key !== PUSH_META_CACHE/
  );
});

test("sender events relay to the web process for immediate SSE updates", () => {
  assert.match(inboxRealtimeSource, /INBOX_REALTIME_RELAY_URL/);
  assert.match(inboxRealtimeSource, /relayInboxRealtimeEvent\("inbox:message", event\)/);
  assert.match(inboxRealtimeSource, /relayInboxRealtimeEvent\("inbox:ack", event\)/);
  assert.match(inboxRealtimeSource, /relayInboxRealtimeEvent\("inbox:conversation", event\)/);
  assert.match(inboxRealtimeSource, /relayInboxRealtimeEvent\("inbox:chat-state", event\)/);
  assert.match(inboxRelayRouteSource, /providedToken !== expectedToken/);
  assert.match(inboxRelayRouteSource, /emitRelayedInboxRealtimeEvent\(body\.event, body\.payload\)/);
});
