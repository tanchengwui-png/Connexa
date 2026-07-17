import { readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

const repoRoot = process.cwd();
const shellSource = readFileSync(join(repoRoot, "components", "dashboard-shell.tsx"), "utf8");
const globalStyles = readFileSync(join(repoRoot, "app", "globals.css"), "utf8");

test("dashboard payment reminder uses scoped layout classes", () => {
  assert.match(shellSource, /panel-row dashboard-payment-reminder-row/);
  assert.match(shellSource, /dashboard-payment-reminder-copy/);
  assert.match(shellSource, /button button-primary dashboard-payment-reminder-button/);
  assert.match(shellSource, /href="\/account-settings\/billing"/);
  assert.match(shellSource, /View my plan/);
});

test("dashboard payment reminder button is compact on desktop and full width on mobile", () => {
  assert.match(globalStyles, /\.dashboard-payment-reminder-row\s*\{[\s\S]*?display:\s*flex;/);
  assert.match(globalStyles, /\.dashboard-payment-reminder-row\s*\{[\s\S]*?justify-content:\s*space-between;/);
  assert.match(globalStyles, /\.dashboard-payment-reminder-button\s*\{[\s\S]*?flex:\s*0 0 auto;/);
  assert.match(globalStyles, /\.dashboard-payment-reminder-button\s*\{[\s\S]*?width:\s*auto;/);
  assert.match(globalStyles, /@media \(max-width:\s*760px\)\s*\{[\s\S]*?\.dashboard-payment-reminder-row\s*\{[\s\S]*?flex-direction:\s*column;/);
  assert.match(globalStyles, /@media \(max-width:\s*760px\)\s*\{[\s\S]*?\.dashboard-payment-reminder-button\s*\{[\s\S]*?width:\s*100%;/);
});
