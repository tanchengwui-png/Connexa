import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const repoRoot = process.cwd();
const inboxSource = readFileSync(join(repoRoot, "components", "inbox-workspace.tsx"), "utf8");
const queueSource = readFileSync(join(repoRoot, "components", "inbox", "queue-workbench.tsx"), "utf8");
const composerSource = readFileSync(join(repoRoot, "components", "inbox", "reply-composer.tsx"), "utf8");
const detailSource = readFileSync(join(repoRoot, "components", "inbox", "detail-panel.tsx"), "utf8");
const styles = readFileSync(join(repoRoot, "app", "globals.css"), "utf8");

test("the reference inbox shell keeps the toolbar and three-column workspace in one compact surface", () => {
  assert.match(inboxSource, /premium-inbox-workspace inbox-reference-v2/);
  assert.match(styles, /\.inbox-reference-v2 \.premium-inbox-grid\s*\{[\s\S]*grid-template-columns: clamp\(290px, 23vw, 370px\)/);
  assert.match(styles, /\.shell-inbox \.dashboard-topbar-primary\s*\{[\s\S]*grid-template-columns:/);
});

test("the queue exposes the reference quick filters as working tabs", () => {
  assert.match(queueSource, /className="inbox-queue-quick-tabs"/);
  assert.match(queueSource, /\["all", "All"\]/);
  assert.match(queueSource, /\["unread", "Unread"\]/);
  assert.match(queueSource, /\["groups", "Groups"\]/);
  assert.match(queueSource, /\["mine", "Mine"\]/);
  assert.match(queueSource, /onClick=\{\(\) => onSelectFilter\(key\)\}/);
});

test("the composer and detail panel use the reference tab hierarchy", () => {
  assert.match(composerSource, /className="inbox-composer-mode-tabs"/);
  assert.match(composerSource, /onInternalNoteChange\(false\)/);
  assert.match(composerSource, /onInternalNoteChange\(true\)/);
  assert.match(detailSource, /className="inbox-contact-detail-tabs"/);
  assert.match(detailSource, /label="Profile"/);
  assert.match(detailSource, /label="Notes"/);
});

test("the primary Inbox action keeps a high-contrast label and clearer control outlines", () => {
  assert.match(
    styles,
    /\.inbox-new-conversation-button\.button:disabled[\s\S]*color: #ffffff !important;[\s\S]*opacity: 1;/
  );
  assert.match(
    styles,
    /\.inbox-new-conversation-button\.button:disabled span[\s\S]*color: #ffffff !important;/
  );
  assert.match(styles, /\.scheduled-bulk-select-all select,[\s\S]*border-color: #b8c8dc;/);
});

test("the compact Inbox toolbar preserves room for the conversation workspace", () => {
  assert.match(
    styles,
    /\.inbox-reference-v2 \.inbox-reference-topbar\s*\{[\s\S]*min-height: 50px;[\s\S]*padding: 6px 12px;/
  );
  assert.match(
    styles,
    /\.inbox-new-conversation-button\.button\s*\{[\s\S]*height: 36px;[\s\S]*min-height: 36px;/
  );
});

test("desktop alerts use one compact toggle without a redundant options button", () => {
  assert.match(
    styles,
    /\.inbox-desktop-notifications-compact\s*\{[\s\S]*flex: 0 0 auto;/
  );
  assert.match(
    styles,
    /\.inbox-desktop-notifications-enable\.button\s*\{[\s\S]*flex: 0 0 190px;[\s\S]*width: 190px;/
  );
  assert.doesNotMatch(inboxSource, /inbox-desktop-notifications-menu/);
  assert.doesNotMatch(inboxSource, /Desktop notification options/);
});

test("the Chats heading uses one divider instead of stacked wrapper and inner borders", () => {
  assert.match(
    styles,
    /\.inbox-reference-v2 \.queue-panel-header\s*\{[\s\S]*border-bottom: 0;/
  );
  assert.match(
    styles,
    /\.inbox-reference-v2 \.inbox-panel-head\s*\{[\s\S]*border-bottom: 1px solid/
  );
});
