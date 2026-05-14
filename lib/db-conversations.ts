import { randomUUID } from "node:crypto";
import { execute, queryMany, queryOne, transaction } from "@/lib/db";
import { prisma } from "@/lib/prisma";

const INBOX_VISIBLE_CONDITION = `COALESCE(c.tags, '') NOT ILIKE '%automation-test%'`;

export type ConversationListRow = {
  id: string;
  contactName: string;
  photoUrl: string | null;
  phone: string;
  isGroup: boolean;
  status: string;
  snoozedUntil: Date | null;
  unreadCount: number;
  assigneeId: string | null;
  assigneeName: string | null;
  isHotLead: boolean;
  lastMessagePreview: string | null;
  lastMessageAt: Date;
};

export type ConversationHeaderRow = {
  id: string;
  workspaceId: string;
  contactId: string;
  contactName: string;
  photoUrl: string | null;
  phone: string;
  isGroup: boolean;
  tags: string;
  status: string;
  snoozedUntil: Date | null;
  assigneeId: string | null;
  assigneeName: string | null;
};

export type ConversationTeammateRow = {
  conversationId: string;
  agentId: string;
  agentName: string;
};

export type ConversationMessageRow = {
  id: string;
  attachmentMimeType: string | null;
  attachmentName: string | null;
  attachmentUrl: string | null;
  body: string;
  deletedAt: Date | null;
  direction: string;
  isConnexaOutbound: boolean;
  outboundJobAvailableAt: Date | null;
  outboundJobLastError: string | null;
  outboundJobStatus: string | null;
  providerMessageId: string | null;
  rawPayload: string | null;
  whatsAppEnvelopeMentionedIdsJson: unknown;
  whatsAppEnvelopeGroupMentionsJson: unknown;
  whatsAppEnvelopeRawJson: unknown;
  replyToAttachmentName: string | null;
  replyToBody: string | null;
  replyToMessageId: string | null;
  replyToSender: string | null;
  sender: string;
  sentAt: Date;
};

export type ConversationNoteRow = {
  id: string;
  body: string;
  author: string;
  createdAt: Date;
};

export type ConversationAvatarRow = {
  photoUrl: string | null;
};

export type InboxWorkspaceSummaryRow = {
  industryType: string;
  openCount: number;
  pendingCount: number;
  unassignedCount: number;
  hotLeadCount: number;
};

export type QuickReplyRow = {
  id: string;
  title: string;
  shortcut: string;
  category: string;
  body: string;
  mediaAssetIdsJson: string | null;
};

export type AgentNameRow = {
  id: string;
  name: string;
};

export async function listConversationRows(workspaceId: string) {
  return queryMany<ConversationListRow>(
    `SELECT
        conv.id,
        c."displayName" AS "contactName",
        c."photoUrl" AS "photoUrl",
        c.phone,
        (conv."whatsAppRemoteId" LIKE '%@g.us') AS "isGroup",
        conv.status,
        conv."snoozedUntil",
        conv."unreadCount",
        a.id AS "assigneeId",
        a.name AS "assigneeName",
        (conv."isHotLead" OR c."isHotLead") AS "isHotLead",
        conv."lastMessagePreview",
        conv."lastMessageAt"
      FROM "Conversation" conv
      JOIN "Contact" c ON c.id = conv."contactId"
      LEFT JOIN "Agent" a ON a.id = conv."assigneeId"
      WHERE conv."workspaceId" = $1
        AND ${INBOX_VISIBLE_CONDITION}
      ORDER BY conv."lastMessageAt" DESC`,
    [workspaceId]
  );
}

