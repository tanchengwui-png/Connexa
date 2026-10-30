import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  isStaleWhatsAppConnectionEvent,
  wouldRegressActiveWhatsAppConnection
} from "../lib/whatsapp-connection-ordering.ts";
import { patchWhatsAppWebQrRefreshContext } from "../scripts/patch-whatsapp-web-media-id.mjs";

const readSource = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("authenticated and connected states cannot regress to an expired QR snapshot", () => {
  assert.equal(wouldRegressActiveWhatsAppConnection("AUTHENTICATED", "QR_READY"), true);
  assert.equal(wouldRegressActiveWhatsAppConnection("CONNECTED", "QR_READY"), true);
  assert.equal(wouldRegressActiveWhatsAppConnection("READY", "AUTHENTICATED"), true);
  assert.equal(wouldRegressActiveWhatsAppConnection("AUTHENTICATED", "CONNECTED"), false);
  assert.equal(wouldRegressActiveWhatsAppConnection("READY", "REAUTH_REQUIRED"), false);
});

test("late expiry and old QR rotations are rejected within the active attempt", () => {
  const current = {
    currentAttemptId: "attempt-3",
    currentSequence: 4,
    currentQrVersion: 3
  };
  assert.equal(isStaleWhatsAppConnectionEvent({
    ...current,
    eventAttemptId: "attempt-3",
    eventSequence: 3,
    eventQrVersion: 3,
    eventStatus: "QR_READY"
  }), true);
  assert.equal(isStaleWhatsAppConnectionEvent({
    ...current,
    eventAttemptId: "attempt-3",
    eventSequence: 5,
    eventQrVersion: 2,
    eventStatus: "QR_READY"
  }), true);
  assert.equal(isStaleWhatsAppConnectionEvent({
    ...current,
    eventAttemptId: "attempt-3",
    eventSequence: 5,
    eventQrVersion: 3,
    eventStatus: "AUTHENTICATED"
  }), false);
});

test("each browser tab can accept the same current replay independently", () => {
  const replay = {
    currentAttemptId: null,
    eventAttemptId: "attempt-3",
    currentSequence: 0,
    eventSequence: 2,
    currentQrVersion: 0,
    eventQrVersion: 2,
    eventStatus: "QR_READY"
  };
  assert.equal(isStaleWhatsAppConnectionEvent(replay), false);
  assert.equal(isStaleWhatsAppConnectionEvent(replay), false);
});

test("SSE subscribes before replaying an authoritative runtime snapshot", async () => {
  const stream = await readSource("app/api/inbox/events/route.ts");
  const subscribeAt = stream.indexOf('subscribeToInboxRealtime("whatsapp:connection"');
  const snapshotAt = stream.indexOf("getWorkspaceWhatsAppRuntimeStatus({");
  assert.ok(subscribeAt >= 0 && snapshotAt > subscribeAt);
  assert.match(stream, /connectionAttemptId: status\.connectionAttemptId/);
  assert.match(stream, /eventSequence: status\.connectionEventSequence/);
  assert.match(stream, /qrVersion: status\.qrVersion/);
  assert.match(stream, /"X-Accel-Buffering": "no"/);

  const runtime = await readSource("lib/whatsapp-web.ts");
  assert.match(runtime, /connectionUpdatedAt: string/);
  assert.match(runtime, /connectionAttemptId: hydratedRuntime\?\.generationId/);
  assert.match(runtime, /connectionEventSequence: hydratedRuntime\?\.connectionEventSequence/);
});

test("whatsapp-web.js UNPAIRED_IDLE refresh executes inside Chromium", () => {
  const vulnerable = `
            async (state) => {
                if (state == 'UNPAIRED_IDLE') {
                    // refresh qr code
                    window.require('WAWebCmd').Cmd.refreshQR();
                }
            },`;
  const patched = patchWhatsAppWebQrRefreshContext(vulnerable);
  assert.equal(patched.changed, true);
  assert.match(patched.source, /await this\.pupPage\.evaluate\(\(\) => \{/);
  assert.match(patched.source, /window\.require\('WAWebCmd'\)\.Cmd\.refreshQR\(\)/);
  const repeated = patchWhatsAppWebQrRefreshContext(patched.source);
  assert.equal(repeated.changed, false);
  assert.equal(repeated.source, patched.source);
});
