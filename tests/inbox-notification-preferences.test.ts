import assert from "node:assert/strict";
import test from "node:test";
import {
  parseInboxDesktopNotificationsPromptDismissedInput,
  parseInboxNotificationSoundsMutedInput
} from "../lib/inbox-notification-preferences";
import {
  buildInboxNotificationSoundPreferenceStorageKey
} from "../lib/inbox-notification-sound-client";
import {
  buildInboxDesktopNotificationsNotNowStorageKeyForTest
} from "../lib/use-inbox-browser-notifications";

test("buildInboxNotificationSoundPreferenceStorageKey scopes storage by workspace and agent", () => {
  assert.equal(
    buildInboxNotificationSoundPreferenceStorageKey({
      agentId: "agent-1",
      workspaceId: "workspace-1"
    }),
    "connexa.inboxNotificationSoundsMuted:workspace-1:agent-1"
  );
});

test("parseInboxNotificationSoundsMutedInput accepts boolean values", () => {
  assert.equal(parseInboxNotificationSoundsMutedInput(true), true);
  assert.equal(parseInboxNotificationSoundsMutedInput(false), false);
});

test("parseInboxNotificationSoundsMutedInput rejects non-boolean values", () => {
  assert.throws(
    () => parseInboxNotificationSoundsMutedInput("true"),
    /INVALID_INBOX_NOTIFICATION_SOUNDS_MUTED/
  );
});

test("buildInboxDesktopNotificationsNotNowStorageKeyForTest scopes the desktop prompt dismissal by workspace and agent", () => {
  assert.equal(
    buildInboxDesktopNotificationsNotNowStorageKeyForTest({
      agentId: "agent-1",
      workspaceId: "workspace-1"
    }),
    "connexa.inboxDesktopNotificationsNotNow:workspace-1:agent-1"
  );
});

test("parseInboxDesktopNotificationsPromptDismissedInput only accepts true", () => {
  assert.equal(parseInboxDesktopNotificationsPromptDismissedInput(true), true);
  assert.throws(
    () => parseInboxDesktopNotificationsPromptDismissedInput(false),
    /INVALID_INBOX_DESKTOP_NOTIFICATIONS_PROMPT_DISMISSED/
  );
});
