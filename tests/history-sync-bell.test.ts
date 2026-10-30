import assert from "node:assert/strict";
import test from "node:test";
import {
  EMPTY_HISTORY_SYNC_BELL_STATE,
  acknowledgeHistorySyncBell,
  applyHistorySyncStatus,
  queueHistorySyncRecheck
// @ts-ignore -- Node's type-stripping test runner requires the explicit TypeScript extension.
} from "../lib/history-sync-bell.ts";

const completedStatus = {
  checkedAt: "2026-10-19T10:00:00.000Z",
  isCaughtUp: true,
  version: "channel-1:2026-10-19T09:59:59.000Z"
};

test("a clean history catch-up presents one unread bell notification", () => {
  const completed = applyHistorySyncStatus(
    { ...EMPTY_HISTORY_SYNC_BELL_STATE },
    completedStatus
  );

  assert.equal(completed.shouldPresent, true);
  assert.equal(completed.state.acknowledged, false);
  assert.equal(completed.state.version, completedStatus.version);

  const repeatedPoll = applyHistorySyncStatus(completed.state, {
    ...completedStatus,
    checkedAt: "2026-10-19T10:00:08.000Z"
  });
  assert.equal(repeatedPoll.state.notificationKey, completed.state.notificationKey);
});

test("a new message invalidates an unopened completion and waits for a fresh check", () => {
  const completed = applyHistorySyncStatus(
    { ...EMPTY_HISTORY_SYNC_BELL_STATE },
    completedStatus
  ).state;
  const queued = queueHistorySyncRecheck(completed, "2026-10-19T10:00:05.000Z");

  assert.equal(queued.invalidatedNotificationKey, completed.notificationKey);
  assert.equal(queued.state.notificationKey, null);
  assert.equal(queued.state.pendingAfter, "2026-10-19T10:00:05.000Z");

  const staleCheck = applyHistorySyncStatus(queued.state, {
    ...completedStatus,
    checkedAt: "2026-10-19T10:00:05.000Z"
  });
  assert.equal(staleCheck.shouldPresent, false);

  const confirmedAgain = applyHistorySyncStatus(queued.state, {
    ...completedStatus,
    checkedAt: "2026-10-19T10:00:06.000Z"
  });
  assert.equal(confirmedAgain.shouldPresent, true);
  assert.equal(confirmedAgain.state.pendingAfter, null);
  assert.notEqual(confirmedAgain.state.notificationKey, completed.notificationKey);
});

test("opening the bell acknowledges completion so later messages do not restart it", () => {
  const completed = applyHistorySyncStatus(
    { ...EMPTY_HISTORY_SYNC_BELL_STATE },
    completedStatus
  ).state;
  const acknowledged = acknowledgeHistorySyncBell(completed);
  const queued = queueHistorySyncRecheck(acknowledged, "2026-10-19T10:01:00.000Z");

  assert.equal(acknowledged.acknowledged, true);
  assert.equal(queued.invalidatedNotificationKey, null);
  assert.equal(queued.state.pendingAfter, null);
});
