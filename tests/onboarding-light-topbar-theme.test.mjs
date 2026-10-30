import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const shell = fs.readFileSync("components/dashboard-shell.tsx", "utf8");
const topbar = fs.readFileSync("components/dashboard-topbar.tsx", "utf8");
const nav = fs.readFileSync("components/dashboard-topbar-nav.tsx", "utf8");
const styles = fs.readFileSync("app/globals.css", "utf8");
const rootLayout = fs.readFileSync("app/layout.tsx", "utf8");

test("onboarding uses the shared top navigation instead of a dedicated sidebar", () => {
  assert.doesNotMatch(shell, /OnboardingDashboardSidebar/);
  assert.doesNotMatch(shell, /variant=\{isOnboardingLayout \? "onboarding"/);
  assert.match(shell, /<DashboardTopbar billingReminder=\{inboxBillingReminder\} currentPath=\{currentPath\} \/>/);
  assert.match(styles, /\.shell-onboarding \{\s*display: grid;\s*grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(styles, /\.shell-onboarding \.dashboard-topbar \{[\s\S]*?grid-column: 1;/);
  assert.ok(
    styles.lastIndexOf("Onboarding topbar cascade guard") > styles.lastIndexOf("WhatsApp onboarding — light workspace direction"),
    "the final topbar rules must follow legacy onboarding theme passes"
  );
});

test("light top bar exposes the reference navigation with icons on every authenticated page", () => {
  for (const label of ["Home", "Inbox", "Contacts", "Automations", "Campaigns", "Analytics", "Settings"]) {
    assert.match(topbar, new RegExp(`label: "${label}"`));
  }
  assert.match(nav, /DashboardNavIcon/);
  assert.match(nav, /dashboard-topbar-nav-icon/);
  assert.match(nav, /currentPath === "\/onboarding" && href === "\/workspace"/);
  assert.match(styles, /Shared authenticated topbar cascade guard/);
  assert.match(styles, /\.shell-topbar \.dashboard-topbar-primary \{[\s\S]*?grid-template-columns: auto minmax\(0, 1fr\) auto;/);
  assert.match(styles, /\.shell-topbar \.dashboard-topbar-link\.active/);
  assert.match(styles, /\.shell-topbar > \.app-main \{[\s\S]*?grid-row: 2;/);
  assert.ok(
    styles.lastIndexOf("Shared authenticated topbar cascade guard") > styles.lastIndexOf("Onboarding topbar cascade guard"),
    "the shared authenticated topbar rules must win the final cascade"
  );
});

test("authenticated workspace remains locked to the light color scheme", () => {
  assert.match(rootLayout, /<html data-theme="light"/);
  assert.match(rootLayout, /document\.documentElement\.dataset\.theme = "light"/);
  assert.match(styles, /linear-gradient\(180deg, #f7faff 0%, #eef4ff 100%\)/);
});
