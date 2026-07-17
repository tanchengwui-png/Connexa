import { readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

const repoRoot = process.cwd();
const componentSource = readFileSync(join(repoRoot, "components", "workspace-package-upgrade-card.tsx"), "utf8");
const globalStyles = readFileSync(join(repoRoot, "app", "globals.css"), "utf8");

test("package invoice history is opened from a compact modal trigger", () => {
  assert.match(componentSource, /<strong>Package Invoice History<\/strong>/);
  assert.match(componentSource, /View package history/);
  assert.match(componentSource, /setIsHistoryOpen\(true\)/);
  assert.match(componentSource, /aria-labelledby="package-invoice-history-title"/);
  assert.match(componentSource, /aria-modal="true"/);
  assert.match(componentSource, /role="dialog"/);
  assert.match(componentSource, /id="package-invoice-history-title">Package Invoice History/);
});

test("package invoice history modal keeps existing invoice details and actions", () => {
  assert.match(componentSource, /invoice\.invoiceNumber/);
  assert.match(componentSource, /invoice\.operationType/);
  assert.match(componentSource, /invoice\.currentPackageLabel/);
  assert.match(componentSource, /invoice\.targetPackageLabel/);
  assert.match(componentSource, /invoice\.billingPeriod/);
  assert.match(componentSource, /formatPackageAmount\(invoice\.amount, invoice\.currency, invoice\.billingPeriod\)/);
  assert.match(componentSource, /getInvoiceStatusDescription\(invoice\)/);
  assert.match(componentSource, /invoice\.paidAt/);
  assert.match(componentSource, /invoice\.status === "ISSUED"/);
  assert.match(componentSource, /handlePayInvoice\(invoice\.id\)/);
  assert.match(componentSource, /handleCancelInvoice\(invoice\.id\)/);
});

test("package management exposes a monthly yearly selector and interval-specific actions", () => {
  assert.match(componentSource, /aria-label="Package billing interval"/);
  assert.match(componentSource, /Monthly/);
  assert.match(componentSource, /Yearly/);
  assert.match(componentSource, /Renew \$\{option\.name\} \$\{formatWorkspacePackageBillingPeriodLabel\(billingPeriod\)\}/);
  assert.match(componentSource, /Upgrade to \$\{option\.name\} \$\{formatWorkspacePackageBillingPeriodLabel\(billingPeriod\)\}/);
  assert.match(componentSource, /billingPeriod/);
});

test("package invoice history modal implements accessible close and focus behavior", () => {
  assert.match(componentSource, /historyTriggerRef/);
  assert.match(componentSource, /historyCloseRef/);
  assert.match(componentSource, /historyDialogRef/);
  assert.match(componentSource, /document\.body\.style\.overflow = "hidden"/);
  assert.match(componentSource, /event\.key === "Escape"/);
  assert.match(componentSource, /event\.key !== "Tab"/);
  assert.match(componentSource, /querySelectorAll<HTMLElement>/);
  assert.match(componentSource, /onClick=\{\(\) => setIsHistoryOpen\(false\)\}/);
  assert.match(componentSource, /onClick=\{\(event\) => event\.stopPropagation\(\)\}/);
});

test("package invoice history modal uses constrained internal scrolling", () => {
  assert.match(globalStyles, /\.account-package-history-dialog\s*\{[^}]*max-height:\s*80vh/s);
  assert.match(globalStyles, /\.account-package-history-dialog-body\s*\{[^}]*overflow-y:\s*auto/s);
  assert.match(globalStyles, /\.account-package-history-summary\s*\{[^}]*justify-content:\s*space-between/s);
  assert.match(globalStyles, /@media \(max-width:\s*640px\)\s*\{[\s\S]*?\.account-package-history-summary\s*\{[^}]*flex-direction:\s*column/s);
});
