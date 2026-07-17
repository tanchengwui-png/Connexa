import assert from "node:assert/strict";
import test from "node:test";
import { canStartUnsavedNumberConversation } from "../lib/whatsapp-channel";

test("allows active QR-paired WhatsApp Web sessions", () => {
  assert.equal(
    canStartUnsavedNumberConversation({
      connectionMethod: "web",
      connectionStatus: "READY",
      sessionClientId: "session-1",
      disconnectedAt: null,
      tokenExpiresAt: null,
      phoneNumber: "60123456789"
    }),
    true
  );
});

test("rejects api-based channels even when connected", () => {
  assert.equal(
    canStartUnsavedNumberConversation({
      connectionMethod: "api",
      connectionStatus: "READY",
      sessionClientId: "session-1",
      disconnectedAt: null,
      tokenExpiresAt: null,
      phoneNumber: "60123456789"
    }),
    false
  );
});

test("rejects qr sessions that are still preparing", () => {
  assert.equal(
    canStartUnsavedNumberConversation({
      connectionMethod: "web",
      connectionStatus: "QR_READY",
      sessionClientId: "session-1",
      disconnectedAt: null,
      tokenExpiresAt: null,
      phoneNumber: "60123456789"
    }),
    false
  );
});
