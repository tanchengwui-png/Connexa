import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const runtime = fs.readFileSync("lib/basic-whatsapp-qr-test.ts", "utf8");
const productionRuntime = fs.readFileSync("lib/whatsapp-web.ts", "utf8");
const client = fs.readFileSync("components/basic-whatsapp-qr-test.tsx", "utf8");
const route = fs.readFileSync("app/api/test/whatsapp-basic/route.ts", "utf8");
const page = fs.readFileSync("app/whatsapp-basic-test/page.tsx", "utf8");

function extractStringArray(source, constantName) {
  const match = source.match(new RegExp(`const ${constantName} = \\[([\\s\\S]*?)\\n\\];`));
  assert.ok(match, `${constantName} should be present`);
  return [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]);
}

test("basic test uses one direct no-auth whatsapp-web.js client", () => {
  assert.match(runtime, /new Client\(/);
  assert.match(runtime, /authStrategy: new NoAuth\(\)/);
  assert.match(runtime, /qrMaxRetries: 0/);
  assert.match(runtime, /process\.env\.WHATSAPP_WEB_USER_AGENT/);
  assert.match(runtime, /configuredUserAgent\?\.toLowerCase\(\) === "native"/);
  assert.match(runtime, /userAgent === undefined \? \{\} : \{ userAgent \}/);
  assert.match(productionRuntime, /configuredUserAgent\?\.toLowerCase\(\) === "native"/);
  assert.match(productionRuntime, /userAgent === undefined \? \{\} : \{ userAgent \}/);
  assert.doesNotMatch(runtime, /WHATSAPP_BASIC_USER_AGENT|Chrome\/156\.0\.0\.0|Chrome\/101\.0\.4951\.67/);
  assert.doesNotMatch(runtime, /sender-service-client|whatsapp-runtime|prisma/);
});

test("controlled client uses the exact production Chromium flags and protocol timeout", () => {
  assert.deepEqual(
    extractStringArray(runtime, "BASIC_WHATSAPP_CHROMIUM_ARGS"),
    extractStringArray(productionRuntime, "WHATSAPP_CHROMIUM_ARGS")
  );
  assert.match(runtime, /process\.env\.WHATSAPP_PROTOCOL_TIMEOUT_MS/);
  assert.match(runtime, /Math\.max\(\s*120_000,/);
  assert.match(runtime, /protocolTimeout: BASIC_WHATSAPP_PROTOCOL_TIMEOUT_MS/);
  assert.match(runtime, /args: BASIC_WHATSAPP_CHROMIUM_ARGS/);
});

test("basic test exposes immediate QR, scan detection, authenticated, and ready states", () => {
  assert.match(runtime, /client\.on\("qr"/);
  assert.match(runtime, /client\.on\("loading_screen"/);
  assert.match(runtime, /QR accepted\. Authenticating now/);
  assert.match(runtime, /client\.on\("authenticated"/);
  assert.match(runtime, /client\.on\("ready"/);
  assert.match(runtime, /recordTimeline\(runtime, "qr_generated"/);
  assert.match(runtime, /recordTimeline\(runtime, "qr_disappeared"/);
  assert.match(runtime, /recordTimeline\(runtime, "socket_state", snapshot\.state\)/);
  assert.match(runtime, /recordTimeline\(runtime, "authenticated"/);
  assert.match(runtime, /recordTimeline\(runtime, "ready"/);
  assert.match(runtime, /snapshot\.state !== "CONNECTED"/);
  assert.match(runtime, /helpersReady: typeof \(window as unknown as \{ WWebJS\?: unknown \}\)\.WWebJS !== "undefined"/);
  assert.match(runtime, /typeof window\.require !== "function"/);
  assert.match(runtime, /\}, 1_000\);/);
  assert.match(client, /QR → disappears/);
  assert.match(client, /Scan → authenticated/);
  assert.match(client, /Scan → connected/);
  assert.match(client, /Authenticated → ready/);
  assert.match(client, /Handshake timeline/);
  assert.match(client, /status\.state === "ready"\s*\? 5_000/);
  assert.match(client, /\["failed", "disconnected", "ended"\]\.includes\(status\.state\)/);
  assert.match(client, /:\s*1_000;/);
  assert.match(client, /setInterval\(\(\) => void refreshStatus\(\), pollingIntervalMs\)/);
  assert.match(page, /startBasicWhatsAppQrTest\(manager\.workspaceId\)/);
});

test("isolated client captures browser, request, navigation, and WebSocket diagnostics", () => {
  assert.match(runtime, /page\.on\("console"/);
  assert.match(runtime, /page\.on\("pageerror"/);
  assert.match(runtime, /page\.on\("requestfailed"/);
  assert.match(runtime, /page\.on\("response"/);
  assert.match(runtime, /page\.on\("framenavigated"/);
  assert.match(runtime, /Network\.webSocketClosed/);
  assert.match(runtime, /Network\.webSocketFrameError/);
  assert.match(runtime, /whatsappWebVersion/);
  assert.match(runtime, /chromiumVersion/);
  assert.match(runtime, /browserUserAgent/);
  assert.match(client, /Browser diagnostics/);
});

test("new QR logs out and destroys only the isolated test client", () => {
  assert.match(runtime, /client\.logout\(\)/);
  assert.match(runtime, /client\.destroy\(\)/);
  assert.match(runtime, /client\.logout\(\), 2_000/);
  assert.match(runtime, /client\.destroy\(\), 1_000/);
  assert.match(client, /New QR — end old test session/);
  assert.match(route, /startBasicWhatsAppQrTest/);
});
