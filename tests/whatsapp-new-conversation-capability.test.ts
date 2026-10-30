import assert from "node:assert/strict";
import test from "node:test";
import { canStartUnsavedNumberConversation } from "../lib/whatsapp-channel";

test("allows active WhatsApp Web sessions regardless of whether they were linked by QR or pairing code", () => {
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

test("allows an active phone-pairing-code WhatsApp Web session to start a new conversation", () => {
  // Pairing code and QR are two authentication methods for the same persisted
  // WhatsApp Web channel; both resolve to `web` with a saved session id.
  assert.equal(
    canStartUnsavedNumberConversation({
      connectionMethod: "web",
      connectionStatus: "CONNECTED",
      sessionClientId: "pairing-code-session-1",
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
