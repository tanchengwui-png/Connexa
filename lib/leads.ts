import {
  IndustryType,
  LeadActivityType,
  LeadNextActionType,
  LeadPriority,
  LeadSource,
  LeadStage,
  type Prisma
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { MALAYSIA_TIME_ZONE } from "@/lib/malaysia-time";
import { requireCurrentAgent, requireCurrentWorkspaceId } from "@/lib/auth/current-user";
import {
  getLeadCustomString,
  parseLeadCustomData,
  stringifyLeadCustomData
} from "@/lib/lead-custom-fields";

type LeadWithRelations = Prisma.LeadGetPayload<{
  include: {
    owner: true;
    product: true;
  };
}>;

type LeadRecordInput = {
  actorId?: string | null;
  name?: string;
  phone?: string;
  source?: LeadSource;
  sourceDetail?: string | null;
  stage?: LeadStage;
  pipelineId?: string | null;
  pipelineStageKey?: string | null;
  priority?: LeadPriority;
  value?: number | null;
  currency?: string | null;
  note?: string | null;
  nextActionAt?: Date | null;
  nextActionType?: LeadNextActionType | null;
  nextActionNote?: string | null;
  ownerId?: string | null;
  lostReason?: string | null;
  customData?: string | Record<string, unknown> | null;
  productId?: string | null;
  // Deprecated compatibility inputs. These are merged into customData.
  budget?: number | null;
  financingStatus?: string | null;
  preferredArea?: string | null;
  project?: string;
  siteVisitAt?: Date | string | null;
  industryType?: IndustryType | string | null;
};

export async function getLeadRecord(leadId: string) {
  const workspaceId = await requireCurrentWorkspaceId();
  return prisma.lead.findFirst({
    where: {
      id: leadId,
      workspaceId
    },
    include: {
      contact: true,
      owner: true,
      product: true,
      activities: {
        include: {
          createdBy: {
            select: {
              name: true
            }
          }
        },
        orderBy: {
          createdAt: "desc"
        },
        take: 25
      }
    }
  });
}

export async function updateLeadRecord(leadId: string, input: LeadRecordInput) {
  const workspaceId = await requireCurrentWorkspaceId();
  const lead = await prisma.lead.findFirst({
    where: {
      id: leadId,
      workspaceId
    }
  });

  if (!lead) {
    throw new Error("Lead not found.");
  }

  if (input.ownerId) {
    const owner = await prisma.agent.findFirst({
      where: {
        id: input.ownerId,
        workspaceId
      },
      select: {
        id: true
      }
    });

    if (!owner) {
      throw new Error("Lead owner not found.");
    }
  }

  const customData = mergeLeadCustomData(lead.customData, input);
  const stage = input.stage ?? lead.stage;
  const pipelineStageKey =
    normalizeOptionalString(input.pipelineStageKey) ?? lead.pipelineStageKey ?? mapLeadStageToPipelineKey(stage);
  const name = input.name?.trim() || lead.name;
  const phone = input.phone?.trim() || lead.phone;
  const source = input.source ?? lead.source;
  const currency = normalizeCurrency(input.currency ?? lead.currency);
  const data = {
      name,
      phone,
      source,
      stage,
      pipelineId: input.pipelineId !== undefined ? normalizeOptionalString(input.pipelineId) : lead.pipelineId,
      pipelineStageKey,
      priority: input.priority ?? lead.priority,
      ownerId: input.ownerId !== undefined ? input.ownerId : lead.ownerId,
      value: input.value !== undefined ? input.value : lead.value,
      currency,
      note: input.note !== undefined ? normalizeOptionalString(input.note) : lead.note,
      nextActionAt: input.nextActionAt !== undefined ? input.nextActionAt : lead.nextActionAt,
      nextActionType: input.nextActionType !== undefined ? input.nextActionType : lead.nextActionType,
      nextActionNote: input.nextActionNote !== undefined ? normalizeOptionalString(input.nextActionNote) : lead.nextActionNote,
      sourceDetail: input.sourceDetail !== undefined ? normalizeOptionalString(input.sourceDetail) : lead.sourceDetail,
      lostReason: input.lostReason !== undefined ? normalizeOptionalString(input.lostReason) : lead.lostReason,
      customData: stringifyLeadCustomData(customData),
      // Deprecated columns are mirrored for compatibility only.
      project: getLeadCustomString(customData, "project") ?? lead.project,
      preferredArea: getLeadCustomString(customData, "preferredArea"),
      budget: normalizeOptionalInteger(customData.budget),
      financingStatus: getLeadCustomString(customData, "financingStatus"),
      siteVisitAt: parseOptionalDate(customData.siteVisitAt),
      industryType: normalizeIndustryType(getLeadCustomString(customData, "industryType")) ?? lead.industryType,
      productId: input.productId !== undefined ? input.productId : lead.productId,
      lastActivityAt: new Date()
    };
  const activities = buildLeadActivities({
    before: lead,
    after: data,
    customData,
    actorId: input.actorId ?? null
  });

  return prisma.$transaction(async (tx) => {
    const updatedLead = await tx.lead.update({
      where: {
        id: lead.id
      },
      data,
      include: {
        contact: true,
        owner: true,
        product: true,
        activities: {
          include: {
            createdBy: {
              select: {
                name: true
              }
            }
          },
          orderBy: {
            createdAt: "desc"
          },
          take: 25
        }
      }
    });

    if (activities.length) {
      await tx.leadActivity.createMany({
        data: activities.map((activity) => ({
          workspaceId,
          leadId: lead.id,
          createdById: input.actorId ?? null,
          ...activity
        }))
      });
    }

    return updatedLead;
  });
}

export async function getLeadsWorkspaceData() {
  const currentAgent = await requireCurrentAgent();
  const workspaceId = currentAgent.workspaceId;
  const workspace = await prisma.workspace.findUnique({
    where: {
      id: workspaceId
    },
    include: {
      agents: {
        orderBy: {
          name: "asc"
        }
      },
      leads: {
        include: {
          owner: true,
          product: true
        },
        orderBy: [
          {
            lastActivityAt: "desc"
          }
        ]
      }
    }
  });

  if (!workspace) {
    throw new Error("No workspace found. Run the database seed first.");
  }

  return {
    agents: workspace.agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      role: agent.role
    })),
    currentAgent: {
      id: currentAgent.id,
      name: currentAgent.name
    },
    leads: workspace.leads.map(formatLeadSummary)
  };
}