export async function findConversationHeader(conversationId: string, workspaceId: string, includeTest = false) {
  return queryOne<ConversationHeaderRow>(
    `SELECT
        conv.id,
        conv."workspaceId",
        conv."contactId",
        c."displayName" AS "contactName",
        c."photoUrl" AS "photoUrl",
        c.phone,
        (conv."whatsAppRemoteId" LIKE '%@g.us') AS "isGroup",
        c.tags,
        conv.status,
        conv."snoozedUntil",
        a.id AS "assigneeId",
        a.name AS "assigneeName"
      FROM "Conversation" conv
      JOIN "Contact" c ON c.id = conv."contactId"
      LEFT JOIN "Agent" a ON a.id = conv."assigneeId"
      WHERE conv.id = $1
        AND conv."workspaceId" = $2
        ${includeTest ? "" : `AND ${INBOX_VISIBLE_CONDITION}`}
      LIMIT 1`,
    [conversationId, workspaceId]
  );
}

export async function listConversationMessages(conversationId: string) {
  return queryMany<ConversationMessageRow>(
    `SELECT
        m.id,
        m."attachmentMimeType",
        m."attachmentName",
        m."attachmentUrl",
        m.body,
        m."deletedAt",
        m.direction,
        ("oj"."id" IS NOT NULL) AS "isConnexaOutbound",
        oj."availableAt" AS "outboundJobAvailableAt",
        oj."lastError" AS "outboundJobLastError",
        oj.status AS "outboundJobStatus",
        m."providerMessageId",
        m."rawPayload",
        we."mentionedIdsJson" AS "whatsAppEnvelopeMentionedIdsJson",
        we."groupMentionsJson" AS "whatsAppEnvelopeGroupMentionsJson",
        we."rawJson" AS "whatsAppEnvelopeRawJson",
        m."replyToMessageId",
        rm.body AS "replyToBody",
        rm."attachmentName" AS "replyToAttachmentName",
        CASE
          WHEN rm.direction = 'OUTBOUND' THEN COALESCE(ra.name, 'Team')
          ELSE c."displayName"
        END AS "replyToSender",
        CASE
          WHEN m.direction = 'OUTBOUND' THEN COALESCE(a.name, 'Team')
          ELSE c."displayName"
        END AS sender,
        m."sentAt"
      FROM "Message" m
      JOIN "Conversation" conv ON conv.id = m."conversationId"
      JOIN "Contact" c ON c.id = conv."contactId"
      LEFT JOIN "Agent" a ON a.id = m."senderId"
      LEFT JOIN "Message" rm ON rm.id = m."replyToMessageId"
      LEFT JOIN "Agent" ra ON ra.id = rm."senderId"
      LEFT JOIN "OutboundMessageJob" oj ON oj."messageId" = m.id
      LEFT JOIN "WhatsAppMessageEnvelope" we ON we."messageId" = m.id OR we."providerMessageId" = m."providerMessageId"
      WHERE m."conversationId" = $1
      ORDER BY m."sentAt" ASC`,
    [conversationId]
  );
}

export async function listConversationTeammatesByWorkspace(workspaceId: string) {
  return queryMany<ConversationTeammateRow>(
    `SELECT
        ct."conversationId",
        ct."agentId",
        a.name AS "agentName"
      FROM "ConversationTeammate" ct
      JOIN "Conversation" conv ON conv.id = ct."conversationId"
      JOIN "Agent" a ON a.id = ct."agentId"
      WHERE conv."workspaceId" = $1
      ORDER BY a."createdAt" ASC, a.name ASC`,
    [workspaceId]
  );
}

export async function listConversationNotes(conversationId: string) {
  return queryMany<ConversationNoteRow>(
    `SELECT
        n.id,
        n.body,
        a.name AS author,
        n."createdAt"
      FROM "Note" n
      JOIN "Agent" a ON a.id = n."authorId"
      WHERE n."conversationId" = $1
      ORDER BY n."createdAt" DESC`,
    [conversationId]
  );
}

export async function findConversationForWorkspace(conversationId: string, workspaceId: string) {
  return queryOne<{ id: string; contactId: string; workspaceId: string; assigneeId: string | null }>(
    `SELECT id, "contactId", "workspaceId", "assigneeId"
     FROM "Conversation"
     WHERE id = $1 AND "workspaceId" = $2
     LIMIT 1`,
    [conversationId, workspaceId]
  );
}

