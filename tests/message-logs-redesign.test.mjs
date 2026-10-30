import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const board = readFileSync(join(process.cwd(), "components", "message-logs-board.tsx"), "utf8");
const page = readFileSync(join(process.cwd(), "app", "message-logs", "page.tsx"), "utf8");
const logs = readFileSync(join(process.cwd(), "lib", "message-logs.ts"), "utf8");
const css = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");

test("message logs uses the required six-column desktop table", () => {
  assert.match(board, /<th scope="col">Conversation<\/th><th scope="col">Message preview<\/th><th scope="col">Direction<\/th><th scope="col">Status<\/th><th scope="col">Time<\/th>/);
  assert.match(board, /<tbody>\{rows\.map\(\(row\) => <tr key=\{row\.id\}><td>/);
});

test("message logs truncates previews and handles missing message content", () => {
  assert.match(board, /className="message-logs-preview message-preview-text" title=\{row\.fullMessage \?\? row\.preview\}/);
  assert.match(board, /No message content/);
  assert.match(logs, /return "Message event"/);
});

test("direction and status filters remain separate query state", () => {
  assert.match(board, /name="direction"/);
  assert.match(board, /name="status"/);
  assert.match(page, /params\?\.direction/);
  assert.match(page, /params\?\.status/);
});

test("message logs keeps conversation access, filter clearing, and pagination boundaries", () => {
  assert.match(board, /href=\{`\/inbox\?conversationId=\$\{row\.conversationId\}`\}/);
  assert.match(board, /Clear filters/);
  assert.match(board, /aria-disabled=\{pagination\.page <= 1\}/);
  assert.match(board, /aria-disabled=\{pagination\.page >= pagination\.totalPages\}/);
});

test("mobile cards render and the table header stays at the top of its own scroll region", () => {
  assert.match(board, /className="message-logs-mobile"/);
  assert.match(css, /\.message-logs-table thead th \{[\s\S]*top: 0;/);
  assert.doesNotMatch(css, /\.message-logs-table thead th \{[\s\S]{0,200}top: var\(--app-header-height\)/);
  assert.match(css, /scroll-padding-top: calc\(var\(--app-header-height, 0px\)/);
});

test("the desktop table is contained by an internal horizontal scroll region", () => {
  assert.match(board, /className="message-logs-desktop message-logs-table-scroll"/);
  assert.match(board, /<table className="message-logs-table">/);
  assert.match(board, /className="message-logs-pagination message-logs-footer"/);
  assert.match(css, /\.message-logs-panel \{\s*width: 100%;\s*overflow: hidden;/);
  assert.match(css, /\.message-logs-table-scroll \{\s*width: 100%;\s*overflow-x: auto;/);
  assert.match(css, /\.message-logs-table \{\s*width: 100%;\s*min-width: 900px;/);
});

test("deletion explains the linked-number restriction and includes the affected count", () => {
  assert.match(board, /Delete \$\{summary\.total\} message log/);
  assert.match(board, /Disconnect linked WhatsApp numbers to delete logs/);
});
