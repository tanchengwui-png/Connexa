import assert from "node:assert/strict";
import test from "node:test";
import {
  buildInboxHrefWithConversation,
  isCurrentInboxConversationResponse
} from "../lib/inbox-selection.ts";

test("rejects a late response for the prior conversation after route selection changes", () => {
  assert.equal(
    isCurrentInboxConversationResponse({
      requestedConversationId: "ming-yeoh",
      routeConversationId: "rasuk",
      responseConversationId: "ming-yeoh"
    }),
    false
  );
});

test("accepts the response for the conversation selected in the route", () => {
  assert.equal(
    isCurrentInboxConversationResponse({
      requestedConversationId: "rasuk",
      routeConversationId: "rasuk",
      responseConversationId: "rasuk"
    }),
    true
  );
});

test("builds a client-side chat URL without dropping the selected channel or filters", () => {
  assert.equal(
    buildInboxHrefWithConversation("channelId=channel-1&view=unread", "chat / 42"),
    "/inbox?channelId=channel-1&view=unread&conversationId=chat+%2F+42"
  );
});