export async function updateConversationRecord(
  conversationId: string,
  updates: {
    status?: string;
    assigneeId?: string | null;
    snoozedUntil?: Date | null;
    unreadCount?: number;
  }
 ) {
  const fields: string[] = [];
  const values: unknown[] = [conversationId];

  if (updates.status !== undefined) {
    values.push(updates.status);
    fields.push(`status = $${values.length}`);
  }

  if (updates.assigneeId !== undefined) {
    values.push(updates.assigneeId);
    fields.push(`"assigneeId" = $${values.length}`);
  }

  if (updates.snoozedUntil !== undefined) {
    values.push(updates.snoozedUntil);
    fields.push(`"snoozedUntil" = $${values.length}`);
  }

  if (updates.unreadCount !== undefined) {
    values.push(updates.unreadCount);
    fields.push(`"unreadCount" = $${values.length}`);
  }

  if (fields.length === 0) {
    return queryOne(`SELECT * FROM "Conversation" WHERE id = $1 LIMIT 1`, [conversationId]);
  }

  return queryOne(
    `UPDATE "Conversation"
     SET ${fields.join(", ")}, "updatedAt" = NOW()
     WHERE id = $1
     RETURNING *`,
    values
  );
}

export async function setConversationTeammates(conversationId: string, teammateIds: string[]) {
  await prisma.conversationTeammate.deleteMany({
    where: {
      conversationId
    }
  });

  if (!teammateIds.length) {
    return;
  }

  await prisma.conversationTeammate.createMany({
    data: teammateIds.map((agentId) => ({
      conversationId,
      agentId
    })),
    skipDuplicates: true
  });
}

export async function updateConversationTagsRecord(contactId: string, tags: string) {
  await execute(`UPDATE "Contact" SET tags = $2, "updatedAt" = NOW() WHERE id = $1`, [contactId, tags]);
}

export async function createConversationNoteRecord(input: {
  workspaceId: string;
  contactId: string;
  conversationId: string;
  authorId: string;
  body: string;
}) {
  const noteId = randomUUID().replace(/-/g, "");
  return queryOne<ConversationNoteRow>(
    `WITH inserted AS (
       INSERT INTO "Note" (id, "workspaceId", "contactId", "conversationId", "authorId", body)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, body, "createdAt", "authorId"
     )
     SELECT i.id, i.body, a.name AS author, i."createdAt"
     FROM inserted i
     JOIN "Agent" a ON a.id = i."authorId"`,
    [noteId, input.workspaceId, input.contactId, input.conversationId, input.authorId, input.body]
  );
}

export async function findConversationAvatar(conversationId: string, workspaceId: string) {
  return queryOne<ConversationAvatarRow>(
    `SELECT c."photoUrl"
     FROM "Conversation" conv
     JOIN "Contact" c ON c.id = conv."contactId"
     WHERE conv.id = $1 AND conv."workspaceId" = $2
     LIMIT 1`,
    [conversationId, workspaceId]
  );
}

export async function getInboxWorkspaceSummary(workspaceId: string) {
  return queryOne<InboxWorkspaceSummaryRow>(
    `SELECT
        w."industryType",
        COUNT(*) FILTER (WHERE conv.status = 'OPEN' AND ${INBOX_VISIBLE_CONDITION})::int AS "openCount",
        COUNT(*) FILTER (WHERE conv.status = 'PENDING' AND ${INBOX_VISIBLE_CONDITION})::int AS "pendingCount",
        COUNT(*) FILTER (WHERE conv."assigneeId" IS NULL AND ${INBOX_VISIBLE_CONDITION})::int AS "unassignedCount",
        COUNT(*) FILTER (WHERE conv."isHotLead" = TRUE AND ${INBOX_VISIBLE_CONDITION})::int AS "hotLeadCount"
      FROM "Workspace" w
      LEFT JOIN "Conversation" conv ON conv."workspaceId" = w.id
      LEFT JOIN "Contact" c ON c.id = conv."contactId"
      WHERE w.id = $1
      GROUP BY w.id`,
    [workspaceId]
  );
}