export async function createPropertyLeadDraftForConversation(conversationId: string) {
  const workspaceId = await requireCurrentWorkspaceId();
  const conversation = await prisma.conversation.findFirst({
    where: {
      id: conversationId,
      workspaceId
    },
    include: {
      contact: {
        include: {
          leads: {
            orderBy: {
              lastActivityAt: "desc"
            },
            take: 1
          }
        }
      }
    }
  });

  if (!conversation) {
    throw new Error("Conversation not found.");
  }

  const existingLead = conversation.contact.leads[0];
  if (existingLead) {
    return existingLead;
  }

  return prisma.$transaction(async (tx) => {
    const lead = await tx.lead.create({
      data: {
        workspaceId,
        contactId: conversation.contactId,
        ownerId: conversation.assigneeId ?? null,
        industryType: IndustryType.PROPERTY,
        name: conversation.contact.displayName,
        phone: conversation.contact.phone,
        source: LeadSource.WHATSAPP,
        sourceDetail: "Inbox conversation",
        project: "New lead",
        stage: LeadStage.NEW_LEAD,
        pipelineStageKey: mapLeadStageToPipelineKey(LeadStage.NEW_LEAD),
        priority: LeadPriority.MEDIUM,
        currency: "MYR",
        nextActionType: LeadNextActionType.FOLLOW_UP,
        lastActivityAt: new Date(),
        customData: JSON.stringify({ imageUrls: [], industryType: "PROPERTY" })
      }
    });

    await tx.leadActivity.create({
      data: {
        workspaceId,
        leadId: lead.id,
        createdById: conversation.assigneeId ?? null,
        type: LeadActivityType.LEAD_CREATED,
        title: "Lead created",
        description: "Created from inbox conversation"
      }
    });

    return lead;
  });
}

