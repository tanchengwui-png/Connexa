import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (...parts) => readFileSync(join(root, ...parts), "utf8");
const automation = read("lib", "automation-engine.ts");
const campaigns = read("lib", "campaigns.ts");
const contacts = read("lib", "db-contacts.ts");
const whatsappWeb = read("lib", "whatsapp-web.ts");
const whatsapp = read("lib", "whatsapp.ts");

test("group chats never enter inbound rules or workflow automation", () => {
  assert.match(automation, /whatsAppRemoteId.*endsWith\("@g\.us"\)/s);
  assert.match(automation, /Rules, workflows, and their follow-ups are private-chat automation only/);
});

test("campaigns exclude contacts that only resolve to group conversations", () => {
  assert.match(campaigns, /groupOnlyContactIds/);
  assert.match(campaigns, /Group chats cannot receive campaigns/);
});

test("the Contacts directory excludes explicit and legacy group-only records", () => {
  assert.match(contacts, /CONTACTS_DIRECTORY_VISIBLE_CONDITION/);
  assert.match(contacts, /conv\."whatsAppRemoteId" NOT LIKE '%@g\.us'/);
  assert.match(contacts, /conv\."whatsAppRemoteId" IS NULL AND conv\.subject IS NULL/);
});

test("group sync prefers metadata subjects and rejects numeric group identifiers as titles", () => {
  assert.match(
    whatsappWeb,
    /snapshot\.groupMetadata\?\.subject \?\?\s*snapshot\.formattedTitle \?\?\s*snapshot\.name/
  );
  assert.match(
    whatsappWeb,
    /\[input\.groupSubject, input\.formattedTitle, input\.chatName, input\.groupContactName\]/
  );
  assert.match(whatsappWeb, /groupContactName: groupChatContact\?\.name/);
  assert.doesNotMatch(whatsappWeb, /groupContactName: contact\?\.name,\s*chat\s*\}\);/);
  assert.match(whatsappWeb, /!\/\^\\d\{12,\}\$\//);
  assert.match(whatsappWeb, /return groupTitle \|\| "Group chat"/);
  assert.match(whatsappWeb, /storedGroupTitle \?\? resolvedIdentity\.displayName/);
  assert.match(whatsapp, /function normalizeGroupSubject/);
  assert.match(
    whatsapp,
    /return subject === groupId \|\| \/\^\\d\{12,\}\$\/\.test\(subject\) \? null : subject;/
  );
});
