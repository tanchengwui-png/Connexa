import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

const repoRoot = resolve(dirname(new URL(import.meta.url).pathname), "..");

test("scheduled downgrade invoices expire when a newer plan-change invoice is created", () => {
  const upgrades = readFileSync(join(repoRoot, "lib", "workspace-package-upgrades.ts"), "utf8");
  const billing = readFileSync(join(repoRoot, "lib", "billing-management.ts"), "utf8");

  assert.match(upgrades, /EXPIRED: "EXPIRED"/);
  assert.match(upgrades, /async function expireScheduledPlanChanges/);
  assert.match(upgrades, /status = 'SCHEDULED'/);
  assert.match(upgrades, /status: UPGRADE_INVOICE_STATUS\.EXPIRED/);
  assert.match(upgrades, /replacementReason: `Expired by \$\{input\.replacementInvoiceNumber\}`/);

  assert.match(billing, /row\.status === "SCHEDULED"/);
  assert.match(billing, /row\.status === "EXPIRED"/);
  assert.match(billing, /\? "expired"/);
});
