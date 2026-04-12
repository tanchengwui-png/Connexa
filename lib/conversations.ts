import { AppointmentStatus, ConversationStatus, IndustryType, MessageDirection } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireCurrentAgent, requireCurrentWorkspaceId } from "@/lib/auth/current-user";
import { applyHumanTakeoverPause } from "@/lib/automation-engine";

export async function listConversations() {
  const workspaceId = await requireCurrentWorkspaceId();
  const workspace = await prisma.workspace.findUnique({
    where: {
      id: workspaceId
    },
    include: {
      conversations: {
        include: {
          assignee: true,
          contact: true
        },
        orderBy: {
          lastMessageAt: "desc"
        }
      }
    }
  });

  if (!workspace) {
    throw new Error("No workspace found. Run the database seed first.");
  }

  return workspace.conversations.map((conversation) => ({
    id: conversation.id,
    contactName: conversation.contact.displayName,
    photoUrl: conversation.contact.photoUrl,
    phone: conversation.contact.phone,
    status: conversation.status,
    snoozedUntil: conversation.snoozedUntil,
    unreadCount: conversation.unreadCount,
    assignee: conversation.assignee
      ? {
          id: conversation.assignee.id,
          name: conversation.assignee.name
        }
      : null,
    isHotLead: conversation.isHotLead || conversation.contact.isHotLead,
    lastMessagePreview: conversation.lastMessagePreview,
    lastMessageAt: conversation.lastMessageAt
  }));
}

export async function getConversationDetail(conversationId: string) {
  const workspaceId = await requireCurrentWorkspaceId();
  const conversation = await prisma.conversation.findFirst({
    where: {
      id: conversationId,
      workspaceId
    },
    include: {
      assignee: true,
      contact: {
        include: {
          leads: {
            where: {
              industryType: IndustryType.PROPERTY
            },
            include: {
              product: true,
              owner: true,
              appointments: {
                where: {
                  status: AppointmentStatus.SCHEDULED
                },
                orderBy: {
                  startAt: "asc"
                },
                take: 5
              }
            },
            orderBy: {
              lastActivityAt: "desc"
            },
            take: 1
          }
        }
      },
      messages: {
        include: {
          sender: true
        },
        orderBy: {
          sentAt: "asc"
        }
      },
      notes: {
        include: {
          author: true
        },
        orderBy: {
          createdAt: "desc"
        }
      }
    }
  });

  if (!conversation) {
    return null;
  }

  return {
    id: conversation.id,
    contactName: conversation.contact.displayName,
    photoUrl: conversation.contact.photoUrl,
    lead: conversation.contact.leads[0]
      ? {
          id: conversation.contact.leads[0].id,
          product: conversation.contact.leads[0].product,
          appointments: conversation.contact.leads[0].appointments,
          project: conversation.contact.leads[0].project,
          stage: conversation.contact.leads[0].stage,
          priority: conversation.contact.leads[0].priority,
          preferredArea: conversation.contact.leads[0].preferredArea,
          budget: conversation.contact.leads[0].budget,
          financingStatus: conversation.contact.leads[0].financingStatus,
          nextActionAt: conversation.contact.leads[0].nextActionAt,
          sourceDetail: conversation.contact.leads[0].sourceDetail
        }
      : null,
    phone: conversation.contact.phone,
    status: conversation.status,
    snoozedUntil: conversation.snoozedUntil,
    assignee: conversation.assignee
      ? {
          id: conversation.assignee.id,
          name: conversation.assignee.name
        }
      : null,
    tags: splitTags(conversation.contact.tags),
    notes: conversation.notes.map((note) => ({
      id: note.id,
      body: note.body,
      author: note.author.name,
      createdAt: note.createdAt
    })),
    messages: conversation.messages.map((message) => ({
      id: message.id,
      attachmentMimeType: message.attachmentMimeType,
      attachmentName: message.attachmentName,
      attachmentUrl: message.attachmentUrl,
      body: message.body,
      direction: message.direction,
      sender: message.sender?.name ?? conversation.contact.displayName,
      sentAt: message.sentAt
    }))
  };
}

export async function upsertPropertyLeadForConversation(
  conversationId: string,
  input: {
    budget?: number | null;
    financingStatus?: string | null;
    nextActionAt?: Date | null;
    preferredArea?: string | null;
    priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
    project: string;
    sourceDetail?: string | null;
    stage:
      | "NEW_LEAD"
      | "QUALIFIED"
      | "SITE_VISIT_BOOKED"
      | "FOLLOW_UP"
      | "NEGOTIATION"
      | "CLOSED_WON"
      | "CLOSED_LOST";
  }
) {
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

  const payload = {
    workspaceId,
    contactId: conversation.contactId,
    ownerId: conversation.assigneeId ?? null,
    name: conversation.contact.displayName,
    phone: conversation.contact.phone,
    source: conversation.contact.leads[0]?.source ?? "WEBSITE_CHAT",
    sourceDetail: input.sourceDetail?.trim() || null,
    project: input.project.trim(),
    stage: input.stage,
    pipelineStageKey: mapLeadStageToPipelineKey(input.stage),
    industryType: IndustryType.PROPERTY,
    priority: input.priority,
    budget: input.budget ?? null,
    preferredArea: input.preferredArea?.trim() || null,
    financingStatus: input.financingStatus?.trim() || null,
    nextActionAt: input.nextActionAt ?? null,
    lastActivityAt: new Date()
  } as const;

  if (!payload.project) {
    throw new Error("Project is required.");
  }

  const existingLead = conversation.contact.leads[0];

  return existingLead
    ? prisma.lead.update({
        where: {
          id: existingLead.id
        },
        data: payload
      })
    : prisma.lead.create({
        data: payload
      });
}

