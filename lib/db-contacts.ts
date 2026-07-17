import { randomUUID } from "node:crypto";
import { execute, queryMany, queryOne } from "@/lib/db";
import { prisma } from "@/lib/prisma";

type AgentLookupRow = {
  id: string;
  name: string;
  role: string;
  createdAt: Date;
};

type ContactBaseRow = {
  id: string;
  workspaceId: string;
  ownerId: string | null;
  displayName: string;
  syncedDisplayName: string | null;
  displayNameManualOverride: boolean;
  phone: string;
  photoUrl: string | null;
  email: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  emailManualOverride: boolean;
  status: string;
  isHotLead: boolean;
  tags: string;
  syncedTags: string | null;
  tagsManualOverride: boolean;
  lastInteractionAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

type ContactWithOwnerRow = ContactBaseRow & {
  ownerName: string | null;
};

type ContactDirectorySummaryRow = {
  total: string;
  active: string;
  hotLeads: string;
  recentlyActive: string;
};

const CONTACTS_DIRECTORY_VISIBLE_CONDITION = `(
  NOT EXISTS (
    SELECT 1
    FROM "Conversation" conv
    WHERE conv."contactId" = c.id
  )
  OR EXISTS (
    SELECT 1
    FROM "Conversation" conv
    WHERE conv."contactId" = c.id
      AND (
        conv."whatsAppRemoteId" IS NULL
        OR conv."whatsAppRemoteId" NOT LIKE '%@g.us'
      )
  )
)`;

type ContactConversationPreviewRow = {
  contactId: string;
  lastMessagePreview: string | null;
  status: string | null;
};

type ContactNoteRow = {
  id: string;
  contactId: string;
  body: string;
  createdAt: Date;
  authorName: string;
};

export type ContactTeammateRow = {
  contactId: string;
  agentId: string;
  agentName: string;
};

export type ContactExportRow = ContactBaseRow & {
  ownerName: string | null;
  collaborators: string | null;
  remarks: string | null;
  totalReceived: number;
  totalSent: number;
  businessType: string | null;
  customerCount: number;
};

function buildContactDirectorySearchClause(search: string | null | undefined, startIndex: number) {
  const normalized = search?.trim().toLowerCase() ?? "";
  if (!normalized) {
    return {
      clause: "",
      values: [] as unknown[]
    };
  }

  const likeValue = `%${normalized}%`;
  return {
    clause: `
      AND (
        LOWER(c."displayName") LIKE $${startIndex}
        OR LOWER(c.phone) LIKE $${startIndex}
        OR LOWER(c.tags) LIKE $${startIndex}
        OR LOWER(COALESCE(c.email, '')) LIKE $${startIndex}
        OR LOWER(COALESCE(c."addressLine1", '')) LIKE $${startIndex}
        OR LOWER(COALESCE(c."addressLine2", '')) LIKE $${startIndex}
        OR LOWER(COALESCE(c.city, '')) LIKE $${startIndex}
        OR LOWER(COALESCE(c.state, '')) LIKE $${startIndex}
        OR LOWER(COALESCE(c."postalCode", '')) LIKE $${startIndex}
        OR LOWER(COALESCE(c.country, '')) LIKE $${startIndex}
      )
    `,
    values: [likeValue]
  };
}

function buildContactDirectoryFilterClauses(input: {
  search?: string | null;
  tags?: string[];
  ownerIds?: string[];
}, startIndex: number) {
  const clauses: string[] = [];
  const values: unknown[] = [];
  let nextIndex = startIndex;

  const search = buildContactDirectorySearchClause(input.search, nextIndex);
  if (search.clause) {
    clauses.push(search.clause);
    values.push(...search.values);
    nextIndex += search.values.length;
  }

  const normalizedTags = Array.from(new Set((input.tags ?? []).map((value) => value.trim().toLowerCase()).filter(Boolean)));
  if (normalizedTags.length) {
    clauses.push(`
      AND EXISTS (
        SELECT 1
        FROM unnest(regexp_split_to_array(COALESCE(c.tags, ''), '\\s*,\\s*')) AS tag(value)
        WHERE LOWER(tag.value) = ANY($${nextIndex}::text[])
      )
    `);
    values.push(normalizedTags);
    nextIndex += 1;
  }

  const normalizedOwnerIds = Array.from(new Set((input.ownerIds ?? []).map((value) => value.trim()).filter(Boolean)));
  if (normalizedOwnerIds.length) {
    const includeUnassigned = normalizedOwnerIds.includes("unassigned");
    const ownerIds = normalizedOwnerIds.filter((value) => value !== "unassigned");

    if (includeUnassigned && ownerIds.length) {
      clauses.push(`AND (c."ownerId" IS NULL OR c."ownerId" = ANY($${nextIndex}::text[]))`);
      values.push(ownerIds);
      nextIndex += 1;
    } else if (includeUnassigned) {
      clauses.push(`AND c."ownerId" IS NULL`);
    } else {
      clauses.push(`AND c."ownerId" = ANY($${nextIndex}::text[])`);
      values.push(ownerIds);
      nextIndex += 1;
    }
  }

  return {
    clause: clauses.join("\n"),
    values
  };
}

export async function findWorkspaceAgents(workspaceId: string) {
  return queryMany<AgentLookupRow>(
    `SELECT id, name, role, "createdAt"
     FROM "Agent"
     WHERE "workspaceId" = $1
     ORDER BY "createdAt" ASC`,
    [workspaceId]
  );
}

export async function findAgentInWorkspace(agentId: string, workspaceId: string) {
  return queryOne<{ id: string }>(
    `SELECT id FROM "Agent" WHERE id = $1 AND "workspaceId" = $2 LIMIT 1`,
    [agentId, workspaceId]
  );
}

export async function createContactRecord(input: {
  workspaceId: string;
  ownerId: string | null;
  displayName: string;
  email: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  phone: string;
  tags: string;
}) {
  return queryOne<ContactBaseRow>(
    `INSERT INTO "Contact" (
       "workspaceId",
       "ownerId",
       "displayName",
       email,
       "addressLine1",
       "addressLine2",
       city,
       state,
       "postalCode",
       country,
       phone,
       tags
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING *`,
    [
      input.workspaceId,
      input.ownerId,
      input.displayName,
      input.email,
      input.addressLine1,
      input.addressLine2,
      input.city,
      input.state,
      input.postalCode,
      input.country,
      input.phone,
      input.tags
    ]
  );
}

export async function findContactInWorkspace(contactId: string, workspaceId: string) {
  return queryOne<ContactBaseRow>(
    `SELECT * FROM "Contact" WHERE id = $1 AND "workspaceId" = $2 LIMIT 1`,
    [contactId, workspaceId]
  );
}

export async function findContactsWithOwner(input: {
  workspaceId: string;
  search?: string;
  tags?: string[];
  ownerIds?: string[];
  limit: number;
  offset: number;
}) {
  const values: unknown[] = [input.workspaceId];
  const filters = buildContactDirectoryFilterClauses(
    {
      search: input.search,
      tags: input.tags,
      ownerIds: input.ownerIds
    },
    values.length + 1
  );
  values.push(...filters.values, input.limit, input.offset);

  return queryMany<ContactWithOwnerRow>(
    `SELECT
        c.*,
        a.name AS "ownerName"
      FROM "Contact" c
      LEFT JOIN "Agent" a ON a.id = c."ownerId"
      WHERE c."workspaceId" = $1
        AND ${CONTACTS_DIRECTORY_VISIBLE_CONDITION}
        ${filters.clause}
      ORDER BY c."lastInteractionAt" DESC
      LIMIT $${values.length - 1}
      OFFSET $${values.length}`,
    values
  );
}

export async function findAllVisibleContactsWithOwner(input: {
  workspaceId: string;
  search?: string;
  tags?: string[];
  ownerIds?: string[];
}) {
  const values: unknown[] = [input.workspaceId];
  const filters = buildContactDirectoryFilterClauses(
    {
      search: input.search,
      tags: input.tags,
      ownerIds: input.ownerIds
    },
    values.length + 1
  );
  values.push(...filters.values);

  return queryMany<ContactWithOwnerRow>(
    `SELECT
        c.*,
        a.name AS "ownerName"
      FROM "Contact" c
      LEFT JOIN "Agent" a ON a.id = c."ownerId"
      WHERE c."workspaceId" = $1
        AND ${CONTACTS_DIRECTORY_VISIBLE_CONDITION}
        ${filters.clause}
      ORDER BY c."lastInteractionAt" DESC`,
    values
  );
}

export async function findContactsExportBatch(input: {
  workspaceId: string;
  search?: string;
  tags?: string[];
  ownerIds?: string[];
  limit: number;
  offset: number;
}) {
  const values: unknown[] = [input.workspaceId];
  const filters = buildContactDirectoryFilterClauses(
    {
      search: input.search,
      tags: input.tags,
      ownerIds: input.ownerIds
    },
    values.length + 1
  );
  values.push(...filters.values, input.limit, input.offset);

  return queryMany<ContactExportRow>(
    `SELECT
        c.*,
        a.name AS "ownerName",
        collaborators.collaborators,
        remarks.remarks,
        COALESCE(message_stats."totalReceived", 0) AS "totalReceived",
        COALESCE(message_stats."totalSent", 0) AS "totalSent",
        lead_summary."businessType",
        COALESCE(conversation_stats."customerCount", 0) AS "customerCount"
      FROM "Contact" c
      LEFT JOIN "Agent" a ON a.id = c."ownerId"
      LEFT JOIN LATERAL (
        SELECT STRING_AGG(agent.name, ', ' ORDER BY agent."createdAt" ASC, agent.name ASC) AS collaborators
        FROM "ContactTeammate" ct
        JOIN "Agent" agent ON agent.id = ct."agentId"
        WHERE ct."contactId" = c.id
      ) collaborators ON true
      LEFT JOIN LATERAL (
        SELECT n.body AS remarks
        FROM "Note" n
        WHERE n."workspaceId" = c."workspaceId" AND n."contactId" = c.id
        ORDER BY n."createdAt" DESC
        LIMIT 1
      ) remarks ON true
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*) FILTER (WHERE m.direction = 'INBOUND')::int AS "totalReceived",
          COUNT(*) FILTER (WHERE m.direction = 'OUTBOUND')::int AS "totalSent"
        FROM "Conversation" conv
        JOIN "Message" m ON m."conversationId" = conv.id
        WHERE conv."contactId" = c.id
      ) message_stats ON true
      LEFT JOIN LATERAL (
        SELECT l."industryType"::text AS "businessType"
        FROM "Lead" l
        WHERE l."workspaceId" = c."workspaceId" AND l."contactId" = c.id
        ORDER BY l."createdAt" DESC
        LIMIT 1
      ) lead_summary ON true
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS "customerCount"
        FROM "Conversation" conv
        WHERE conv."contactId" = c.id
      ) conversation_stats ON true
      WHERE c."workspaceId" = $1
        AND ${CONTACTS_DIRECTORY_VISIBLE_CONDITION}
        ${filters.clause}
      ORDER BY c."lastInteractionAt" DESC, c.id ASC
      LIMIT $${values.length - 1}
      OFFSET $${values.length}`,
    values
  );
}

export async function findLatestConversationPreviewByWorkspace(workspaceId: string, contactIds: string[]) {
  if (!contactIds.length) {
    return [] as ContactConversationPreviewRow[];
  }

  return queryMany<ContactConversationPreviewRow>(
    `SELECT DISTINCT ON (c.id)
        c.id AS "contactId",
        conv."lastMessagePreview",
        conv.status
      FROM "Contact" c
      LEFT JOIN "Conversation" conv ON conv."contactId" = c.id
      WHERE c.id = ANY($1::text[])
      ORDER BY c.id, conv."lastMessageAt" DESC NULLS LAST`,
    [contactIds]
  );
}

export async function findLatestNotesByWorkspace(workspaceId: string, contactIds: string[]) {
  if (!contactIds.length) {
    return [] as ContactNoteRow[];
  }

  return queryMany<ContactNoteRow>(
    `SELECT *
     FROM (
       SELECT
         n.id,
         n."contactId",
         n.body,
         n."createdAt",
         a.name AS "authorName",
         ROW_NUMBER() OVER (PARTITION BY n."contactId" ORDER BY n."createdAt" DESC) AS rn
       FROM "Note" n
       JOIN "Agent" a ON a.id = n."authorId"
       WHERE n."workspaceId" = $1 AND n."contactId" = ANY($2::text[])
     ) ranked
     WHERE rn <= 2
     ORDER BY "contactId", "createdAt" DESC`,
    [workspaceId, contactIds]
  );
}

export async function listContactTeammatesByWorkspace(workspaceId: string, contactIds: string[]) {
  if (!contactIds.length) {
    return [] as ContactTeammateRow[];
  }

  return queryMany<ContactTeammateRow>(
    `SELECT
        ct."contactId",
        ct."agentId",
        a.name AS "agentName"
      FROM "ContactTeammate" ct
      JOIN "Agent" a ON a.id = ct."agentId"
      WHERE ct."contactId" = ANY($1::text[])
      ORDER BY a."createdAt" ASC, a.name ASC`,
    [contactIds]
  );
}

export async function countVisibleContacts(input: {
  workspaceId: string;
  search?: string;
  tags?: string[];
  ownerIds?: string[];
}) {
  const values: unknown[] = [input.workspaceId];
  const filters = buildContactDirectoryFilterClauses(
    {
      search: input.search,
      tags: input.tags,
      ownerIds: input.ownerIds
    },
    values.length + 1
  );
  values.push(...filters.values);

  const row = await queryOne<{ total: string }>(
    `SELECT COUNT(*)::text AS total
     FROM "Contact" c
     WHERE c."workspaceId" = $1
       AND ${CONTACTS_DIRECTORY_VISIBLE_CONDITION}
       ${filters.clause}`,
    values
  );

  return Number.parseInt(row?.total ?? "0", 10) || 0;
}

export async function getContactDirectorySummary(workspaceId: string) {
  const row = await queryOne<ContactDirectorySummaryRow>(
    `SELECT
       COUNT(*)::text AS total,
       COUNT(*)::text AS active,
       COUNT(*) FILTER (WHERE c."isHotLead")::text AS "hotLeads",
       COUNT(*) FILTER (
         WHERE c."lastInteractionAt" > NOW() - INTERVAL '24 hours'
       )::text AS "recentlyActive"
     FROM "Contact" c
     WHERE c."workspaceId" = $1
       AND ${CONTACTS_DIRECTORY_VISIBLE_CONDITION}`,
    [workspaceId]
  );

  return {
    total: Number.parseInt(row?.total ?? "0", 10) || 0,
    active: Number.parseInt(row?.active ?? "0", 10) || 0,
    hotLeads: Number.parseInt(row?.hotLeads ?? "0", 10) || 0,
    recentlyActive: Number.parseInt(row?.recentlyActive ?? "0", 10) || 0
  };
}

export async function setContactTeammates(contactId: string, teammateIds: string[]) {
  await prisma.contactTeammate.deleteMany({
    where: {
      contactId
    }
  });

  if (!teammateIds.length) {
    return;
  }

  await prisma.contactTeammate.createMany({
    data: teammateIds.map((agentId) => ({
      contactId,
      agentId
    })),
    skipDuplicates: true
  });
}

export async function createContactNoteRecord(input: {
  workspaceId: string;
  contactId: string;
  authorId: string;
  body: string;
}) {
  const noteId = randomUUID().replace(/-/g, "");
  return queryOne<{ id: string; body: string; createdAt: Date; authorName: string }>(
    `WITH inserted AS (
       INSERT INTO "Note" (id, "workspaceId", "contactId", "authorId", body)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, body, "createdAt", "authorId"
     )
     SELECT i.id, i.body, i."createdAt", a.name AS "authorName"
     FROM inserted i
     JOIN "Agent" a ON a.id = i."authorId"`,
    [noteId, input.workspaceId, input.contactId, input.authorId, input.body]
  );
}

export async function updateContactRecord(
  contactId: string,
  data: Record<string, unknown>
) {
  const entries = Object.entries(data);

  if (entries.length === 0) {
    return queryOne<ContactWithOwnerRow>(
      `SELECT c.*, a.name AS "ownerName"
       FROM "Contact" c
       LEFT JOIN "Agent" a ON a.id = c."ownerId"
       WHERE c.id = $1
       LIMIT 1`,
      [contactId]
    );
  }

  const values: unknown[] = [contactId];
  const setters = entries.map(([key, value], index) => {
    values.push(value);
    return `"${key}" = $${index + 2}`;
  });

  return queryOne<ContactWithOwnerRow>(
    `WITH updated AS (
       UPDATE "Contact"
       SET ${setters.join(", ")}, "updatedAt" = NOW()
       WHERE id = $1
       RETURNING *
     )
     SELECT u.*, a.name AS "ownerName"
     FROM updated u
     LEFT JOIN "Agent" a ON a.id = u."ownerId"`,
    values
  );
}