function normalizeOptionalString(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function formatStageLabel(stage: LeadStage) {
  const labels: Record<LeadStage, string> = {
    NEW_LEAD: "New lead",
    CONTACTED: "Contacted",
    QUALIFIED: "Qualified",
    FOLLOW_UP: "Follow-up",
    NEGOTIATION: "Negotiation",
    CLOSED_WON: "Closed won",
    CLOSED_LOST: "Closed lost",
    SITE_VISIT_BOOKED: "Site visit booked"
  };

  return labels[stage];
}

function formatPriorityLabel(priority: LeadPriority) {
  const labels: Record<LeadPriority, string> = {
    LOW: "Low",
    MEDIUM: "Medium",
    HIGH: "High",
    URGENT: "Urgent"
  };

  return labels[priority];
}

function formatSourceLabel(source: LeadSource) {
  const labels: Record<LeadSource, string> = {
    WHATSAPP: "WhatsApp",
    META_ADS: "Meta ads",
    WEBSITE: "Website",
    QR_CODE: "QR code",
    REFERRAL: "Referral",
    MANUAL: "Manual",
    IMPORT: "Import",
    MARKETPLACE: "Marketplace",
    OTHER: "Other",
    PROPERTY_PORTAL: "Property portal",
    WEBSITE_CHAT: "Website chat",
    REFERRAL_QR: "Referral QR"
  };

  return labels[source];
}

function formatRelativeAge(date: Date) {
  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.max(1, Math.round(diffMs / (1000 * 60)));

  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }

  return `${Math.round(diffHours / 24)}d ago`;
}

