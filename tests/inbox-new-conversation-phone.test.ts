import assert from "node:assert/strict";
import test from "node:test";
import {
  NewConversationError,
  normalizeNewConversationPhoneInput
} from "../lib/inbox-new-conversation";

test("normalizes a local-format number with a country code", () => {
  assert.equal(
    normalizeNewConversationPhoneInput({
      countryCode: "60",
      phoneNumber: "012-345 6789"
    }),
    "60123456789"
  );
});

test("accepts an already international number without a country code", () => {
  assert.equal(
    normalizeNewConversationPhoneInput({
      countryCode: "",
      phoneNumber: "+60123456789"
    }),
    "60123456789"
  );
});

test("rejects unsupported characters", () => {
  assert.throws(
    () =>
      normalizeNewConversationPhoneInput({
        countryCode: "",
        phoneNumber: "60ABC123"
      }),
    (error: unknown) =>
      error instanceof NewConversationError && error.code === "NEW_NUMBER_CONVERSATION_INVALID_PHONE"
  );
});
