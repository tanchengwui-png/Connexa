import { readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

const repoRoot = process.cwd();
const panelSource = readFileSync(join(repoRoot, "components", "web-qr-setup-panel.tsx"), "utf8");
const globalStyles = readFileSync(join(repoRoot, "app", "globals.css"), "utf8");

test("guided WhatsApp onboarding next-step copy stays simple and scoped", () => {
  assert.match(panelSource, /After the phone is linked, Connexa can import chats and prepare your manager inbox\./);
  assert.match(panelSource, /skip this step and finish it later from settings/);
  assert.match(panelSource, /className="wa-onboarding-next-copy"/);
  assert.doesNotMatch(panelSource, /Once the phone is linked, Connexa can start importing chats/);
});

test("guided WhatsApp onboarding next-step copy has explicit readable colors", () => {
  assert.match(globalStyles, /\.wa-onboarding-next-copy\s*\{\s*color:\s*#a8b6c8;/);
  assert.match(globalStyles, /html\[data-theme="light"\]\s+\.wa-onboarding-next-copy\s*\{\s*color:\s*#4e6380;/);
});