function formatUpcomingAction(date: Date) {
  const diffMs = date.getTime() - Date.now();
  const diffMinutes = Math.round(diffMs / (1000 * 60));

  if (diffMinutes < 0) {
    const overdueMinutes = Math.abs(diffMinutes);
    if (overdueMinutes < 60) {
      return `Overdue ${overdueMinutes}m`;
    }

    return `Overdue ${Math.round(overdueMinutes / 60)}h`;
  }

  if (diffMinutes < 60) {
    return `Due in ${Math.max(1, diffMinutes)}m`;
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) {
    return `Due in ${diffHours}h`;
  }

  return `Due ${new Intl.DateTimeFormat("en-MY", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: MALAYSIA_TIME_ZONE
  }).format(date)}`;
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

function formatLeadSummary(lead: LeadWithRelations) {
  const customData = parseLeadCustomData(lead.customData);
  const project = getLeadCustomString(customData, "project") ?? lead.project ?? "Lead opportunity";
  const preferredArea = getLeadCustomString(customData, "preferredArea") ?? lead.preferredArea;
  const budget = getLeadCustomString(customData, "budget") ?? (lead.budget === null ? null : `${lead.budget}`);
  const financingStatus = getLeadCustomString(customData, "financingStatus") ?? lead.financingStatus;

  return {
    id: lead.id,
    name: lead.name,
    phone: lead.phone,
    title: project,
    stage: lead.stage,
    pipelineId: lead.pipelineId,
    pipelineStageKey: lead.pipelineStageKey,
    stageLabel: formatStageLabel(lead.stage),
    priority: lead.priority,
    priorityLabel: formatPriorityLabel(lead.priority),
    ownerId: lead.ownerId,
    ownerName: lead.owner?.name ?? null,
    source: lead.source,
    sourceDetail: lead.sourceDetail ?? formatSourceLabel(lead.source),
    value: lead.value,
    currency: lead.currency,
    note: lead.note,
    nextActionAtIso: lead.nextActionAt?.toISOString() ?? null,
    nextActionType: lead.nextActionType,
    nextActionNote: lead.nextActionNote,
    nextActionLabel: lead.nextActionAt ? formatUpcomingAction(lead.nextActionAt) : "No next action set",
    lastActivityLabel: formatRelativeAge(lead.lastActivityAt),
    productName: lead.product?.name ?? null,
    customData,
    customSummary: [preferredArea, financingStatus, budget].filter(Boolean).join(" - "),
    signal: lead.note ?? lead.lastMessage ?? "No recent activity logged yet.",
    // Deprecated compatibility properties for existing UI surfaces.
    project,
    preferredArea,
    budget,
    financingStatus
  };
}

function mergeLeadCustomData(existing: string | null, input: LeadRecordInput) {
  const current = parseLeadCustomData(existing);
  const incoming =
    typeof input.customData === "string"
      ? parseLeadCustomData(input.customData)
      : input.customData && typeof input.customData === "object"
        ? input.customData
        : {};
  const merged = {
    ...current,
    ...incoming
  };

  setCustomString(merged, "project", input.project);
  setCustomString(merged, "preferredArea", input.preferredArea);
  setCustomString(merged, "financingStatus", input.financingStatus);
  setCustomString(merged, "industryType", input.industryType);

  if (input.budget !== undefined) {
    merged.budget = input.budget === null ? null : String(input.budget);
  }

  if (input.siteVisitAt !== undefined) {
    const siteVisitAt = parseOptionalDate(input.siteVisitAt);
    merged.siteVisitAt = siteVisitAt ? siteVisitAt.toISOString() : null;
  }

  return merged;
}

function setCustomString(target: Record<string, unknown>, key: string, value?: string | null) {
  if (value === undefined) {
    return;
  }

  target[key] = normalizeOptionalString(value);
}

function normalizeOptionalInteger(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const normalized = Number(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(normalized) ? Math.round(normalized) : null;
}

function normalizeCurrency(value?: string | null) {
  const normalized = value?.trim().toUpperCase();
  return normalized || "MYR";
}

function normalizeIndustryType(value?: string | null) {
  if (!value) {
    return null;
  }

  return Object.values(IndustryType).includes(value as IndustryType) ? (value as IndustryType) : null;
}

function parseOptionalDate(value: unknown) {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function buildLeadActivities(input: {
  before: {
    stage: LeadStage;
    ownerId: string | null;
    nextActionAt: Date | null;
    nextActionType: LeadNextActionType | null;
    nextActionNote: string | null;
    note: string | null;
    value: number | null;
    currency: string;
    customData: string | null;
  };
  after: {
    stage: LeadStage;
    ownerId: string | null;
    nextActionAt: Date | null;
    nextActionType: LeadNextActionType | null;
    nextActionNote: string | null;
    note: string | null;
    value: number | null;
    currency: string;
    customData: string | null;
  };
  customData: Record<string, unknown>;
  actorId: string | null;
}) {
  const activities: Array<{
    type: LeadActivityType;
    title: string;
    description?: string | null;
    metadata?: string | null;
  }> = [];

  if (input.before.stage !== input.after.stage) {
    activities.push({
      type: LeadActivityType.STAGE_CHANGED,
      title: "Stage changed",
      description: `${formatStageLabel(input.before.stage)} to ${formatStageLabel(input.after.stage)}`,
      metadata: JSON.stringify({ from: input.before.stage, to: input.after.stage })
    });
  }

  if (input.before.ownerId !== input.after.ownerId) {
    activities.push({
      type: LeadActivityType.OWNER_CHANGED,
      title: "Owner changed",
      description: input.after.ownerId ? "Lead owner was assigned." : "Lead owner was cleared.",
      metadata: JSON.stringify({ from: input.before.ownerId, to: input.after.ownerId })
    });
  }

  const nextActionChanged =
    !sameDate(input.before.nextActionAt, input.after.nextActionAt) ||
    input.before.nextActionType !== input.after.nextActionType ||
    input.before.nextActionNote !== input.after.nextActionNote;
  if (nextActionChanged) {
    activities.push({
      type: LeadActivityType.NEXT_ACTION_UPDATED,
      title: "Next action updated",
      description: input.after.nextActionType ? formatNextActionType(input.after.nextActionType) : "Next action cleared",
      metadata: JSON.stringify({
        type: input.after.nextActionType,
        at: input.after.nextActionAt?.toISOString() ?? null,
        note: input.after.nextActionNote
      })
    });
  }

  if ((input.before.note ?? "") !== (input.after.note ?? "")) {
    activities.push({
      type: LeadActivityType.NOTE_UPDATED,
      title: "Note updated",
      description: input.after.note ? "Lead note was updated." : "Lead note was cleared."
    });
  }

  if (input.before.value !== input.after.value || input.before.currency !== input.after.currency) {
    activities.push({
      type: LeadActivityType.VALUE_UPDATED,
      title: "Value updated",
      description: input.after.value === null ? "Estimated deal value cleared." : `${input.after.currency} ${input.after.value.toLocaleString("en-MY")}`,
      metadata: JSON.stringify({
        from: input.before.value,
        to: input.after.value,
        currency: input.after.currency
      })
    });
  }

  if ((input.before.customData ?? "") !== (input.after.customData ?? "")) {
    activities.push({
      type: LeadActivityType.CUSTOM_FIELD_UPDATED,
      title: "Custom fields updated",
      description: "Template fields were updated.",
      metadata: JSON.stringify(input.customData)
    });
  }

  return activities;
}

function sameDate(left: Date | null, right: Date | null) {
  return (left?.getTime() ?? null) === (right?.getTime() ?? null);
}

function formatNextActionType(type: LeadNextActionType) {
  const labels: Record<LeadNextActionType, string> = {
    CALL_CUSTOMER: "Call customer",
    SEND_QUOTATION: "Send quotation",
    FOLLOW_UP: "Follow-up",
    BOOK_APPOINTMENT: "Book appointment",
    SEND_PAYMENT_LINK: "Send payment link",
    CUSTOM: "Custom"
  };

  return labels[type];
}
