import assert from "node:assert/strict";
import test from "node:test";
import {
  formatWhatsAppGroupNotification,
  formatWhatsAppParticipantLabel,
  isWhatsAppGroupNotificationPayload,
  readWhatsAppGroupNotificationMetadata
} from "../lib/whatsapp-group-notification.ts";

test("reads gp2 subtype and participants from whatsapp-web.js private message data", () => {
  assert.deepEqual(
    readWhatsAppGroupNotificationMetadata({
      type: "gp2",
      author: "60126709430@c.us",
      _data: {
        subtype: "remove",
        recipients: [{ _serialized: "60122211285@c.us" }]
      }
    }),
    {
      subtype: "remove",
      authorId: "60126709430@c.us",
      recipientIds: ["60122211285@c.us"]
    }
  );
});

test("renders a gp2 removal with resolved WhatsApp names instead of [Gp2]", () => {
  assert.equal(
    formatWhatsAppGroupNotification({
      type: "gp2",
      rawPayload: {
        groupNotification: {
          subtype: "remove",
          authorId: "60126709430@c.us",
          recipientIds: ["60122211285@c.us"],
          actorLabel: "Salina MIDA IT",
          recipientLabels: ["+60 12-221 1285"]
        }
      }
    }),
    "Salina MIDA IT removed +60 12-221 1285"
  );
});

test("formats participant phone ids when WhatsApp contact names are unavailable", () => {
  assert.equal(
    formatWhatsAppGroupNotification({
      type: "gp2",
      rawPayload: {
        groupNotification: {
          subtype: "remove",
          authorId: "60126709430@c.us",
          recipientIds: ["60122211285@c.us"]
        }
      }
    }),
    "+60 12 670 9430 removed +60 12 221 1285"
  );
});

test("renders other group lifecycle events with human-readable text", () => {
  assert.equal(
    formatWhatsAppGroupNotification({
      type: "group_notification",
      rawPayload: {
        groupNotification: {
          subtype: "add",
          authorId: "actor@lid",
          recipientIds: ["first@lid", "second@lid"],
          actorLabel: "Admin",
          recipientLabels: ["Aisyah", "Puan"]
        }
      }
    }),
    "Admin added Aisyah and Puan"
  );
});

test("uses a gp2 subject body as the new group name", () => {
  assert.equal(
    formatWhatsAppGroupNotification({
      type: "gp2",
      body: "New project room",
      rawPayload: {
        groupNotification: {
          subtype: "subject",
          authorId: "actor@lid",
          recipientIds: [],
          actorLabel: "Admin"
        }
      }
    }),
    "Admin changed the group name to “New project room”"
  );
});

test("never formats a WhatsApp LID as an international phone number", () => {
  assert.equal(formatWhatsAppParticipantLabel("204693997404235@lid"), null);
});

test("classifies gp2 payloads as group system events", () => {
  assert.equal(isWhatsAppGroupNotificationPayload('{"type":"gp2"}'), true);
  assert.equal(
    isWhatsAppGroupNotificationPayload({ groupNotification: { subtype: "remove" } }),
    true
  );
  assert.equal(isWhatsAppGroupNotificationPayload('{"type":"chat"}'), false);
});
