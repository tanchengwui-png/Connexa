import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { buildInboxHrefWithoutConversation } from "../lib/inbox-selection.ts";

const inboxSource = readFileSync(
  join(process.cwd(), "components", "inbox-workspace.tsx"),
  "utf8"
);

test("clearing the only selected conversation returns the canonical Inbox URL", () => {
  assert.equal(
    buildInboxHrefWithoutConversation("conversationId=conversation-123"),
    "/inbox"
  );
});

test("clearing a selected conversation preserves the active channel filter", () => {
  assert.equal(
    buildInboxHrefWithoutConversation(
      "channelId=channel-456&conversationId=conversation-123"
    ),
    "/inbox?channelId=channel-456"
  );
});

test("the Inbox handles Escape without overriding open dialogs or menus", () => {
  assert.match(inboxSource, /window\.addEventListener\("keydown", handleEscape\)/);
  assert.match(inboxSource, /event\.key !== "Escape"/);
  assert.match(inboxSource, /\.inbox-portal-menu, \[role='dialog'\], \[role='listbox'\]/);
  assert.match(inboxSource, /router\.push\(buildInboxHrefWithoutConversation\(currentSearchParams\)\)/);
});
