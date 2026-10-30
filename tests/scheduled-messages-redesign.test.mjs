import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const board = readFileSync(join(process.cwd(), "components", "scheduled-messages-board.tsx"), "utf8");
const css = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");

test("scheduled messages renders one compact summary and seven-column table", () => {
  assert.match(board, /className="scheduled-summary"/);
  assert.doesNotMatch(board, /scheduled-inline-stats/);
  assert.match(board, /<th scope="col">Recipient<\/th>/);
  assert.match(board, /<th scope="col">Message preview<\/th>/);
  assert.match(board, /<th scope="col">Scheduled for<\/th>/);
  assert.match(board, /<th scope="col">Created by<\/th>/);
  assert.match(board, /<th scope="col">Status<\/th>/);
});

test("scheduled messages preserves compact URL filters with accessible active state", () => {
  assert.match(board, /\{ key: "all", label: "All" \}/);
  assert.match(board, /aria-current=\{isActive \? "page" : undefined\}/);
  assert.match(board, /buildScheduledMessagesHref\(option.key, conversationId, channelId\)/);
});

test("scheduled messages keeps safe actions and hides bulk controls without selection", () => {
  assert.match(board, /\{selectedCount \? \(/);
  assert.match(board, /setConfirmation\(\{ action: "send-now", jobIds: selectedIds \}\)/);
  assert.match(board, /This cannot be undone\./);
  assert.match(board, /href=\{`\/inbox\?conversationId=\$\{row\.conversationId\}`\}/);
});

test("scheduled message content is contained and mobile cards replace the table", () => {
  assert.match(board, /No message content/);
  assert.match(board, /className="scheduled-mobile-list"/);
  assert.match(css, /\.scheduled-messages-page \{[\s\S]*scroll-padding-top: var\(--app-header-height, 5rem\)/);
  assert.match(css, /\.scheduled-queue-panel \{[\s\S]*overflow: hidden;/);
  assert.match(css, /\.scheduled-table-scroll \{[\s\S]*overflow-x: auto;/);
  assert.match(css, /\.scheduled-message-table \{[\s\S]*min-width: 1050px;/);
});
