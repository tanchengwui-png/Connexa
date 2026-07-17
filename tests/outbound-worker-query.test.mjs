import test from "node:test";
import assert from "node:assert/strict";
import {
  activeWhatsAppStatuses,
  runnableOutboundStatuses,
  targetWorkspaceIdsQuery
} from "../scripts/outbound-worker-query.mjs";

test("target workspace query compares enum outbound job status safely", () => {
  assert.match(targetWorkspaceIdsQuery, /status::text\s*=\s*any\(\$2::text\[\]\)/);
  assert.doesNotMatch(targetWorkspaceIdsQuery, /where\s+status\s*=\s*any\(\$2::text\[\]\)/);
});

test("target workspace status filters include connected channels and runnable jobs", () => {
  assert.deepEqual(activeWhatsAppStatuses, ["AUTHENTICATED", "CONNECTED", "SYNCING_HISTORY", "READY"]);
  assert.deepEqual(runnableOutboundStatuses, ["PENDING", "RUNNING"]);
});
