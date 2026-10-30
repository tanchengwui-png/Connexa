import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// @ts-expect-error Node's strip-types runner requires the source extension.
import * as runtimeHealthState from "../lib/whatsapp-runtime-health-state.ts";

const {
  calculateWhatsAppRecoveryDelayMs,
  classifyWhatsAppWebState,
  resolveWhatsAppUserConnectionState
} = runtimeHealthState;

test("recovery backoff is exponential and capped", () => {
  assert.equal(calculateWhatsAppRecoveryDelayMs(1), 5_000);
  assert.equal(calculateWhatsAppRecoveryDelayMs(2), 10_000);
  assert.equal(calculateWhatsAppRecoveryDelayMs(3), 20_000);
  assert.equal(calculateWhatsAppRecoveryDelayMs(99), 300_000);
  assert.equal(calculateWhatsAppRecoveryDelayMs(2, 5_000, 300_000, 0.2, () => 0), 8_000);
  assert.equal(calculateWhatsAppRecoveryDelayMs(2, 5_000, 300_000, 0.2, () => 1), 12_000);
});

test("provider state classification distinguishes re-auth from transient failure", () => {
  assert.equal(classifyWhatsAppWebState("CONNECTED"), "healthy");
  assert.equal(classifyWhatsAppWebState("OPENING"), "transient");
  assert.equal(classifyWhatsAppWebState("UNPAIRED"), "reauth-required");
  assert.equal(classifyWhatsAppWebState("UNPAIRED_IDLE"), "reauth-required");
});

test("persisted READY is not shown as connected without a fresh compound probe", () => {
  const now = Date.UTC(2026, 9, 20, 12, 0, 0);
  assert.equal(
    resolveWhatsAppUserConnectionState({
      senderReachable: true,
      runtimePresent: false,
      runtimeStatus: "READY",
      healthStatus: "HEALTHY",
      lastHealthyAt: new Date(now - 1_000),
      now
    }),
    "unknown"
  );
  assert.equal(
    resolveWhatsAppUserConnectionState({
      senderReachable: true,
      runtimePresent: true,
      runtimeStatus: "READY",
      healthStatus: "HEALTHY",
      lastHealthyAt: new Date(now - 1_000),
      now
    }),
    "connected"
  );
});

test("unreachable, recovering, stale and re-auth states are user-visible", () => {
  const now = Date.UTC(2026, 9, 20, 12, 0, 0);
  assert.equal(resolveWhatsAppUserConnectionState({ senderReachable: false, runtimePresent: true }), "unknown");
  assert.equal(
    resolveWhatsAppUserConnectionState({
      senderReachable: true,
      runtimePresent: true,
      runtimeStatus: "READY",
      healthStatus: "HEALTHY",
      lastHealthyAt: new Date(now - 151_000),
      now
    }),
    "recovering"
  );
  assert.equal(
    resolveWhatsAppUserConnectionState({
      senderReachable: true,
      runtimePresent: false,
      healthStatus: "REAUTH_REQUIRED"
    }),
    "reconnection_required"
  );
  assert.equal(
    resolveWhatsAppUserConnectionState({
      senderReachable: true,
      runtimePresent: false,
      healthStatus: "STOPPED"
    }),
    "disconnected"
  );
});

