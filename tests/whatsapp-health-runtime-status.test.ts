import test from "node:test";
import assert from "node:assert/strict";
import {
  isWhatsAppConnectedRuntimeStatus,
  isWhatsAppDisconnectedRuntimeStatus,
  isWhatsAppPreparingRuntimeStatus
} from "../lib/whatsapp-runtime-status.js";

test("QR and initializing states are not treated as connected", () => {
  assert.equal(isWhatsAppConnectedRuntimeStatus("QR_READY"), false);
  assert.equal(isWhatsAppConnectedRuntimeStatus("INITIALIZING"), false);
  assert.equal(isWhatsAppConnectedRuntimeStatus("AUTHENTICATED"), false);
  assert.equal(isWhatsAppPreparingRuntimeStatus("QR_READY"), true);
  assert.equal(isWhatsAppPreparingRuntimeStatus("INITIALIZING"), true);
  assert.equal(isWhatsAppPreparingRuntimeStatus("AUTHENTICATED"), true);
});

test("ready and synced states are treated as connected", () => {
  assert.equal(isWhatsAppConnectedRuntimeStatus("READY"), true);
  assert.equal(isWhatsAppConnectedRuntimeStatus("SYNCING_HISTORY"), true);
  assert.equal(isWhatsAppConnectedRuntimeStatus("CONNECTED"), true);
});

test("disconnected states remain classified as disconnected", () => {
  assert.equal(isWhatsAppDisconnectedRuntimeStatus("DISCONNECTED"), true);
  assert.equal(isWhatsAppDisconnectedRuntimeStatus("AUTH_FAILED"), true);
  assert.equal(isWhatsAppDisconnectedRuntimeStatus("QR_READY"), false);
});
