import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getWhatsAppProfilePictureUrl } from "../lib/whatsapp-profile-picture.ts";

test("uses the Contact profile picture before the client fallback", async () => {
  let clientCalled = false;
  const url = await getWhatsAppProfilePictureUrl({
    client: {
      getProfilePicUrl: async () => {
        clientCalled = true;
        return "https://fallback.invalid/photo.jpg";
      }
    },
    contact: {
      getProfilePicUrl: async () => " https://profile.invalid/photo.jpg "
    },
    contactId: "60123456789@c.us"
  });

  assert.equal(url, "https://profile.invalid/photo.jpg");
  assert.equal(clientCalled, false);
});

test("uses the profile thumbnail already loaded by WhatsApp Web", async () => {
  let contactLookupCalled = false;
  const url = await getWhatsAppProfilePictureUrl({
    client: { getProfilePicUrl: async () => null },
    contact: {
      _data: { profilePicThumb: { eurl: " https://profile.invalid/loaded-thumbnail.jpg " } },
      getProfilePicUrl: async () => {
        contactLookupCalled = true;
        return null;
      }
    },
    contactId: "60123456789@c.us"
  });

  assert.equal(url, "https://profile.invalid/loaded-thumbnail.jpg");
  assert.equal(contactLookupCalled, false);
});

test("returns null when a profile picture is unavailable because of privacy settings", async () => {
  const url = await getWhatsAppProfilePictureUrl({
    client: { getProfilePicUrl: async () => null },
    contact: { getProfilePicUrl: async () => null },
    contactId: "60123456789@c.us"
  });

  assert.equal(url, null);
});

test("uses the phone-based WhatsApp ID when a LID profile lookup is unavailable", async () => {
  const requestedIds: string[] = [];
  const url = await getWhatsAppProfilePictureUrl({
    client: {
      getProfilePicUrl: async (contactId) => {
        requestedIds.push(contactId);
        return contactId.endsWith("@c.us") ? "https://profile.invalid/phone-id.jpg" : null;
      }
    },
    contactId: "255082570461314@lid",
    contactIds: ["60182894366@c.us"]
  });

  assert.equal(url, "https://profile.invalid/phone-id.jpg");
  assert.deepEqual(requestedIds, ["255082570461314@lid", "60182894366@c.us"]);
});

test("returns null when WhatsApp Web profile picture retrieval throws", async () => {
  const url = await getWhatsAppProfilePictureUrl({
    client: {
      getProfilePicUrl: async () => {
        throw new Error("Private profile picture");
      }
    },
    contact: {
      getProfilePicUrl: async () => {
        throw new Error("WhatsApp Web contact unavailable");
      }
    },
    contactId: "60123456789@c.us"
  });

  assert.equal(url, null);
});

test("retries a transient profile-picture lookup failure", async () => {
  let attempts = 0;
  const url = await getWhatsAppProfilePictureUrl({
    client: {
      getProfilePicUrl: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("WhatsApp Web is still loading");
        }
        return "https://profile.invalid/retried.jpg";
      }
    },
    contactId: "60123456789@c.us"
  });

  assert.equal(url, "https://profile.invalid/retried.jpg");
  assert.equal(attempts, 2);
});

test("the inbox avatar resets to initials when its profile image fails to load", () => {
  const source = readFileSync(join(process.cwd(), "components", "inbox", "contact-avatar.tsx"), "utf8");

  assert.match(source, /onError=\{\(\) => setImageFailed\(true\)\}/);
  assert.match(source, /retryAttempt >= 2/);
  assert.match(source, /avatarRetry=\$\{retryAttempt\}/);
  assert.match(source, /imageUrl && !imageFailed/);
  assert.match(source, /\) : \(\s*fallback\s*\)/s);
});

test("the WhatsApp bridge requests a profile picture from the WhatsApp chat and retries empty results quickly", () => {
  const source = readFileSync(join(process.cwd(), "lib", "whatsapp-web.ts"), "utf8");

  assert.match(source, /WWebJS\?\.getChat\(id\)/);
  assert.match(source, /requestProfilePicFromServer\(chat\)/);
  assert.match(source, /WHATSAPP_PROFILE_PHOTO_MISS_CACHE_TTL_MS \?\? "30000"/);
  assert.match(source, /\|\| 30_000/);
  assert.match(source, /photoUrl \? PROFILE_PHOTO_CACHE_TTL_MS : PROFILE_PHOTO_MISS_CACHE_TTL_MS/);
});

test("the WhatsApp bridge always resolves a group avatar from the group chat, never its latest sender", () => {
  const source = readFileSync(join(process.cwd(), "lib", "whatsapp-web.ts"), "utf8");

  assert.match(source, /const profileContact = isGroup \? input\.contact : input\.profileContact \?\? input\.contact/);
  assert.match(source, /const profileContactId = isGroup \? input\.remoteId : input\.profileContactId\?\.trim\(\) \|\| input\.remoteId/);
  assert.match(source, /isGroupRemoteId\(remoteId\) && chat \? await chat\.getContact\(\)\.catch\(\(\) => null\) : null/);
  assert.match(source, /photoUrl: isGroupConversation \? resolvedIdentity\.photoUrl : existingRemoteIdentity\.photoUrl \?\? resolvedIdentity\.photoUrl/);
  assert.match(source, /photoUrl: isGroupConversation \? effectiveIdentity\.photoUrl : effectiveIdentity\.photoUrl \?\? undefined/);
});