export async function updateConversation(
  conversationId: string,
  updates: {
    status?: ConversationStatus;
    assigneeId?: string | null;
    snoozedUntil?: Date | null;
  }
) {
  const workspaceId = await requireCurrentWorkspaceId();

  const conversation = await prisma.conversation.findFirst({
    where: {
      id: conversationId,
      workspaceId
    },
    select: {
      id: true
    }
  });

  if (!conversation) {
    throw new Error("Conversation not found.");
  }

  return prisma.conversation.update({
    where: {
      id: conversation.id
    },
    data: {
      ...(updates.status ? { status: updates.status } : {}),
      ...(updates.assigneeId !== undefined ? { assigneeId: updates.assigneeId } : {}),
      ...(updates.snoozedUntil !== undefined ? { snoozedUntil: updates.snoozedUntil } : {})
    }
  });
}

export async function updateConversationTags(conversationId: string, tags: string[]) {
  const workspaceId = await requireCurrentWorkspaceId();
  const normalizedTags = Array.from(
    new Set(
      tags
        .map((tag) => tag.trim())
        .filter(Boolean)
    )
  );

  const conversation = await prisma.conversation.findFirst({
    where: {
      id: conversationId,
      workspaceId
    },
    select: {
      id: true,
      contactId: true
    }
  });

  if (!conversation) {
    throw new Error("Conversation not found.");
  }

  await prisma.contact.update({
    where: {
      id: conversation.contactId
    },
    data: {
      tags: normalizedTags.join(", ")
    }
  });

  return normalizedTags;
}

export async function createOutboundMessage(input: {
  conversationId: string;
  body: string;
  attachmentMimeType?: string | null;
  attachmentName?: string | null;
  attachmentUrl?: string | null;
  providerMessageId?: string | null;
}) {
  const agent = await requireCurrentAgent();
  const workspaceId = agent.workspaceId;
  const normalizedBody = input.body.trim();
  if (!normalizedBody && !input.attachmentUrl) {
    throw new Error("Message body or attachment is required.");
  }

  const conversation = await prisma.conversation.findFirst({
    where: {
      id: input.conversationId,
      workspaceId
    },
    include: {
      contact: true
    }
  });

  if (!conversation) {
    throw new Error("Conversation not found.");
  }

  const previewText =
    normalizedBody ||
    (input.attachmentName ? `Attachment: ${input.attachmentName}` : "Attachment sent");

  const message = await prisma.$transaction(async (tx) => {
    const createdMessage = await tx.message.create({
      data: {
        conversationId: input.conversationId,
        senderId: agent.id,
        providerMessageId: input.providerMessageId ?? null,
        direction: MessageDirection.OUTBOUND,
        body: normalizedBody,
        attachmentMimeType: input.attachmentMimeType ?? null,
        attachmentName: input.attachmentName ?? null,
        attachmentUrl: input.attachmentUrl ?? null
      },
      include: {
        sender: true
      }
    });

    await tx.conversation.update({
      where: {
        id: input.conversationId
      },
      data: {
        status: ConversationStatus.OPEN,
        lastMessagePreview: previewText,
        lastMessageAt: createdMessage.sentAt
      }
    });

    await tx.contact.update({
      where: {
        id: conversation.contactId
      },
      data: {
        lastInteractionAt: createdMessage.sentAt
      }
    });

    return createdMessage;
  });

  await applyHumanTakeoverPause({
    workspaceId,
    conversationId: input.conversationId,
    pausedAt: message.sentAt
  });

  return {
    id: message.id,
    attachmentMimeType: message.attachmentMimeType,
    attachmentName: message.attachmentName,
    attachmentUrl: message.attachmentUrl,
    body: message.body,
    direction: message.direction,
    sender: message.sender?.name ?? "Team",
    sentAt: message.sentAt
  };
}

export async function createConversationNote(input: {
  conversationId: string;
  body: string;
}) {
  const agent = await requireCurrentAgent();
  const workspaceId = agent.workspaceId;
  const normalizedBody = input.body.trim();

  if (!normalizedBody) {
    throw new Error("Note body is required.");
  }

  const conversation = await prisma.conversation.findFirst({
    where: {
      id: input.conversationId,
      workspaceId
    },
    select: {
      id: true,
      contactId: true
    }
  });

  if (!conversation) {
    throw new Error("Conversation not found.");
  }

  const note = await prisma.note.create({
    data: {
      workspaceId,
      contactId: conversation.contactId,
      conversationId: conversation.id,
      authorId: agent.id,
      body: normalizedBody
    },
    include: {
      author: true
    }
  });

  return {
    id: note.id,
    body: note.body,
    author: note.author.name,
    createdAt: note.createdAt
  };
}

function splitTags(tags: string) {
  return tags
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function mapLeadStageToPipelineKey(
  stage:
    | "NEW_LEAD"
    | "QUALIFIED"
    | "SITE_VISIT_BOOKED"
    | "FOLLOW_UP"
    | "NEGOTIATION"
    | "CLOSED_WON"
    | "CLOSED_LOST"
) {
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
