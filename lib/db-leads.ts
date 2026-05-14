import { queryOne } from "@/lib/db";
import { IndustryType, LeadPriority, LeadSource, LeadStage } from "@/lib/db-types";

export type PropertyLeadConversationRow = {
  conversationId: string;
  contactId: string;
  assigneeId: string | null;
  displayName: string;
  phone: string;
  existingLeadId: string | null;
  existingLeadSource: LeadSource | null;
};

export async function findPropertyLeadConversation(conversationId: string, workspaceId: string) {
  return queryOne<PropertyLeadConversationRow>(
    `SELECT
       conv.id AS "conversationId",
       conv."contactId" AS "contactId",
       conv."assigneeId" AS "assigneeId",
       c."displayName" AS "displayName",
       c.phone,
       lead.id AS "existingLeadId",
       lead.source AS "existingLeadSource"
     FROM "Conversation" conv
     JOIN "Contact" c ON c.id = conv."contactId"
     LEFT JOIN LATERAL (
       SELECT id, source
       FROM "Lead"
       WHERE "contactId" = c.id
       ORDER BY "lastActivityAt" DESC
       LIMIT 1
     ) lead ON TRUE
     WHERE conv.id = $1 AND conv."workspaceId" = $2
     LIMIT 1`,
    [conversationId, workspaceId, IndustryType.PROPERTY]
  );
}

export async function upsertPropertyLeadForConversationRecord(
  row: PropertyLeadConversationRow,
  input: {
    workspaceId: string;
    budget?: number | null;
    financingStatus?: string | null;
    nextActionAt?: Date | null;
    preferredArea?: string | null;
    priority: LeadPriority;
    project: string;
    sourceDetail?: string | null;
    stage: LeadStage;
  }
) {
  const values = [
    input.workspaceId,
    row.contactId,
    row.assigneeId,
    row.displayName,
    row.phone,
    row.existingLeadSource ?? LeadSource.WHATSAPP,
    input.sourceDetail,
    input.project,
    input.stage,
    mapLeadStageToPipelineKey(input.stage),
    IndustryType.PROPERTY,
    input.priority,
    input.budget ?? null,
    input.preferredArea,
    input.financingStatus,
    input.nextActionAt ?? null,
    JSON.stringify({
      project: input.project,
      budget: input.budget === null || input.budget === undefined ? null : String(input.budget),
      preferredArea: input.preferredArea ?? null,
      financingStatus: input.financingStatus ?? null,
      industryType: IndustryType.PROPERTY
    })
  ];

  if (row.existingLeadId) {
    return queryOne(
      `UPDATE "Lead"
       SET "workspaceId" = $1,
           "contactId" = $2,
           "ownerId" = $3,
           name = $4,
           phone = $5,
           source = $6,
           "sourceDetail" = $7,
           project = $8,
           stage = $9,
           "pipelineStageKey" = $10,
           "industryType" = $11,
           priority = $12,
           budget = $13,
           "preferredArea" = $14,
           "financingStatus" = $15,
           "nextActionAt" = $16,
           value = COALESCE(value, $13),
           currency = COALESCE(currency, 'MYR'),
           "customData" = $17,
           "lastActivityAt" = NOW(),
           "updatedAt" = NOW()
       WHERE id = $18
       RETURNING *`,
      [...values, row.existingLeadId]
    );
  }

  return queryOne(
    `INSERT INTO "Lead" (
       "workspaceId", "contactId", "ownerId", name, phone, source, "sourceDetail",
       project, stage, "pipelineStageKey", "industryType", priority, budget,
       "preferredArea", "financingStatus", "nextActionAt", value, currency, "customData", "lastActivityAt"
     )
     VALUES (
       $1, $2, $3, $4, $5, $6, $7,
       $8, $9, $10, $11, $12, $13,
       $14, $15, $16, $13, 'MYR', $17, NOW()
     )
     RETURNING *`,
    values
  );
}

function mapLeadStageToPipelineKey(stage: LeadStage) {
  const mapping = {
    NEW_LEAD: "new_lead",
    CONTACTED: "contacted",
    QUALIFIED: "qualified",
    FOLLOW_UP: "follow_up",
    NEGOTIATION: "negotiation",
    CLOSED_WON: "closed_won",
    CLOSED_LOST: "closed_lost",
    SITE_VISIT_BOOKED: "site_visit_booked"
  } as const;

  return mapping[stage];
}
