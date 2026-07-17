import { readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

const repoRoot = process.cwd();
const pageSource = readFileSync(join(repoRoot, "app", "platform", "whatsapp", "page.tsx"), "utf8");
const globalStyles = readFileSync(join(repoRoot, "app", "globals.css"), "utf8");

test("platform WhatsApp maps authenticated and syncing states to colored status tones", () => {
  assert.match(pageSource, /status === "AUTHENTICATED"[\s\S]*return "status-authenticated"/);
  assert.match(pageSource, /status === "SYNCING_HISTORY"[\s\S]*return "status-syncing-history"/);
  assert.doesNotMatch(pageSource, /status === "AUTHENTICATED"[\s\S]{0,120}return "neutral"/);
  assert.doesNotMatch(pageSource, /status === "SYNCING_HISTORY"[\s\S]{0,120}return "neutral"/);
});

test("platform WhatsApp status colors avoid neutral grey for known runtime states", () => {
  for (const statusClass of [
    "status-ready",
    "status-authenticated",
    "status-syncing-history",
    "status-qr-ready",
    "status-initializing",
    "status-error",
    "status-disconnected",
    "status-unknown"
  ]) {
    assert.match(globalStyles, new RegExp(`\\.platform-ops-status-pill\\.${statusClass}\\s*\\{[\\s\\S]*?background:`));
    assert.match(globalStyles, new RegExp(`\\.platform-ops-status-pill\\.${statusClass}\\s*\\{[\\s\\S]*?color:`));
    assert.match(globalStyles, new RegExp(`html\\[data-theme="light"\\][\\s\\S]*?\\.platform-ops-status-pill\\.${statusClass}\\s*\\{[\\s\\S]*?color:`));
  }
});
