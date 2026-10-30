import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (...parts) => readFileSync(join(root, ...parts), "utf8");
const billingPage = read("app", "account-settings", "billing", "page.tsx");
const manager = read("components", "account-billing-manager.tsx");
const plansPage = read("app", "account-settings", "billing", "plans", "page.tsx");
const billingDetailsPage = read("app", "account-settings", "billing", "details", "page.tsx");
const overviewApi = read("app", "api", "account", "billing", "overview", "route.ts");
const dataAndAccountPage = read("app", "account-settings", "data-and-account", "page.tsx");
const accountDeletionManager = read("components", "account-deletion-manager.tsx");
const styles = read("app", "globals.css");

test("expired billing uses one package-selection notice without removal language", () => {
  assert.match(manager, /<div className="subscriber-billing-header-content">/);
  assert.match(manager, /<span>Subscriber billing<\/span>/);
  assert.equal((manager.match(/<h1>My plan<\/h1>/g) ?? []).length, 1);
  assert.match(manager, /See your previous package and access your invoices and receipts\./);
  assert.match(styles, /\.subscriber-billing-header-content \{\s*display: grid;\s*gap: 0\.28rem;\s*padding-inline: 1\.08rem/);
  assert.match(styles, /\.billing-expiry-warning \{\s*padding: 1rem 1\.08rem/);
  assert.match(styles, /\.subscriber-billing-header \{\s*overflow: hidden;\s*padding: 0\.25rem 0 0\.15rem;\s*border: 1px solid rgba\(248, 113, 113, 0\.34\);\s*border-radius: 0\.95rem/);
  assert.match(manager, /Your subscription has expired/);
  assert.match(manager, /Select “Continue subscription” to choose a package and restore access to Connexa/);
  assert.match(manager, /Continue subscription/);
  assert.match(manager, /\/account-settings\/billing\/plans\?source=expired/);
  assert.doesNotMatch(billingPage, /Scheduled removal|permanently removed|59 days/);
  assert.match(manager, /!isSubscriptionExpired &&/);
});

test("expired subscriptions do not render plan cards on the billing landing page", () => {
  assert.match(billingPage, /canManage && !subscription\?\.isExpired/);
  assert.match(plansPage, /Choose a plan to continue/);
  assert.match(plansPage, /WorkspacePackageUpgradeCard/);
});

test("billing routes share the rounded header content wrapper", () => {
  for (const page of [plansPage, billingDetailsPage, dataAndAccountPage]) {
    assert.match(page, /<header className="subscriber-billing-header"><div className="subscriber-billing-header-content">/);
  }
});

test("expired billing has a compact account and billing settings card", () => {
  assert.match(manager, /canManage && !isSubscriptionExpired \? <section/);
  assert.match(manager, /Account and billing settings/);
  assert.match(manager, /Manage your billing information and account settings\./);
  assert.match(manager, /Manage billing details/);
  assert.match(manager, /Update your billing information/);
  assert.match(manager, /\/account-settings\/billing\/details/);
  assert.match(manager, /Data and account/);
  assert.match(manager, /Manage your data and account/);
  assert.match(manager, /\/account-settings\/data-and-account/);
  assert.match(manager, /subscriber-account-settings-link/);
  assert.match(manager, /<Link className="subscriber-account-settings-link" href=\{href\}>/);
  assert.doesNotMatch(manager, /Contact support/);
  assert.doesNotMatch(manager, /subscriber-billing-secondary-links/);
  assert.doesNotMatch(manager, /Delete All Data/);
  assert.doesNotMatch(manager, /Delete Account/);
  assert.match(manager, /!isSubscriptionExpired \? <section className="subscriber-plan-card"/);
  assert.match(styles, /grid-template-columns: minmax\(15rem, 0\.62fr\) minmax\(0, 1fr\)/);
  assert.match(styles, /\.subscriber-account-settings-link:focus-visible/);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*?\.subscriber-account-settings-links \{\s*grid-template-columns: 1fr/);
});

test("manual deletion controls remain on the data and account destination", () => {
  assert.match(dataAndAccountPage, /AccountDeletionManager/);
  assert.match(accountDeletionManager, /Delete All Data/);
  assert.match(accountDeletionManager, /Delete Account/);
  assert.match(accountDeletionManager, /payment-confirmation-dialog/);
});

test("billing documents default to five records", () => {
  assert.match(overviewApi, /perPage"\) \?\? 5/);
  assert.match(manager, /<option value=\{5\}>5<\/option>/);
});
