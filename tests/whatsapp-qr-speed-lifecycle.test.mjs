import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readSource = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("guided onboarding removes full health aggregation and duplicate channel refresh", async () => {
  const page = await readSource("app/onboarding/page.tsx");
  assert.doesNotMatch(page, /getWorkspaceWhatsAppHealthForPage/);
  assert.match(page, /channels\.length === 1 \? channels\[0\] : null/);
  assert.match(page, /resolveWhatsAppQrPresentation/);

  const onboarding = await readSource("components/whatsapp-connection-onboarding.tsx");
  assert.match(onboarding, /if \(!isGuided \|\| selectedChannelId \|\| channels\.length !== 1\)/);
});

test("runtime start dispatch is acknowledged while Chromium initializes in single flight", async () => {
  const sender = await readSource("scripts/sender-service.ts");
  const startHandler = sender.slice(
    sender.indexOf('url.pathname === "/whatsapp/runtime/start"'),
    sender.indexOf('url.pathname === "/whatsapp/runtime/fresh-start"')
  );
  assert.match(startHandler, /void ensureWorkspaceWhatsAppClient/);
  assert.match(startHandler, /sendJson\(response, 202, \{ ok: true, accepted: true \}\)/);

  const runtime = await readSource("lib/whatsapp-web.ts");
  const ensurePath = runtime.slice(
    runtime.indexOf("async function ensureWorkspaceWhatsAppClientUnlocked"),
    runtime.indexOf("export async function requestWhatsAppWebClientPairingCode")
  );
  assert.doesNotMatch(ensurePath, /prisma\.message\.count/);
  assert.match(ensurePath, /selectedChannel: channel/);
  assert.match(runtime, /runSerializedChannelLifecycle\(channel\.id/);
});

test("QR and authenticated events bypass persistence latency with ordered lifecycle metadata", async () => {
  const realtime = await readSource("lib/inbox-realtime.ts");
  for (const field of [
    "eventSequence",
    "qrVersion",
    "qrCodeDataUrl",
    "qrCodeGeneratedAt",
    "qrCodeExpiresAt",
    "qrCodeExpired"
  ]) {
    assert.match(realtime, new RegExp(field));
  }

  const runtime = await readSource("lib/whatsapp-web.ts");
  assert.match(runtime, /function emitActiveRuntimeConnection/);
  assert.match(runtime, /Runtime state is already authoritative here\. Publish first/);
  assert.match(runtime, /emitRealtime: false/);
  assert.match(runtime, /requestToQrMs/);
  assert.match(runtime, /runtimeToQrMs/);
  assert.match(runtime, /qrEncodeMs/);
  assert.match(runtime, /\["AUTHENTICATED", "CONNECTED", "READY", "SYNCING_HISTORY"\]\.includes\(state\.connectionStatus\)/);
});

test("frontend starts guided pairing early and fences stale QR rotations", async () => {
  const panel = await readSource("components/web-qr-setup-panel.tsx");
  assert.match(panel, /guidedQrStartRequestedRef/);
  assert.match(panel, /beginQrRequestOptimistically/);
  assert.match(panel, /isStaleWhatsAppConnectionEvent/);
  assert.match(panel, /latestQrVersionRef/);
  assert.match(panel, /event\.qrCodeDataUrl/);
  assert.match(panel, /eventType: "QR_DISPLAYED"/);
  assert.match(panel, /<summary>Advanced troubleshooting<\/summary>/);
  assert.doesNotMatch(panel, /"Waiting for a live runtime health check\."/);
});

test("the start API does not perform a second runtime snapshot query", async () => {
  const route = await readSource("app/api/settings/whatsapp/route.ts");
  const pairingDispatch = route.slice(
    route.indexOf('if (body?.action === "fresh-start")'),
    route.indexOf("} catch (error)", route.indexOf('if (body?.action === "fresh-start")'))
  );
  assert.match(pairingDispatch, /return NextResponse\.json\(\{ accepted: true \}, \{ status: 202 \}\)/);
  assert.doesNotMatch(pairingDispatch, /const status = await getWorkspaceWhatsAppRuntimeStatus/);
});
