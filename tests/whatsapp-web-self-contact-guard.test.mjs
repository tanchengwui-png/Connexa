import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const source = readFileSync(join(process.cwd(), "lib", "whatsapp-web.ts"), "utf8");

test("WhatsApp Web does not sync the connected account as a contact", () => {
  assert.match(source, /function isConnectedAccountIdentity/);
  assert.match(source, /ownRemoteId && remoteId && ownRemoteId === remoteId/);
  assert.match(source, /ownPhone && phone && ownPhone === phone/);
  assert.match(source, /input\.isSelfContact/);
  assert.match(source, /\[whatsapp-web\]\[\$\{eventName\}\] skipped self-chat/);
  assert.match(source, /\[whatsapp-web\]\[sync\] skipped self-chat/);
  assert.match(source, /skipped self-chat fallback/);
});

test("WhatsApp LID identifiers are never stored as contact phone numbers", () => {
  assert.match(source, /function resolveContactPhoneFromRemoteId/);
  assert.match(source, /remoteId\.endsWith\("@lid"\)/);
  assert.match(source, /return toStoredPhone\(resolved\?\.resolvedId\)/);
  assert.match(source, /never the LID's numeric portion/);
});
