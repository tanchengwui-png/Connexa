import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = process.cwd();
const readProjectFile = (...segments) => readFileSync(join(repoRoot, ...segments), "utf8");
const automation = readProjectFile("lib", "automation-engine.ts");
const messageRoute = readProjectFile("app", "api", "conversations", "[id]", "messages", "route.ts");

test("an immediate human reply cancels pending follow-ups and ends its active workflow", () => {
  assert.match(messageRoute, /cancelPendingAutomation: !scheduledAt/);
  assert.match(automation, /async function cancelPendingAutomationOnHumanTakeover/);
  assert.match(
    automation,
    /status: AutomationJobStatus\.PENDING,[\s\S]*?jobType: AutomationJobType\.FOLLOW_UP_MESSAGE/
  );
  assert.match(
    automation,
    /activeFlowKey: "CONVERSATION_WORKFLOW"[\s\S]*?activeFlowKey: null,[\s\S]*?activeFlowStep: null,[\s\S]*?endReason: "HUMAN_TAKEOVER"/
  );
});
