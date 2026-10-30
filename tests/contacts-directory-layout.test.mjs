import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const source = readFileSync(join(process.cwd(), "components", "contacts-directory.tsx"), "utf8");
const contacts = readFileSync(join(process.cwd(), "lib", "contacts.ts"), "utf8");

test("contacts directory uses the required semantic desktop column order", () => {
  assert.match(source, /Search contacts, phone, tag, or owner\.\.\./);
  assert.match(source, /<table className="contacts-directory-table">/);
  assert.match(source, /<th scope="col">Contact<\/th><th scope="col">Status<\/th><th scope="col">Owner<\/th><th scope="col">Channel<\/th><th scope="col">Last message<\/th><th scope="col">Last activity<\/th><th scope="col" className="contacts-directory-actions-heading">Actions<\/th>/);
  assert.match(source, /<td><ContactIdentity contact=\{contact\} \/><\/td>[\s\S]*?<td>\{contact\.isHotLead[\s\S]*?<td>\{contact\.ownerName[\s\S]*?<td><span className="table-subtle">—<\/span><\/td>[\s\S]*?<td><p className="contacts-message-preview"[\s\S]*?<td><time className="contacts-activity-time">\{contact\.lastInteractionAt\}<\/time><\/td>[\s\S]*?<td className="contacts-directory-actions-cell"><ContactActionsMenu/);
  assert.match(source, /formatContactPhone\(contact\.phone\)/);
});

test("contacts actions, missing-value labels, and mobile cards remain available", () => {
  assert.match(contacts, /"No messages yet"/);
  assert.match(source, /"No phone number"/);
  assert.match(source, /aria-label=\{`Actions for \$\{contactName\}`\}/);
  assert.match(source, /contacts-directory-mobile-card/);
  assert.match(source, /pagination\.totalPages > 1/);
});

test("Add note opens a composer beside the selected contact", () => {
  assert.match(source, /function renderNoteComposer|const renderNoteComposer/);
  assert.match(source, /contacts-note-composer-row/);
  assert.match(source, /openComposerId === contact\.id \? <tr className="contacts-note-composer-row"/);
  assert.match(source, /openComposerId === contact\.id \? renderNoteComposer\(contact\.id\)/);
});
