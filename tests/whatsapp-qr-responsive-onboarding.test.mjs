import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readSource = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("QR onboarding uses a minimal tenant-scoped status snapshot", async () => {
  const route = await readSource("app/api/settings/whatsapp/status/route.ts");
  assert.match(route, /requireApiManager\(\)/);
  assert.match(route, /where: \{ id: channelId, workspaceId: manager\.workspaceId \}/);
  assert.doesNotMatch(route, /getWorkspaceWhatsAppRuntimeStatus/);
  assert.doesNotMatch(route, /conversation\.count|message\.count|getWorkspaceWhatsAppHealth/);
});

test("QR transitions are local, event-driven, and stale-response safe", async () => {
  const panel = await readSource("components/web-qr-setup-panel.tsx");
  assert.match(panel, /\/api\/settings\/whatsapp\/status/);
  assert.match(panel, /new EventSource\(`/);
  assert.match(panel, /whatsapp:connection/);
  assert.match(panel, /snapshotVersion < latestStatusVersionRef\.current/);
  assert.match(panel, /activeStatusRequestRef\.current/);
  assert.match(panel, /QR scanned\. WhatsApp is authenticating/);
  assert.match(panel, /applyConnectionEvent\(JSON\.parse/);
  assert.match(panel, /eventSequence/);
  assert.match(panel, /qrVersion/);
  assert.match(panel, /event\.qrCodeDataUrl/);
  assert.match(panel, /QR accepted\.[\s\S]*You can enter Inbox now/);
  assert.match(panel, /isAuthenticatedHandoff \? \([\s\S]*WhatsApp is finalizing the live connection[\s\S]*\) : showsConnectedSummary \? \(/);
  assert.match(panel, /showsConnectedSummary \|\| isAuthenticatedHandoff/);
  assert.match(panel, /WhatsApp connected\./);

  const onboarding = await readSource("components/whatsapp-connection-onboarding.tsx");
  assert.match(onboarding, /onConnectionStateChange=\{handleWebConnectionStateChange\}/);
  assert.match(onboarding, /liveWebConnection\.userConnectionState === "connected"/);

  const linkedTransition = panel.slice(
    panel.indexOf("const showsConnectedSummary"),
    panel.indexOf("async function waitForQrReady")
  );
  assert.doesNotMatch(linkedTransition, /router\.refresh\(\)/);
});

test("connection SSE is workspace and channel scoped", async () => {
  const stream = await readSource("app/api/inbox/events/route.ts");
  const relay = await readSource("app/api/internal/inbox-events/route.ts");
  assert.match(stream, /event\.workspaceId !== agent\.workspaceId/);
  assert.match(stream, /channelId && event\.channelId !== channelId/);
  assert.match(stream, /unsubscribeWhatsAppConnection\(\)/);
  assert.match(relay, /"whatsapp:connection"/);
});

test("history work yields to pairing and reuses a bounded chat worklist", async () => {
  const whatsappWeb = await readSource("lib/whatsapp-web.ts");
  const resourceControl = await readSource("lib/whatsapp-history-resource-control.ts");
  assert.match(whatsappWeb, /WHATSAPP_PAIRING_HISTORY_MAX_DEFERRAL_MS/);
  assert.match(whatsappWeb, /shouldDeferHistoryForPairing/);
  assert.match(whatsappWeb, /getHistoryChatWorklist/);
  assert.match(whatsappWeb, /mergeHistoryChatIntoWorklist/);
  assert.match(whatsappWeb, /resolveProfilePhoto: isMediaEnrichmentPhase/);
  assert.match(whatsappWeb, /yielded-after-chat=.*interactive pairing/);
  assert.match(whatsappWeb, /authenticatedToReadyMonotonicMs/);
  assert.match(whatsappWeb, /helperInjectionAfterAuthenticatedMs/);
  assert.match(resourceControl, /WHATSAPP_HISTORY_GLOBAL_CONCURRENCY \?\? "1"/);
});
