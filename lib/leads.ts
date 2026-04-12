import { IndustryType, LeadPriority, LeadSource, LeadStage } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireCurrentWorkspaceId } from "@/lib/auth/current-user";

type LeadRecordInput = {
  budget?: number | null;
  customData?: string | null;
  financingStatus?: string | null;
  nextActionAt?: Date | null;
  ownerId?: string | null;
  preferredArea?: string | null;
  priority?: LeadPriority;
  project?: string;
  sourceDetail?: string | null;
  stage?: LeadStage;
  productId?: string | null;
};

export async function getLeadRecord(leadId: string) {
  const workspaceId = await requireCurrentWorkspaceId();
  return prisma.lead.findFirst({
    where: {
      id: leadId,
      workspaceId,
      industryType: IndustryType.PROPERTY
    },
    include: {
      contact: true,
      owner: true,
      product: true
    }
  });
}

export async function updateLeadRecord(leadId: string, input: LeadRecordInput) {
  const workspaceId = await requireCurrentWorkspaceId();
  const lead = await prisma.lead.findFirst({
    where: {
      id: leadId,
      workspaceId,
      industryType: IndustryType.PROPERTY
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

  const project = input.project?.trim() ?? lead.project;
  if (!project) {
    throw new Error("Project is required.");
  }

  return prisma.lead.update({
    where: {
      id: lead.id
    },
    data: {
      project,
      stage: input.stage ?? lead.stage,
      pipelineStageKey: mapLeadStageToPipelineKey(input.stage ?? lead.stage),
      priority: input.priority ?? lead.priority,
      ownerId: input.ownerId !== undefined ? input.ownerId : lead.ownerId,
      preferredArea: normalizeOptionalString(input.preferredArea),
      budget: input.budget ?? null,
      financingStatus: normalizeOptionalString(input.financingStatus),
      nextActionAt: input.nextActionAt ?? null,
      sourceDetail: normalizeOptionalString(input.sourceDetail),
      productId: input.productId ?? null,
      customData: normalizeOptionalString(input.customData),
      lastActivityAt: new Date()
    },
    include: {
      contact: true,
      owner: true,
      product: true
    }
  });
}

export async function getLeadsWorkspaceData() {
  const workspaceId = await requireCurrentWorkspaceId();
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
        where: {
          industryType: IndustryType.PROPERTY
        },
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
    leads: workspace.leads.map((lead) => ({
      id: lead.id,
      name: lead.name,
      phone: lead.phone,
      project: lead.project,
      stage: lead.stage,
      stageLabel: formatStageLabel(lead.stage),
      priority: lead.priority,
      priorityLabel: formatPriorityLabel(lead.priority),
      ownerId: lead.ownerId,
      ownerName: lead.owner?.name ?? null,
      preferredArea: lead.preferredArea,
      budget: lead.budget,
      financingStatus: lead.financingStatus,
      sourceDetail: lead.sourceDetail ?? formatSourceLabel(lead.source),
      nextActionAtIso: lead.nextActionAt?.toISOString() ?? null,
      nextActionLabel: lead.nextActionAt ? formatUpcomingAction(lead.nextActionAt) : "No next action set",
      lastActivityLabel: formatRelativeAge(lead.lastActivityAt),
      productName: lead.product?.name ?? null,
      signal: lead.note ?? lead.lastMessage ?? "No recent activity logged yet."
    }))
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
            where: {
              industryType: IndustryType.PROPERTY
            },
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

  return prisma.lead.create({
    data: {
      workspaceId,
      contactId: conversation.contactId,
      ownerId: conversation.assigneeId ?? null,
      industryType: IndustryType.PROPERTY,
      name: conversation.contact.displayName,
      phone: conversation.contact.phone,
      source: LeadSource.WEBSITE_CHAT,
      sourceDetail: "Created from inbox conversation",
      project: "New property record",
      stage: LeadStage.NEW_LEAD,
      pipelineStageKey: mapLeadStageToPipelineKey(LeadStage.NEW_LEAD),
      priority: LeadPriority.MEDIUM,
      lastActivityAt: new Date(),
      customData: JSON.stringify({ imageUrls: [] })
    }
  });
}

function normalizeOptionalString(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function formatStageLabel(stage: LeadStage) {
  const labels: Record<LeadStage, string> = {
    NEW_LEAD: "New lead",
    QUALIFIED: "Qualified",
    SITE_VISIT_BOOKED: "Site visit booked",
    FOLLOW_UP: "Follow-up",
    NEGOTIATION: "Negotiation",
    CLOSED_WON: "Closed won",
    CLOSED_LOST: "Closed lost"
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
    META_ADS: "Meta ads",
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
    hour12: false
  }).format(date)}`;
}

function mapLeadStageToPipelineKey(stage: LeadStage) {
  const mapping = {
    NEW_LEAD: "new_lead",
    QUALIFIED: "qualified",
    SITE_VISIT_BOOKED: "viewing_booked",
    FOLLOW_UP: "follow_up",
    NEGOTIATION: "negotiation",
    CLOSED_WON: "closed_won",
    CLOSED_LOST: "closed_lost"
  } as const;

  return mapping[stage];
}
