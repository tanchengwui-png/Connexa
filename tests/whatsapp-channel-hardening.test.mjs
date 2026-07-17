import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  canCreateAnotherChannel,
  pickOnlyChannelId,
  resolveBackfillChannelId,
  shouldDeleteChannelRecord
} from "../lib/whatsapp-channel-hardening.js";

const repoRoot = process.cwd();
const whatsappRuntimeSource = readFileSync(join(repoRoot, "lib", "whatsapp-web.ts"), "utf8");
const whatsappRuntimeEventsSource = readFileSync(
  join(repoRoot, "lib", "whatsapp-runtime-events.ts"),
  "utf8"
);

test("pickOnlyChannelId returns one distinct id", () => {
  assert.equal(pickOnlyChannelId(["a", "a", "a"]), "a");
  assert.equal(pickOnlyChannelId(["a", null, "a", undefined]), "a");
});

test("pickOnlyChannelId returns null when channel ids conflict", () => {
  assert.equal(pickOnlyChannelId(["a", "b"]), null);
  assert.equal(pickOnlyChannelId([null, undefined]), null);
});

test("resolveBackfillChannelId prefers current channel id", () => {
  assert.equal(
    resolveBackfillChannelId({
      currentChannelId: "current",
      relatedChannelIds: ["a", "b"],
      workspaceDefaultChannelId: "default"
    }),
    "current"
  );
});

test("resolveBackfillChannelId uses single related id before default", () => {
  assert.equal(
    resolveBackfillChannelId({
      currentChannelId: null,
      relatedChannelIds: ["related", "related"],
      workspaceDefaultChannelId: "default"
    }),
    "related"
  );
});

test("resolveBackfillChannelId refuses ambiguous related ids", () => {
  assert.equal(
    resolveBackfillChannelId({
      currentChannelId: null,
      relatedChannelIds: ["a", "b"],
      workspaceDefaultChannelId: "default"
    }),
    null
  );
});

test("resolveBackfillChannelId falls back to workspace default only when no related ids exist", () => {
  assert.equal(
    resolveBackfillChannelId({
      currentChannelId: null,
      relatedChannelIds: [],
      workspaceDefaultChannelId: "default"
    }),
    "default"
  );
});

test("canCreateAnotherChannel respects plan limit", () => {
  assert.equal(canCreateAnotherChannel({ currentChannelCount: 0, numberLimit: 1 }), true);
  assert.equal(canCreateAnotherChannel({ currentChannelCount: 1, numberLimit: 1 }), false);
  assert.equal(canCreateAnotherChannel({ currentChannelCount: 99, numberLimit: null }), true);
});

test("shouldDeleteChannelRecord preserves the last channel shell", () => {
  assert.equal(shouldDeleteChannelRecord(1), false);
  assert.equal(shouldDeleteChannelRecord(2), true);
});

test("WhatsApp runtime hardening adds initialize timeouts and bounded reconnect backoff", () => {
  assert.match(whatsappRuntimeSource, /const WHATSAPP_INITIALIZE_TIMEOUT_MS = Math\.max\(/);
  assert.match(whatsappRuntimeSource, /await Promise\.race\(\[\s*state\.client\.initialize\(\),/s);
  assert.match(
    whatsappRuntimeSource,
    /function getReconnectDelayMs\(attempt: number\) \{\s*return Math\.min\(WHATSAPP_RECONNECT_MAX_MS, WHATSAPP_RECONNECT_BASE_MS \* 2 \*\* Math\.max\(0, attempt - 1\)\);\s*\}/s
  );
  assert.match(
    whatsappRuntimeSource,
    /state\.reconnectAttempts \+= 1;\s*const resolvedDelayMs = Math\.max\(delayMs, getReconnectDelayMs\(state\.reconnectAttempts\)\);/s
  );
});

test("WhatsApp runtime recycles stale cached sessions instead of reusing them forever", () => {
  assert.match(
    whatsappRuntimeSource,
    /function shouldRecycleRuntimeState\(state: RuntimeState\) \{[\s\S]*state\.reconnectTimer \|\| isUnrecoverableRuntimeStatus\(state\.connectionStatus\)[\s\S]*Date\.now\(\) - state\.statusUpdatedAt > WHATSAPP_STALE_RUNTIME_MS[\s\S]*\}/
  );
  assert.match(whatsappRuntimeSource, /eventType: WHATSAPP_RUNTIME_EVENT_TYPES\.RUNTIME_RECYCLED/);
  assert.match(whatsappRuntimeEventsSource, /RUNTIME_RECYCLED: "RUNTIME_RECYCLED"/);
});

test("WhatsApp history sync tears down runtimes by channel id, not workspace id", () => {
  assert.match(whatsappRuntimeSource, /await teardownRuntimeState\(runtime\.channelId\);/);
  assert.doesNotMatch(whatsappRuntimeSource, /teardownRuntimeState\(workspaceId\)/);
});
