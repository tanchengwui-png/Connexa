import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { normalizeWhatsAppPushName } from "../lib/whatsapp-push-name.ts";

const repoRoot = process.cwd();
const read = (...parts: string[]) => readFileSync(join(repoRoot, ...parts), "utf8");

test("normalizes the owner-configured WhatsApp name without changing its content", () => {
  assert.equal(normalizeWhatsAppPushName("  ~  陈小明 🚀  "), "陈小明 🚀");
  assert.equal(normalizeWhatsAppPushName("Jane-Doe (Sales)"), "Jane-Doe (Sales)");
  assert.equal(normalizeWhatsAppPushName("   "), null);
  assert.equal(normalizeWhatsAppPushName(null), null);
});

test("adds one separate nullable Contact field and migration", () => {
  const schema = read("prisma", "schema.prisma");
  const migration = read(
    "prisma",
    "migrations",
    "20260804120000_add_contact_whatsapp_push_name",
    "migration.sql"
  );

  assert.match(schema, /whatsappPushName\s+String\?/);
  assert.match(migration, /ADD COLUMN "whatsappPushName" TEXT/);
  assert.doesNotMatch(migration, /NOT NULL|DEFAULT|UNIQUE/i);
});

test("personal direct-chat ingestion reads pushname without storing a group title", () => {
  const runtime = read("lib", "whatsapp-web.ts");
  const persistence = read("lib", "whatsapp.ts");

  assert.match(
    runtime,
    /whatsappPushName: isGroup \? null : normalizeWhatsAppPushName\(input\.contact\?\.pushname\)/
  );
  assert.match(runtime, /whatsappPushName: effectiveIdentity\.whatsappPushName \?\? undefined/);
  assert.match(runtime, /whatsappPushName: resolvedIdentity\.whatsappPushName \?\? undefined/);
  assert.match(persistence, /normalizedWhatsappPushName = isGroupRemoteId\(inboundRemoteId\)/);
  assert.match(persistence, /normalizedWhatsappPushName !== existingContact\?\.whatsappPushName/);
});

test("missing personal values do not clear a stored WhatsApp name", () => {
  const persistence = read("lib", "whatsapp.ts");

  assert.doesNotMatch(persistence, /whatsappPushName:\s*null\s*}\s*:\s*{/);
  assert.match(
    persistence,
    /normalizedWhatsappPushName && normalizedWhatsappPushName !== existingContact\?\.whatsappPushName/
  );
});

test("Contacts renders the value secondarily and keeps the primary display name", () => {
  const contactsData = read("lib", "contacts.ts");
  const directory = read("components", "contacts-directory.tsx");

  assert.match(contactsData, /whatsappPushName: contact\.whatsappPushName/);
  assert.match(
    directory,
    /<strong>\{contact\.displayName}<\/strong>[\s\S]*?~\{whatsappPushName}/
  );
  assert.match(directory, /whatsappPushName\.toLocaleLowerCase\(\) === contact\.displayName\.trim\(\)\.toLocaleLowerCase\(\)/);
});

test("Inbox Contact Details receives and renders WhatsApp ~Name without changing Cloud ingestion", () => {
  const inbox = read("lib", "inbox.ts");
  const inboxTypes = read("components", "inbox", "types.ts");
  const inboxDetails = read("components", "inbox", "detail-panel.tsx");
  const conversations = read("lib", "conversations.ts");
  const conversationQueries = read("lib", "db-conversations.ts");
  const cloudWebhookRoute = read("app", "api", "webhooks", "whatsapp", "route.ts");
  const whatsappService = read("lib", "whatsapp.ts");
  const cloudIngestion = whatsappService.slice(
    whatsappService.indexOf("export async function ingestWhatsappWebhook"),
    whatsappService.indexOf("export async function ingestSimulatedInboundMessage")
  );

  assert.match(conversationQueries, /ELSE c\."whatsappPushName"[\s\S]*?END AS "whatsappPushName"/);
  assert.match(conversations, /whatsappPushName: conversation\.whatsappPushName/);
  assert.match(inbox, /whatsappPushName: selectedConversationRecord\.whatsappPushName/);
  assert.match(inboxTypes, /whatsappPushName: string \| null/);
  assert.match(inboxDetails, /className="inbox-contact-profile-whatsapp-name"[\s\S]*?~\{whatsappPushName}/);
  assert.match(inboxDetails, /selectedConversation\.isGroup \|\|[\s\S]*?!whatsappPushName/);
  assert.doesNotMatch(cloudWebhookRoute, /whatsappPushName|pushname/i);
  assert.doesNotMatch(cloudIngestion, /whatsappPushName|pushname/i);
});
