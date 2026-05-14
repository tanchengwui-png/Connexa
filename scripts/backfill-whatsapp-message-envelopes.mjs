import { randomUUID } from "node:crypto";
import pg from "pg";

const { Client } = pg;

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required.");
}

const client = new Client({ connectionString: databaseUrl });

function parseJson(value) {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function stringValue(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function booleanValue(value) {
  return typeof value === "boolean" ? value : null;
}

function numberValue(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringArray(value) {
  return Array.isArray(value)
    ? value.filter((entry) => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean)
    : [];
}

function groupMentionIds(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (typeof entry === "string") {
        return entry;
      }

      if (!entry || typeof entry !== "object") {
        return null;
      }

      return (
        stringValue(entry.id) ??
        stringValue(entry.jid) ??
        stringValue(entry.mentionId) ??
        stringValue(entry.participant)
      );
    })
    .filter(Boolean);
}

function mentionTokensFromBody(body) {
  return (stringValue(body)?.match(/@[\dA-Za-z._-]+/g) ?? [])
    .map((match) => match.slice(1).trim())
    .filter(Boolean)
    .map((value) => (/^\d+$/.test(value) ? `${value}@lid` : value));
}

function unique(values) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function parseProviderMessageId(providerMessageId) {
  const [fromMePart, remoteId, , authorId] = String(providerMessageId ?? "").split("_");
  return {
    fromMe: fromMePart === "true" ? true : fromMePart === "false" ? false : null,
    remoteId: remoteId?.includes("@") ? remoteId : null,
    authorId: authorId?.includes("@") ? authorId : null
  };
}

function phoneNumberFromWid(value) {
  const normalized = stringValue(value);
  if (!normalized?.endsWith("@c.us")) {
    return null;
  }

  const phone = normalized.slice(0, -"@c.us".length).replace(/[^\d]/g, "");
  return phone || null;
}

function deriveEnvelopeIdentity(providerMessageId, raw) {
  const parsed = parseProviderMessageId(providerMessageId);
  const chatId = stringValue(raw.chatId) ?? stringValue(raw.remote) ?? stringValue(raw.id?.remote) ?? parsed.remoteId;
  const fromMe = booleanValue(raw.fromMe) ?? parsed.fromMe ?? false;
  const author = stringValue(raw.author) ?? parsed.authorId;
  const isGroup = chatId ? chatId.endsWith("@g.us") : null;
  const contactId =
    stringValue(raw.contact?.id) ??
    author ??
    (isGroup ? null : stringValue(raw.from) ?? stringValue(raw.to) ?? parsed.remoteId) ??
    null;

  return {
    chatId,
    isGroup,
    fromMe,
    from: stringValue(raw.from) ?? (fromMe ? null : parsed.remoteId),
    to: stringValue(raw.to) ?? (fromMe ? parsed.remoteId : null),
    author,
    contactId,
    contactNumber: stringValue(raw.contact?.number) ?? stringValue(raw.number) ?? phoneNumberFromWid(contactId)
  };
}

await client.connect();

try {
  const { rows } = await client.query(`
    SELECT
      m.id,
      m."conversationId",
      m."providerMessageId",
      m.direction,
      m.body,
      m."attachmentMimeType",
      m."attachmentName",
      m."attachmentUrl",
      m."rawPayload",
      m."sentAt",
      conv."workspaceId",
      c."displayName" AS "conversationContactName"
    FROM "Message" m
    JOIN "Conversation" conv ON conv.id = m."conversationId"
    LEFT JOIN "Contact" c ON c.id = conv."contactId"
    LEFT JOIN "WhatsAppMessageEnvelope" e
      ON e."messageId" = m.id
      OR e."providerMessageId" = m."providerMessageId"
    WHERE e.id IS NULL
      AND m."providerMessageId" IS NOT NULL
  `);

  let inserted = 0;

  for (const row of rows) {
    const raw = parseJson(row.rawPayload) ?? {};
    const identity = deriveEnvelopeIdentity(row.providerMessageId, raw);
    const mentionedIds = unique([
      ...stringArray(raw.mentionedIds),
      ...stringArray(raw.mentionedJidList),
      ...stringArray(raw.mentionedJids),
      ...groupMentionIds(raw.groupMentions),
      ...mentionTokensFromBody(raw.body ?? row.body)
    ]);
    const timestamp = numberValue(raw.timestamp);
    const contactSnapshot = {
      id: identity.contactId,
      name:
        stringValue(raw.contact?.name) ??
        stringValue(raw.notifyName) ??
        stringValue(raw.name) ??
        (identity.isGroup ? null : stringValue(row.conversationContactName)),
      pushname: stringValue(raw.contact?.pushname) ?? stringValue(raw.pushname) ?? null,
      number: identity.contactNumber
    };
    const chatSnapshot = {
      id: identity.chatId,
      name: stringValue(raw.chatName) ?? stringValue(row.conversationContactName) ?? null,
      isGroup: identity.isGroup
    };

    await client.query(
      `INSERT INTO "WhatsAppMessageEnvelope" (
        id, "workspaceId", "conversationId", "messageId", "providerMessageId",
        "from", "to", "author", ack, "messageTimestamp", "messageType", body,
        "fromMe", "hasMedia", "mentionedIdsJson", "groupMentionsJson", "linksJson",
        "mediaMimeType", "mediaFilename", "mediaCaption", "mediaUrl",
        "contactId", "contactName", "contactPushname", "contactNumber",
        "chatId", "chatName", "chatIsGroup",
        "contactSnapshotJson", "chatSnapshotJson", "rawJson", "updatedAt"
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10, $11, $12,
        $13, $14, $15::jsonb, $16::jsonb, $17::jsonb,
        $18, $19, $20, $21,
        $22, $23, $24, $25,
        $26, $27, $28,
        $29::jsonb, $30::jsonb, $31::jsonb, NOW()
      )
      ON CONFLICT ("providerMessageId") DO NOTHING`,
      [
        randomUUID(),
        row.workspaceId,
        row.conversationId,
        row.id,
        row.providerMessageId,
        identity.from,
        identity.to,
        identity.author,
        numberValue(raw.ack),
        row.sentAt ?? (timestamp ? new Date(timestamp * 1000) : null),
        stringValue(raw.type) ?? stringValue(raw.messageType),
        row.body ?? stringValue(raw.body),
        identity.fromMe ?? row.direction === "OUTBOUND",
        booleanValue(raw.hasMedia) ?? Boolean(row.attachmentUrl),
        JSON.stringify(mentionedIds),
        JSON.stringify(Array.isArray(raw.groupMentions) ? raw.groupMentions : []),
        JSON.stringify(Array.isArray(raw.links) ? raw.links : []),
        row.attachmentMimeType ?? stringValue(raw.mimetype) ?? stringValue(raw.mediaData?.mimetype),
        row.attachmentName ?? stringValue(raw.filename) ?? stringValue(raw.mediaData?.filename),
        stringValue(raw.caption),
        row.attachmentUrl,
        contactSnapshot.id,
        contactSnapshot.name,
        contactSnapshot.pushname,
        contactSnapshot.number,
        chatSnapshot.id,
        chatSnapshot.name,
        chatSnapshot.isGroup,
        JSON.stringify(contactSnapshot),
        JSON.stringify(chatSnapshot),
        JSON.stringify(raw)
      ]
    );
    inserted += 1;
  }

  const existing = await client.query(`
    SELECT
      e.id,
      e."providerMessageId",
      e."rawJson",
      e."contactSnapshotJson",
      e."chatSnapshotJson",
      c."displayName" AS "conversationContactName"
    FROM "WhatsAppMessageEnvelope" e
    LEFT JOIN "Conversation" conv ON conv.id = e."conversationId"
    LEFT JOIN "Contact" c ON c.id = conv."contactId"
    WHERE e."from" IS NULL
       OR e."to" IS NULL
       OR e.author IS NULL
       OR e."contactId" IS NULL
       OR e."contactNumber" IS NULL
       OR e."chatName" IS NULL
       OR e."contactSnapshotJson" IS NULL
       OR e."chatSnapshotJson" IS NULL
  `);
  let updated = 0;

  for (const row of existing.rows) {
    const raw = typeof row.rawJson === "string" ? parseJson(row.rawJson) ?? {} : row.rawJson ?? {};
    const identity = deriveEnvelopeIdentity(row.providerMessageId, raw);
    const contactSnapshot = {
      id: identity.contactId,
      name:
        stringValue(raw.contact?.name) ??
        stringValue(raw.notifyName) ??
        stringValue(raw.name) ??
        (identity.isGroup ? null : stringValue(row.conversationContactName)),
      pushname: stringValue(raw.contact?.pushname) ?? stringValue(raw.pushname) ?? null,
      number: identity.contactNumber
    };
    const chatSnapshot = {
      id: identity.chatId,
      name: stringValue(raw.chatName) ?? stringValue(row.conversationContactName) ?? null,
      isGroup: identity.isGroup
    };

    const result = await client.query(
      `UPDATE "WhatsAppMessageEnvelope"
       SET
         "from" = COALESCE("from", $2),
         "to" = COALESCE("to", $3),
         author = COALESCE(author, $4),
         "contactId" = COALESCE("contactId", $5),
         "contactName" = COALESCE("contactName", $6),
         "contactPushname" = COALESCE("contactPushname", $7),
         "contactNumber" = COALESCE("contactNumber", $8),
         "chatId" = COALESCE("chatId", $9),
         "chatName" = COALESCE("chatName", $10),
         "chatIsGroup" = COALESCE("chatIsGroup", $11),
         "contactSnapshotJson" = CASE
           WHEN "contactSnapshotJson" IS NULL OR "contactSnapshotJson" = '{}'::jsonb
             THEN $12::jsonb
           ELSE "contactSnapshotJson" || jsonb_strip_nulls($12::jsonb)
         END,
         "chatSnapshotJson" = CASE
           WHEN "chatSnapshotJson" IS NULL OR "chatSnapshotJson" = '{}'::jsonb
             THEN $13::jsonb
           ELSE "chatSnapshotJson" || jsonb_strip_nulls($13::jsonb)
         END,
         "updatedAt" = NOW()
       WHERE id = $1`,
      [
        row.id,
        identity.from,
        identity.to,
        identity.author,
        contactSnapshot.id,
        contactSnapshot.name,
        contactSnapshot.pushname,
        contactSnapshot.number,
        chatSnapshot.id,
        chatSnapshot.name,
        chatSnapshot.isGroup,
        JSON.stringify(contactSnapshot),
        JSON.stringify(chatSnapshot)
      ]
    );

    updated += result.rowCount;
  }

  console.log(`Backfilled ${inserted} WhatsApp message envelope rows and repaired ${updated} existing rows.`);
} finally {
  await client.end();
}
