import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const source = readFileSync(join(process.cwd(), "components", "whatsapp-connection-onboarding.tsx"), "utf8");

test("a selected settings channel opens its connection details instead of remaining on step one", () => {
  assert.match(source, /hasExistingWebConnection \|\| Boolean\(selectedChannelId\)/);
  assert.match(source, /mode === "settings" && selectedChannelId/);
  assert.match(source, /nextMethod === pendingMethod[\s\S]*?setStep\(2\)/);
  assert.match(source, /<WebQrSetupPanel/);
});
