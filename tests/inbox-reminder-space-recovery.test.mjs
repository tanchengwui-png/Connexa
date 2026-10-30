import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const repoRoot = process.cwd();
const shellSource = readFileSync(join(repoRoot, "components", "dashboard-shell.tsx"), "utf8");
const topbarSource = readFileSync(join(repoRoot, "components", "dashboard-topbar.tsx"), "utf8");
const inboxSource = readFileSync(join(repoRoot, "components", "inbox-workspace.tsx"), "utf8");
const globalStyles = readFileSync(join(repoRoot, "app", "globals.css"), "utf8");

test("the Inbox moves its payment reminder into the topbar instead of consuming workspace height", () => {
  assert.match(shellSource, /<DashboardTopbar billingReminder=\{inboxBillingReminder\}/);
  assert.match(shellSource, /\{!isInboxLayout && currentPath !== "\/account-settings\/billing"/);
  assert.match(topbarSource, /className="dashboard-topbar-billing-alert"/);
  assert.match(topbarSource, /href=\{billingReminder\.href\}/);
});

test("desktop notification permission is a compact Inbox toolbar control", () => {
  const actionsIndex = inboxSource.indexOf('className="inbox-reference-topbar-actions"');
  const compactPromptIndex = inboxSource.indexOf("inbox-desktop-notifications-compact");

  assert.ok(actionsIndex >= 0);
  assert.ok(compactPromptIndex > actionsIndex);
  assert.doesNotMatch(inboxSource, /inbox-snooze-banner inbox-desktop-notifications-banner/);
  assert.match(inboxSource, /Desktop alerts off/);
  assert.match(inboxSource, /Desktop alerts on/);
  assert.match(inboxSource, /<DesktopAlertIcon \/>/);
  assert.match(inboxSource, /<IncognitoIcon \/>/);
  assert.match(inboxSource, /<PlusIcon \/>/);
  assert.doesNotMatch(inboxSource, /\{shouldShowInboxDesktopNotificationsPrompt \? \(\s*<div className="inbox-desktop-notifications-compact"/);
  assert.doesNotMatch(inboxSource, /Desktop notification options/);
  assert.match(inboxSource, /aria-pressed=\{inboxDesktopNotificationsEnabled\}/);
  assert.match(inboxSource, /Incognito on/);
  assert.match(inboxSource, /Incognito off/);
});

test("Inbox toolbar controls remain actionable and report their result", () => {
  assert.match(
    inboxSource,
    /selectedChannelId \?\? activeConversationChannelId \?\? singlePersonalWhatsAppChannel\?\.id/
  );
  assert.match(inboxSource, /onClick=\{\(\) => void handleDesktopNotificationsClick\(\)\}/);
  assert.match(inboxSource, /toast\.error\("Desktop alerts are blocked", message\)/);
  assert.match(inboxSource, /toast\.success\([\s\S]*?"Desktop alerts enabled"/);
  assert.match(inboxSource, /toast\.success\([\s\S]*?"Desktop alerts disabled"/);
  assert.match(inboxSource, /disableDesktopNotifications\(\)/);
  assert.match(inboxSource, /toast\.success\([\s\S]*?"Incognito mode enabled"/);
  assert.match(inboxSource, /disabled=\{isInboxDesktopNotificationsPending\}/);
  assert.match(inboxSource, /toast\.error\("Choose a WhatsApp number", message\)/);
  assert.match(inboxSource, /disabled=\{isPending\}[\s\S]*?onClick=\{toggleIncognitoMode\}/);
});

test("compact reminders have dedicated desktop and light-theme styling", () => {
  assert.match(globalStyles, /\.dashboard-topbar-billing-alert\s*\{/);
  assert.match(globalStyles, /\.inbox-desktop-notifications-compact\s*\{/);
  assert.match(globalStyles, /width: 34px;[\s\S]*min-width: 34px;[\s\S]*height: 34px;/);
  assert.match(globalStyles, /\.inbox-toolbar-control-label\s*\{/);
  assert.match(globalStyles, /html\[data-theme="light"\] \.dashboard-topbar-billing-alert/);
});
