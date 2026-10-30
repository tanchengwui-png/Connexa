import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const repoRoot = process.cwd();
const healthSource = readFileSync(join(repoRoot, "lib", "whatsapp-health.ts"), "utf8");
const inboxSource = readFileSync(join(repoRoot, "components", "inbox-workspace.tsx"), "utf8");
const statusStripSource = readFileSync(join(repoRoot, "components", "inbox", "status-strip.tsx"), "utf8");
const setupSource = readFileSync(join(repoRoot, "components", "web-qr-setup-panel.tsx"), "utf8");

test("history health only reports durable or runtime active work as an in-progress sync", () => {
  assert.match(
    healthSource,
    /const isHistorySyncInProgress = historySync\?\.active === true/
  );
  assert.match(
    healthSource,
    /historySyncProgressAt: historySync\?\.progressAt \?\? runtime\.historySyncProgressAt/
  );
  assert.match(setupSource, /const showHistoryStuck = Boolean\(health\?\.isHistoryStuck && isRuntimeImportingHistory\)/);
  assert.match(setupSource, /showHistoryStuck \? \(/);
});

test("Inbox keeps personal WhatsApp history status visible and animates only active work", () => {
  assert.match(
    inboxSource,
    /liveWhatsApp\.channels\.some\(\(channel\) => channel\.connectionMethod === "web"\)/
  );
  assert.match(inboxSource, /liveWhatsApp\.historySyncActive/);
  assert.match(inboxSource, /liveWhatsApp\.historySyncPhase === "deferred"/);
  assert.match(inboxSource, /liveWhatsApp\.historySyncPhase === "error"/);
  assert.match(statusStripSource, /historySyncActive \? " is-active" : ""/);
  assert.match(statusStripSource, /historySyncPhase === "deferred"/);
  assert.match(statusStripSource, /historySyncPhase === "error"/);
  assert.match(statusStripSource, /historySyncProcessedChats/);
  assert.match(statusStripSource, /History up to date/);
  assert.match(statusStripSource, /Completed /);
  assert.match(statusStripSource, /is-complete/);
  assert.match(statusStripSource, /className="inbox-history-sync-popover"/);
  const actionsIndex = inboxSource.indexOf('className="inbox-reference-topbar-actions"');
  const syncIndicatorIndex = inboxSource.indexOf("<InboxStatusStrip", actionsIndex);
  const workspaceBodyIndex = inboxSource.indexOf('className="inbox-workspace-body"');
  assert.ok(syncIndicatorIndex > actionsIndex && syncIndicatorIndex < workspaceBodyIndex);
});

test("WhatsApp settings explain that a deferred import retries without blocking live messaging", () => {
  assert.match(setupSource, /const hasDeferredHistory = Boolean\(/);
  assert.match(setupSource, /Historical import is paused/);
  assert.match(setupSource, /Connexa will retry it in the background/);
});
