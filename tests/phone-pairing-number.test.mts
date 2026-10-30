import assert from "node:assert/strict";
import test from "node:test";
import { maskPhoneNumber, normalizeWhatsAppWebPairingPhone } from "../lib/phone-pairing-number.ts";

test("normalizes Malaysian national numbers for WhatsApp Web pairing", () => {
  assert.deepEqual(normalizeWhatsAppWebPairingPhone({ countryCode: "MY", phoneNumber: "012-345 6789" }), {
    countryCode: "MY",
    internationalDigits: "60123456789",
    maskedPhoneNumber: "+••••••••789"
  });
});

test("normalizes international pasted numbers and detects their country", () => {
  assert.equal(normalizeWhatsAppWebPairingPhone({ countryCode: "MY", phoneNumber: "+1 (202) 555-0108" }).internationalDigits, "12025550108");
  assert.equal(normalizeWhatsAppWebPairingPhone({ countryCode: "GB", phoneNumber: "020 7946 0018" }).internationalDigits, "442079460018");
});

test("rejects impossible numbers and keeps only a masked response", () => {
  assert.throws(() => normalizeWhatsAppWebPairingPhone({ countryCode: "MY", phoneNumber: "123" }), /WHATSAPP_PHONE_PAIRING_INVALID_NUMBER/);
  assert.equal(maskPhoneNumber("+60123456789"), "+••••••••789");
});
