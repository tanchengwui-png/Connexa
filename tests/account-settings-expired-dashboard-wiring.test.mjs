import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (...parts) => readFileSync(join(root, ...parts), "utf8");
const page = read("app", "account-settings", "page.tsx");
const dashboard = read("components", "account-settings-dashboard.tsx");
const shell = read("components", "dashboard-shell.tsx");
const styles = read("app", "globals.css");

test("account settings derives expiry from the subscription overview and keeps the shared route available", () => {
  assert.match(page, /getCurrentSubscriptionOverview\(manager\.workspaceId\)/);
  assert.match(page, /const isSubscriptionExpired = Boolean\(subscription\?\.isExpired\)/);
  assert.match(shell, /currentPath !== "\/account-settings\/billing" && currentPath !== "\/account-settings"/);
});

test("expired account settings replaces active-only status with an accessible renewal state", () => {
  assert.match(dashboard, /isSubscriptionExpired: boolean/);
  assert.match(dashboard, /Your subscription has expired\./);
  assert.match(dashboard, /role="alert"/);
  assert.match(dashboard, /Renew your subscription to restore workspace features\./);
  assert.match(dashboard, /props\.isSubscriptionExpired \? "Expired" : props\.workspaceStatus/);
  assert.match(dashboard, /props\.isSubscriptionExpired \? <section className="account-settings-expired-alert"[\s\S]*?: props\.isSetupComplete/);
  assert.match(styles, /\.account-settings-expired-alert \{/);
});

test("expired WhatsApp access is separate from connection state and does not expose inbox navigation", () => {
  assert.match(dashboard, /Definition label="Connection" value=\{props\.whatsappStatus\}/);
  assert.match(dashboard, /Definition label="Subscription access" value=\{subscriptionAccess\}/);
  assert.match(dashboard, /props\.isSubscriptionExpired \? <Link className="button button-primary" href=\{props\.renewHref\}>Renew subscription<\/Link>/);
  assert.match(dashboard, /: <><Link className="button button-primary" href="\/inbox">Open inbox<\/Link>/);
});

test("expired billing, usage, and security stay in the shared dashboard", () => {
  assert.match(dashboard, /<h2>Subscription recovery<\/h2>/);
  assert.match(dashboard, /href="\/account-settings\/billing\/details"/);
  assert.match(dashboard, /Usage shown reflects the most recently available workspace data\./);
  assert.match(dashboard, /activeTab === "security" \? <AccountSecurityCard \/>/);
  assert.match(page, /return <DashboardShell currentPath="\/account-settings"><AccountSettingsDashboard/);
});
