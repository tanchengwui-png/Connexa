import assert from "node:assert/strict";
import test from "node:test";
import { decodeInboxCursor, encodeInboxCursor } from "../lib/inbox-pagination.ts";
import { runWithWhatsAppHistoryBudget } from "../lib/whatsapp-history-resource-control.ts";

test("inbox cursors round-trip a stable timestamp and id and reject malformed input", () => {
  const timestamp = new Date("2026-10-20T12:34:56.789Z");
  const cursor = encodeInboxCursor({ timestamp, id: "message_42" });
  const decoded = decodeInboxCursor(cursor);
  assert.equal(decoded?.id, "message_42");
  assert.equal(decoded?.timestamp.toISOString(), timestamp.toISOString());
  assert.equal(decodeInboxCursor("not-a-cursor"), null);
});

test("sender-wide history budget serializes jobs and single-flights a channel", async () => {
  process.env.WHATSAPP_HISTORY_GLOBAL_CONCURRENCY = "1";
  let active = 0;
  let maximumActive = 0;
  let releaseFirst = () => {};
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });

  const first = runWithWhatsAppHistoryBudget({
    key: "workspace-a:channel-a",
    skippedValue: "skipped",
    run: async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await firstGate;
      active -= 1;
      return "first";
    }
  });
  const duplicate = runWithWhatsAppHistoryBudget({
    key: "workspace-a:channel-a",
    skippedValue: "skipped",
    run: async () => "duplicate"
  });
  const second = runWithWhatsAppHistoryBudget({
    key: "workspace-b:channel-b",
    skippedValue: "skipped",
    run: async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      active -= 1;
      return "second";
    }
  });

  assert.equal(await duplicate, "skipped");
  releaseFirst();
  assert.equal(await first, "first");
  assert.equal(await second, "second");
  assert.equal(maximumActive, 1);
});

test("history budget prioritizes bootstrap work and rotates accounts between work units", async () => {
  process.env.WHATSAPP_HISTORY_GLOBAL_CONCURRENCY = "1";
  const order = [];
  let releaseGate = () => {};
  const gate = new Promise((resolve) => {
    releaseGate = resolve;
  });

  const active = runWithWhatsAppHistoryBudget({
    key: "fair-a:active",
    accountKey: "fair-a",
    priority: "routine",
    skippedValue: null,
    run: async () => {
      order.push("active-a");
      await gate;
    }
  });
  const routineA = runWithWhatsAppHistoryBudget({
    key: "fair-a:routine",
    accountKey: "fair-a",
    priority: "routine",
    skippedValue: null,
    run: async () => order.push("routine-a")
  });
  const routineB = runWithWhatsAppHistoryBudget({
    key: "fair-b:routine",
    accountKey: "fair-b",
    priority: "routine",
    skippedValue: null,
    run: async () => order.push("routine-b")
  });
  const bootstrap = runWithWhatsAppHistoryBudget({
    key: "fair-c:bootstrap",
    accountKey: "fair-c",
    priority: "bootstrap",
    skippedValue: null,
    run: async () => order.push("bootstrap-c")
  });

  releaseGate();
  await Promise.all([active, routineA, routineB, bootstrap]);
  assert.deepEqual(order, ["active-a", "bootstrap-c", "routine-a", "routine-b"]);
});
