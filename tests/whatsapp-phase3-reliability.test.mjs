import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { classifyWhatsAppAuthenticationFailure } from "../lib/whatsapp-auth-failure.ts";
import { resolveWhatsAppQrPresentation } from "../lib/whatsapp-qr-state.ts";
import {
  clearRuntimeSupervisorState,
  getRuntimeSupervisorStatus,
  registerAutomaticRecoveryAttempt
} from "../lib/whatsapp-runtime-supervisor.ts";

test("a current QR is exposed only while its runtime is present", () => {
  const now = Date.UTC(2026, 9, 20, 10, 0, 0);
  const result = resolveWhatsAppQrPresentation({
    runtimePresent: true,
    runtimeStatus: "QR_READY",
    qrCodeDataUrl: "data:image/png;base64,current",
    qrCodeGeneratedAt: now - 20_000,
    now,
    maxAgeMs: 60_000
  });

  assert.equal(result.qrCodeDataUrl, "data:image/png;base64,current");
  assert.equal(result.qrCodeGeneratedAt, new Date(now - 20_000).toISOString());
  assert.equal(result.qrCodeExpiresAt, new Date(now + 40_000).toISOString());
  assert.equal(result.qrCodeExpired, false);
});

test("an expired QR is hidden instead of appearing usable", () => {
  const now = Date.UTC(2026, 9, 20, 10, 0, 0);
  const result = resolveWhatsAppQrPresentation({
    runtimePresent: true,
    runtimeStatus: "QR_READY",
    qrCodeDataUrl: "data:image/png;base64,expired",
    qrCodeGeneratedAt: now - 60_000,
    now,
    maxAgeMs: 60_000
  });

  assert.equal(result.qrCodeDataUrl, null);
  assert.equal(result.qrCodeExpired, true);
});

test("a sender restart hides its orphaned pairing QR", () => {
  const now = Date.UTC(2026, 9, 20, 10, 0, 0);
  const result = resolveWhatsAppQrPresentation({
    runtimePresent: false,
    runtimeStatus: "QR_READY",
    qrCodeDataUrl: "data:image/png;base64,orphaned",
    qrCodeGeneratedAt: now - 1_000,
    now,
    maxAgeMs: 60_000
  });

  assert.equal(result.qrCodeDataUrl, null);
  assert.equal(result.qrCodeExpired, true);
});

test("QR data is never presented after authentication starts", () => {
  const result = resolveWhatsAppQrPresentation({
    runtimePresent: true,
    runtimeStatus: "AUTHENTICATED",
    qrCodeDataUrl: "data:image/png;base64,old",
    qrCodeGeneratedAt: Date.now(),
    maxAgeMs: 60_000
  });

  assert.equal(result.qrCodeDataUrl, null);
  assert.equal(result.qrCodeExpired, false);
});

test("temporary runtime failures are distinct from invalid saved sessions", () => {
  assert.equal(
    classifyWhatsAppAuthenticationFailure("Protocol error: Target closed while loading"),
    "temporary-runtime"
  );
  assert.equal(
    classifyWhatsAppAuthenticationFailure("Unable to authenticate with the saved session"),
    "invalid-session"
  );
});

test("recovery supervision is independent per channel", () => {
  const workspaceId = `phase3-workspace-${Date.now()}-${Math.random()}`;
  const firstChannelId = `${workspaceId}-first`;
  const secondChannelId = `${workspaceId}-second`;

  try {
    let firstAllowed = true;
    for (let attempt = 0; attempt < 20 && firstAllowed; attempt += 1) {
      firstAllowed = registerAutomaticRecoveryAttempt({
        workspaceId,
        channelId: firstChannelId,
        reason: "first channel exceeded its recovery budget"
      }).allowed;
    }

    assert.equal(firstAllowed, false);
    assert.equal(
      getRuntimeSupervisorStatus(workspaceId, firstChannelId).requiresManualAttention,
      true
    );
    assert.equal(
      getRuntimeSupervisorStatus(workspaceId, secondChannelId).requiresManualAttention,
      false
    );
    assert.equal(
      registerAutomaticRecoveryAttempt({ workspaceId, channelId: secondChannelId }).allowed,
      true
    );
  } finally {
    clearRuntimeSupervisorState(workspaceId);
  }
});

test("Phase 3 wiring stops orphaned pairing loops and separates sender reachability", () => {
  const runtimeSource = readFileSync(new URL("../lib/whatsapp-web.ts", import.meta.url), "utf8");
  const healthSource = readFileSync(new URL("../lib/whatsapp-health.ts", import.meta.url), "utf8");
  const senderSource = readFileSync(new URL("../scripts/sender-service.ts", import.meta.url), "utf8");
  const setupSource = readFileSync(
    new URL("../components/web-qr-setup-panel.tsx", import.meta.url),
    "utf8"
  );

  assert.match(
    senderSource,
    /!channel\.connectedAt &&[\s\S]*\["INITIALIZING", "QR_READY"\]\.includes\(channel\.connectionStatus\)/
  );
  assert.match(senderSource, /"runtimeDesiredState" = 'RUNNING'/);
  assert.match(runtimeSource, /runtimePresent,/);
  assert.match(runtimeSource, /qrCodeGeneratedAt: hydratedRuntime\?\.qrCodeGeneratedAt/);
  assert.match(runtimeSource, /classifyWhatsAppAuthenticationFailure\(message\)/);
  assert.match(runtimeSource, /trigger: "temporary-authentication-failure"/);
  assert.doesNotMatch(runtimeSource, /\.refreshQr\(|\.requestQr\(/);

  assert.match(healthSource, /runtimeStatus: fallbackChannel\?\.connectionStatus \?\? "DISCONNECTED"/);
  assert.match(healthSource, /senderReachable: false/);
  assert.match(setupSource, /snapshot\?\.qrCodeDataUrl && snapshot\.qrCodeExpired !== true/);
  assert.match(setupSource, /WhatsApp sender temporarily unreachable/);
});
