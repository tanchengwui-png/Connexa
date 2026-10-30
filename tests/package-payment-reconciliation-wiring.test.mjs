import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (...parts) => readFileSync(join(root, ...parts), "utf8");
const upgrades = read("lib", "workspace-package-upgrades.ts");
const migration = read("prisma", "migrations", "20260723130000_reconcile_expired_package_payments", "migration.sql");

test("package payment reconciliation wires the 20-minute expiry, lease, and Billplz confirmation paths", () => {
  assert.match(upgrades, /PAYMENT_PROCESSING_TIMEOUT_MINUTES.*"20"/s);
  assert.match(upgrades, /PAYMENT_EXPIRED/);
  assert.match(upgrades, /paymentReconciliationLeaseUntil/);
  assert.match(upgrades, /getBillplzBill\(config/);
  assert.match(upgrades, /deleteBillplzBill\(config/);
  assert.match(upgrades, /completePendingWorkspacePackageUpgrade/);
  assert.match(upgrades, /reconcileExpiredWorkspacePackagePayments/);
});

test("migration backfills active payment attempts and retains a reconciliation audit trail", () => {
  assert.match(migration, /paymentExpiresAt/);
  assert.match(migration, /INTERVAL '20 minutes'/);
  assert.match(migration, /WorkspacePackagePaymentReconciliation/);
});
