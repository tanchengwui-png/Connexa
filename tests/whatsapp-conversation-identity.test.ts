import assert from "node:assert/strict";
import test from "node:test";
import { pickReusableConversation, resolveSafeConversationRemoteId } from "../lib/whatsapp";

test("pickReusableConversation reuses an existing lid conversation instead of creating a new c.us self-number thread", () => {
  const selected = pickReusableConversation(
    [
      {
        id: "conversation-lid",
        channelId: "channel-1",
        contactId: "contact-1",
        whatsAppRemoteId: "255082570461314@lid",
        unreadCount: 0,
        lastMessagePreview: "older",
        updatedAt: new Date("2026-05-28T11:59:17.000Z"),
        lastMessageAt: new Date("2026-05-28T11:59:17.000Z"),
        contact: {
          id: "contact-1",
          phone: "60182894366",
          displayName: "Test Contact",
          displayNameManualOverride: false,
          photoUrl: null
        }
      }
    ],
    "channel-1",
    "60182894366@c.us",
    "60182894366"
  );

  assert.equal(selected?.id, "conversation-lid");
});

test("pickReusableConversation reuses the existing direct thread when a mismatched remote id arrives", () => {
  const selected = pickReusableConversation(
    [
      {
        id: "conversation-current",
        channelId: "channel-1",
        contactId: "contact-1",
        whatsAppRemoteId: "255082570461314@lid",
        unreadCount: 0,
        lastMessagePreview: "latest",
        updatedAt: new Date("2026-05-28T12:00:00.000Z"),
        lastMessageAt: new Date("2026-05-28T12:00:00.000Z"),
        contact: {
          id: "contact-1",
          phone: "60182894366",
          displayName: "Test Contact",
          displayNameManualOverride: false,
          photoUrl: null
        }
      }
    ],
    "channel-1",
    "60182188416@c.us",
    "60182894366"
  );

  assert.equal(selected?.id, "conversation-current");
});

test("resolveSafeConversationRemoteId preserves an existing lid remote when a c.us self-number candidate appears", () => {
  assert.equal(
    resolveSafeConversationRemoteId({
      candidateRemoteId: "60182894366@c.us",
      currentRemoteId: "255082570461314@lid",
      contactPhone: "60182894366"
    }),
    "255082570461314@lid"
  );
});

test("resolveSafeConversationRemoteId rejects unrelated direct remote ids", () => {
  assert.equal(
    resolveSafeConversationRemoteId({
      candidateRemoteId: "60182188416@c.us",
      currentRemoteId: "255082570461314@lid",
      contactPhone: "60182894366"
    }),
    "255082570461314@lid"
  );
});
