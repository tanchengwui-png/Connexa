import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pairingService = readFileSync(new URL("../lib/whatsapp-web-phone-pairing.ts", import.meta.url), "utf8");
const phoneNumberHelper = readFileSync(new URL("../lib/phone-pairing-number.ts", import.meta.url), "utf8");
const pairingRoute = readFileSync(new URL("../app/api/settings/whatsapp/pairing/route.ts", import.meta.url), "utf8");
const phonePanel = readFileSync(new URL("../components/web-phone-pairing-panel.tsx", import.meta.url), "utf8");
const onboarding = readFileSync(new URL("../components/whatsapp-connection-onboarding.tsx", import.meta.url), "utf8");
const qrPanel = readFileSync(new URL("../components/web-qr-setup-panel.tsx", import.meta.url), "utf8");
const cloudPanel = readFileSync(new URL("../components/official-api-setup-form.tsx", import.meta.url), "utf8");
const senderClient = readFileSync(new URL("../lib/sender-service-client.ts", import.meta.url), "utf8");
const senderService = readFileSync(new URL("../scripts/sender-service.ts", import.meta.url), "utf8");
const runtime = readFileSync(new URL("../lib/whatsapp-runtime.ts", import.meta.url), "utf8");
const webRuntime = readFileSync(new URL("../lib/whatsapp-web.ts", import.meta.url), "utf8");

test("personal pairing is explicitly gated before WhatsApp Web runtime access", () => {
  assert.match(pairingService, /channel\.workspaceId !== input\.workspaceId \|\| channel\.connectionMethod !== "web"/);
  assert.match(pairingService, /throw new Error\("WHATSAPP_PHONE_PAIRING_UNSUPPORTED_CHANNEL"\)/);
  assert.match(pairingService, /await requestWhatsAppWebPairingCode/);
  assert.match(runtime, /isRemoteSenderServiceEnabled\(\).*requestRemoteWhatsAppWebPairingCode/s);
  assert.match(senderClient, /"\/whatsapp\/pairing"/);
  assert.match(senderClient, /SENDER_SERVICE_PAIRING_TIMEOUT_MS/);
  assert.match(senderService, /url\.pathname === "\/whatsapp\/pairing"/);
  assert.match(senderService, /getSafePhonePairingFailureCode/);
  assert.match(senderService, /getSafePhonePairingFailureDetail/);
  assert.doesNotMatch(senderService, /\[sender\]\[phone-pairing\][^\n]*phoneNumber/);
  assert.match(webRuntime, /WHATSAPP_PHONE_PAIRING_CLIENT_PREPARING/);
  assert.match(webRuntime, /export async function requestWhatsAppWebClientPairingCode/);
  assert.match(webRuntime, /pairingWindow\.onCodeReceivedEvent =/);
  assert.match(webRuntime, /PHONE_PAIRING_CODE_BRIDGE_KEY/);
  assert.match(webRuntime, /never retry the provider call/);
  assert.match(webRuntime, /runtime\.client\.requestPairingCode\(input\.phoneNumber\)/);
  assert.match(webRuntime, /WHATSAPP_PHONE_PAIRING_CODE_UNAVAILABLE/);
});

test("pairing uses metadata validation, masks responses, and never stores or logs the code", () => {
  assert.match(phoneNumberHelper, /parsePhoneNumberFromString/);
  assert.match(phoneNumberHelper, /parsed\.isPossible\(\).*parsed\.isValid\(\)/s);
  assert.match(phoneNumberHelper, /maskedPhoneNumber/);
  assert.match(pairingService, /PAIRING_CODE_COOLDOWN_MS/);
  assert.match(pairingService, /prisma\.whatsAppPhonePairingAudit\.create/);
  assert.match(pairingService, /phoneNumberCiphertext: encryptSecret\(normalized\.internationalDigits\)/);
  assert.match(pairingService, /pairingCodeCiphertext: encryptSecret\(pairingCode\)/);
  assert.doesNotMatch(pairingService, /console\.(?:info|warn|error)\([^\n]*pairingCode/);
  assert.doesNotMatch(pairingService, /pairingRequestStates\.set\([^\n]*pairingCode/);
});

test("pairing route is separate from protected QR and Cloud setup route", () => {
  assert.match(pairingRoute, /requireApiManager/);
  assert.match(pairingRoute, /requestWhatsAppWebPhonePairingCode/);
  assert.doesNotMatch(pairingRoute, /meta|accessToken|phoneNumberId|ensureWorkspaceWhatsAppClient/i);
});

test("phone pairing is a web-only sibling view and QR component source stays independent", () => {
  assert.match(onboarding, /method === "api"/);
  assert.match(onboarding, /WebPhonePairingPanel/);
  assert.match(onboarding, /webLinkMethod === "phone"/);
  assert.match(onboarding, /<WebQrSetupPanel/);
  assert.match(phonePanel, /Use QR code instead/);
  assert.match(phonePanel, /Search country or code/);
  assert.match(phonePanel, /getCountries\(\)/);
  assert.match(phonePanel, /role="listbox"/);
  assert.match(phonePanel, /parsePhoneNumberFromString/);
  assert.doesNotMatch(cloudPanel, /Link with phone number|phone-pairing/i);
  assert.doesNotMatch(qrPanel, /Pairing code|Link with phone number instead/);
});

test("successful phone pairing moves to the connected-number summary instead of leaving the code on screen", () => {
  assert.match(phonePanel, /hasReportedPairingSuccessRef\.current = true;[\s\S]*onPairingConnected\(\);/);
  const callback = onboarding.match(
    /onPairingConnected=\{\(\) => \{([\s\S]*?)\n\s*\}\}/
  )?.[1] ?? "";
  assert.match(callback, /setConnectedViaPhonePairing\(true\);/);
  assert.match(callback, /setWebLinkMethod\("qr"\);/);
  assert.doesNotMatch(callback, /router\.refresh\(\);/);
  assert.match(qrPanel, /connectedViaPhonePairing && !hasLoadedRuntimeStatus/);
  assert.match(qrPanel, /Pairing successful\./);
});
