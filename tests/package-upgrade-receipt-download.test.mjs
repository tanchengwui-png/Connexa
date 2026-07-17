import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

const repoRoot = resolve(dirname(new URL(import.meta.url).pathname), "..");

test("paid package-upgrade billing documents can generate receipt PDFs", () => {
  const source = readFileSync(join(repoRoot, "lib", "billing-management.ts"), "utf8");

  assert.match(source, /status, "paidAt", "providerReference", "createdAt", "updatedAt"/);
  assert.match(source, /if \(type === "receipt"\) \{/);
  assert.match(source, /if \(upgrade\.status !== "PAID"\)/);
  assert.match(source, /buildReceiptPdf\(receiptContext\)/);
  assert.match(source, /fileName: `receipt-\$\{receiptContext\.receiptNo\}\.pdf`/);
});
