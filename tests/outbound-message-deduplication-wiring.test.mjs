import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (...parts) => readFileSync(join(root, ...parts), "utf8");
const worker = read("lib", "outbound-message-jobs.ts");
const route = read("app", "api", "conversations", "[id]", "messages", "route.ts");
const composer = read("components", "inbox-workspace.tsx");
const webRuntime = read("lib", "whatsapp-web.ts");
const schema = read("prisma", "schema.prisma");
const migration = read("prisma", "migrations", "20260727100000_outbound_message_idempotency", "migration.sql");

test("an accepted WhatsApp send without an ID is finalized instead of retried", () => {
  assert.match(worker, /markOutboundMessageJobAcceptedUntracked/);
  assert.match(worker, /delivery: "accepted_untracked"/);
  assert.match(worker, /status: OutboundMessageJobStatus\.SENT/);
  assert.match(worker, /\[ACCEPTED_UNTRACKED\]/);
  assert.doesNotMatch(worker, /if \(!providerMessageId\) \{\s*const nextRetryAt/);
  assert.doesNotMatch(webRuntime, /WhatsApp accepted the message but did not return a trackable message id/);
});

test("a later personal-web message_create event can recover an accepted-untracked id without resending", () => {
  assert.match(webRuntime, /lastError: \{ startsWith: "\[ACCEPTED_UNTRACKED\]" \}/);
  assert.match(webRuntime, /deliveryStatus: "accepted_untracked"/);
  assert.match(webRuntime, /deliveryStatus: "pending"/);
  assert.match(webRuntime, /availableAt: \{ gte: recentlyDueAfter, lte: recentlyDueBefore \}/);
  assert.match(webRuntime, /recover the missing id without sending another message/);
});

test("immediate and explicitly scheduled sends retain distinct scheduling metadata", () => {
  assert.match(worker, /sendMode: input\.availableAt \? "scheduled" : "immediate"/);
  assert.match(worker, /schedulingSource: input\.availableAt \? "explicit_user_schedule" : "none"/);
  assert.match(route, /scheduledFor \? parseMalaysiaDateTimeLocalInput/);
});

test("composer and queue deduplicate a repeated request", () => {
  assert.match(composer, /activeSendIdempotencyKeyRef/);
  assert.match(composer, /"Idempotency-Key": idempotencyKey/);
  assert.match(route, /request\.headers\.get\("idempotency-key"\)/);
  assert.match(worker, /findOutboundMessageByIdempotencyKey/);
  assert.match(worker, /isOutboundMessageIdempotencyConflict/);
  assert.match(schema, /@@unique\(\[workspaceId, idempotencyKey\]\)/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS "idempotencyKey"/);
});
