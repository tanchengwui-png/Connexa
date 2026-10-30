import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseMetaEmbeddedSignupEvent } from "../lib/meta-embedded-signup-event.ts";

const root = new URL("../", import.meta.url);

test("Embedded Signup accepts FINISH only from trusted Meta origins", () => {
  assert.deepEqual(
    parseMetaEmbeddedSignupEvent({
      origin: "https://www.facebook.com",
      data: JSON.stringify({
        type: "WA_EMBEDDED_SIGNUP",
        event: "FINISH",
        data: { waba_id: "waba-1", phone_number_id: "phone-1" }
      })
    }),
    { event: "FINISH", wabaId: "waba-1", phoneNumberId: "phone-1" }
  );
  assert.equal(
    parseMetaEmbeddedSignupEvent({
      origin: "https://facebook.example.test",
      data: { type: "WA_EMBEDDED_SIGNUP", event: "FINISH" }
    }),
    null
  );
});

test("Embedded Signup recognizes terminal events and rejects malformed messages", () => {
  for (const event of ["CANCEL", "ERROR"]) {
    assert.deepEqual(
      parseMetaEmbeddedSignupEvent({
        origin: "https://web.facebook.com",
        data: { type: "WA_EMBEDDED_SIGNUP", event, data: {} }
      }),
      { event, wabaId: null, phoneNumberId: null }
    );
  }
  assert.equal(
    parseMetaEmbeddedSignupEvent({ origin: "https://www.facebook.com", data: "not-json" }),
    null
  );
});

test("v4 UI uses code flow, trusted messages, and listener cleanup", () => {
  const source = readFileSync(new URL("components/official-api-setup-form.tsx", root), "utf8");
  assert.match(source, /config_id:\s*metaEmbeddedSignup\.configId/);
  assert.match(source, /response_type:\s*"code"/);
  assert.match(source, /override_default_response_type:\s*true/);
  assert.match(source, /window\.addEventListener\("message", handleEmbeddedSignupMessage\)/);
  assert.match(source, /window\.removeEventListener\("message", handleEmbeddedSignupMessage\)/);
  assert.match(source, /wabaId:\s*activeSignup\.sessionInfo\?\.wabaId/);
  assert.match(source, /phoneNumberId:\s*activeSignup\.sessionInfo\?\.phoneNumberId/);
  assert.doesNotMatch(source, /localStorage|sessionStorage/);
});

test("server verifies popup account identifiers against Graph-discovered assets", () => {
  const source = readFileSync(
    new URL("app/api/integrations/meta/embedded-signup/callback/route.ts", root),
    "utf8"
  );
  assert.match(source, /phoneNumber\.businessAccountId === reportedWabaId/);
  assert.match(source, /phoneNumber\.phoneNumberId === reportedPhoneNumberId/);
  assert.match(source, /META_EMBEDDED_SIGNUP_SESSION_MISMATCH/);
  assert.match(source, /workspaceId !== manager\.workspaceId/);
  assert.match(source, /subscribeMetaWabaApp/);
});

test("platform webhook verification uses a timing-safe token comparison", () => {
  const source = readFileSync(new URL("app/api/webhooks/whatsapp/route.ts", root), "utf8");
  assert.match(source, /timingSafeEqual/);
  assert.match(source, /secureTokenEquals\(defaultVerifyToken, verifyToken\.trim\(\)\)/);
});

test("platform Meta secrets are encrypted before database storage", () => {
  const source = readFileSync(new URL("lib/platform-config.ts", root), "utf8");
  assert.match(source, /encryptSecretForStorage\(metaAppSecret\)/);
  assert.match(source, /encryptSecretForStorage\(metaWebhookVerifyToken\)/);
  assert.match(source, /decryptStoredSecret\(config\.metaWebhookVerifyToken\)/);
});