export async function listQuickReplyRows(workspaceId: string) {
  return queryMany<QuickReplyRow>(
    `SELECT id, title, shortcut, category, body, "mediaAssetIdsJson"
     FROM "QuickReply"
     WHERE "workspaceId" = $1
     ORDER BY category ASC, title ASC`,
    [workspaceId]
  );
}

export async function listAgentNameRows(workspaceId: string) {
  return queryMany<AgentNameRow>(
    `SELECT id, name
     FROM "Agent"
     WHERE "workspaceId" = $1
     ORDER BY name ASC`,
    [workspaceId]
  );
}

export async function findConversationContactPhone(conversationId: string, workspaceId: string) {
  return queryOne<{ workspaceId: string; contactId: string; phone: string }>(
    `SELECT conv."workspaceId", conv."contactId", c.phone
     FROM "Conversation" conv
     JOIN "Contact" c ON c.id = conv."contactId"
     WHERE conv.id = $1 AND conv."workspaceId" = $2
     LIMIT 1`,
    [conversationId, workspaceId]
  );
}

export async function createOutboundMessageRecord(input: {
  conversationId: string;
  senderId: string;
  providerMessageId: string | null;
  replyToMessageId: string | null;
  direction: string;
  body: string;
  attachmentMimeType: string | null;
  attachmentName: string | null;
  attachmentUrl: string | null;
  previewText: string;
  contactId: string;
}) {
  return transaction(async (client) => {
    const message = await queryOne<ConversationMessageRow>(
      `WITH inserted AS (
         INSERT INTO "Message" (
           "conversationId", "senderId", "providerMessageId", "replyToMessageId", direction, body,
           "attachmentMimeType", "attachmentName", "attachmentUrl"
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, "attachmentMimeType", "attachmentName", "attachmentUrl", body, "deletedAt", direction, "providerMessageId", "replyToMessageId", "sentAt", "senderId"
       )
       SELECT
         i.id,
         i."attachmentMimeType",
         i."attachmentName",
         i."attachmentUrl",
         i.body,
         i."deletedAt",
         i.direction,
         i."providerMessageId",
         i."replyToMessageId",
         rm.body AS "replyToBody",
         rm."attachmentName" AS "replyToAttachmentName",
         COALESCE(ra.name, c."displayName") AS "replyToSender",
         a.name AS sender,
         i."sentAt",
         true AS "isConnexaOutbound"
       FROM inserted i
       JOIN "Conversation" conv ON conv.id = i."conversationId"
       JOIN "Contact" c ON c.id = conv."contactId"
       LEFT JOIN "Agent" a ON a.id = i."senderId"
       LEFT JOIN "Message" rm ON rm.id = i."replyToMessageId"
       LEFT JOIN "Agent" ra ON ra.id = rm."senderId"`,
      [
        input.conversationId,
        input.senderId,
        input.providerMessageId,
        input.replyToMessageId,
        input.direction,
        input.body,
        input.attachmentMimeType,
        input.attachmentName,
        input.attachmentUrl
      ],
      client
    );

    await execute(
      `UPDATE "Conversation"
       SET status = 'OPEN',
           "lastMessagePreview" = $2,
           "lastMessageAt" = $3,
           "updatedAt" = NOW()
       WHERE id = $1`,
      [input.conversationId, input.previewText, message?.sentAt ?? new Date()],
      client
    );

    await execute(
      `UPDATE "Contact"
       SET "lastInteractionAt" = $2, "updatedAt" = NOW()
       WHERE id = $1`,
      [input.contactId, message?.sentAt ?? new Date()],
      client
    );

    return message;
  });
}