test("runtime wiring persists recovery intent and preserves LocalAuth during automatic recovery", () => {
  const runtimeSource = readFileSync(new URL("../lib/whatsapp-web.ts", import.meta.url), "utf8");
  const reliabilitySource = readFileSync(
    new URL("../lib/whatsapp-runtime-reliability.ts", import.meta.url),
    "utf8"
  );
  const senderSource = readFileSync(new URL("../scripts/sender-service.ts", import.meta.url), "utf8");
  const channelSource = readFileSync(new URL("../lib/whatsapp-channel.ts", import.meta.url), "utf8");
  const envelopeSource = readFileSync(
    new URL("../lib/whatsapp-message-envelope.ts", import.meta.url),
    "utf8"
  );
  const setupSource = readFileSync(
    new URL("../components/web-qr-setup-panel.tsx", import.meta.url),
    "utf8"
  );
  const outboundJobsSource = readFileSync(
    new URL("../lib/outbound-message-jobs.ts", import.meta.url),
    "utf8"
  );
  const migrationSource = readFileSync(
    new URL("../prisma/migrations/20261020150000_stop_unlinked_whatsapp_error_recovery/migration.sql", import.meta.url),
    "utf8"
  );

  assert.match(runtimeSource, /state\.client\.getState\(\), page\.evaluate\(\(\) => true\)/);
  assert.match(runtimeSource, /isWhatsAppRuntimeRecoveryCurrent/);
  assert.match(runtimeSource, /runtimeHealthProbes\.get\(state\.channelId\)/);
  assert.match(runtimeSource, /channel\.runtimeDesiredState !== "RUNNING"/);
  assert.match(runtimeSource, /channel\.runtimeHealthStatus === "REAUTH_REQUIRED"/);
  assert.doesNotMatch(runtimeSource, /message\.includes\("auth"\)/);
  assert.doesNotMatch(
    runtimeSource,
    /CHROMIUM_PROFILE_LOCK_REQUIRES_INTERVENTION:"\)\s*\{[\s\S]{0,300}markWhatsAppRuntimeReauthRequired/
  );
  assert.match(reliabilitySource, /"runtimeDesiredState" = 'RUNNING'/);
  assert.match(
    reliabilitySource,
    /markWhatsAppRuntimeReauthRequired[\s\S]{0,900}"runtimeDesiredState" = 'RUNNING'/
  );
  assert.match(reliabilitySource, /"recoveryToken" = \$\{token\}/);
  assert.match(reliabilitySource, /"lastErrorCode" = 'RECOVERY_CIRCUIT_OPEN'/);
  assert.match(runtimeSource, /void markWhatsAppRuntimeRecovering\(\{/);
  assert.doesNotMatch(
    reliabilitySource,
    /attempt >[\s\S]{0,500}markWhatsAppRuntimeReauthRequired/
  );
  assert.match(senderSource, /shutdownAllWhatsAppRuntimes\(\)/);
  assert.match(senderSource, /const concurrency = 1/);
  assert.match(senderSource, /watchdogConsecutiveFailures >= watchdogMaxFailures/);
  assert.match(senderSource, /shutdown\("watchdog-failure", 1\)/);
  assert.match(
    outboundJobsSource,
    /connectionStatus === "REAUTH_REQUIRED"[\s\S]{0,300}SESSION_RELINK_REQUIRED/
  );
  assert.doesNotMatch(
    channelSource,
    /\(input\.channelId[\s\S]{0,300}\) \?\? \(await ensureWorkspaceDefaultWhatsAppChannel/
  );
  assert.match(runtimeSource, /candidateChannel\?\.workspaceId === workspaceId \? candidateChannel : null/);
  assert.match(runtimeSource, /lastQrEventPersistedAt >= 5 \* 60_000/);
  assert.match(runtimeSource, /desiredState: "STOPPED"[\s\S]{0,300}await teardownRuntimeState/);
  assert.match(runtimeSource, /if \(options\.invalidateSession\) \{[\s\S]{0,200}runtime\.client\.logout\(\)/);
  assert.match(setupSource, /return "Connected"/);
  assert.match(setupSource, /return "Recovering connection\.\.\."/);
  assert.match(setupSource, /return "Reconnection required"/);
  assert.match(setupSource, /"Reconnect WhatsApp"/);
  assert.doesNotMatch(envelopeSource, /captured-envelope/);
  assert.doesNotMatch(runtimeSource, /scheduleRuntimeReconnect[\s\S]{0,1000}\.logout\(/);
  assert.match(migrationSource, /"connectionStatus" IN \('INITIALIZING', 'ERROR'\)/);
  assert.match(migrationSource, /"connectedAt" IS NULL/);
  assert.match(migrationSource, /"runtimeDesiredState" = 'STOPPED'/);
  assert.match(migrationSource, /"runtimeHealthStatus" = 'UNKNOWN'/);
  assert.match(migrationSource, /ADD COLUMN IF NOT EXISTS "runtimeDegradedAt"/);
  assert.match(
    migrationSource,
    /"connectionStatus" IN \('AUTHENTICATED', 'CONNECTED', 'SYNCING_HISTORY', 'READY'\)/
  );
  assert.doesNotMatch(migrationSource, /DELETE|logout|sessionClientId" = NULL/i);
});
