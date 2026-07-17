import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

const repoRoot = resolve(dirname(new URL(import.meta.url).pathname), "..");

test("onboarding pages use bounded WhatsApp health lookups", () => {
  const healthSource = readFileSync(join(repoRoot, "lib", "whatsapp-health.ts"), "utf8");
  const onboardingPage = readFileSync(join(repoRoot, "app", "onboarding", "page.tsx"), "utf8");
  const settingsPage = readFileSync(join(repoRoot, "app", "settings", "whatsapp", "page.tsx"), "utf8");

  assert.match(healthSource, /const WHATSAPP_PAGE_HEALTH_TIMEOUT_MS = Math\.max/);
  assert.match(healthSource, /export async function getWorkspaceWhatsAppHealthForPage/);
  assert.match(healthSource, /WhatsApp health check timed out after \$\{timeoutMs\}ms/);
  assert.match(onboardingPage, /getWorkspaceWhatsAppHealthForPage/);
  assert.match(onboardingPage, /fallbackChannel: selectedChannel/);
  assert.match(settingsPage, /getWorkspaceWhatsAppHealthForPage/);
  assert.match(settingsPage, /fallbackChannel: selectedChannel/);
});
