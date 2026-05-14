import { ConversationAuditEventType } from "@prisma/client";
import { requireCurrentAgent, requireCurrentWorkspaceId } from "@/lib/auth/current-user";
import { applyHumanTakeoverPause } from "@/lib/automation-engine";
import { expireStaleConversationWorkflowIfNeeded } from "@/lib/automation-workflow-timeouts";
import { AppointmentStatus, ConversationStatus, LeadActivityType, LeadPriority, LeadStage, MessageDirection } from "@/lib/db-types";
import {
  createConversationNoteRecord,
  createOutboundMessageRecord,
  findConversationContactPhone,
  findConversationForWorkspace,
  findConversationHeader,
  listConversationMessages,
  listConversationNotes,
  listConversationRows,
  listConversationTeammatesByWorkspace,
  setConversationTeammates,
  updateConversationRecord,
  updateConversationTagsRecord
} from "@/lib/db-conversations";
import { findPropertyLeadConversation, upsertPropertyLeadForConversationRecord } from "@/lib/db-leads";
import { getLeadCustomString, parseLeadCustomData } from "@/lib/lead-custom-fields";
import { prisma } from "@/lib/prisma";
import { deleteWhatsAppMessageForEveryone } from "@/lib/whatsapp-runtime";

export async function listConversations() {
  const workspaceId = await requireCurrentWorkspaceId();
  const [conversations, teammateRows] = await Promise.all([
    listConversationRows(workspaceId),
    listConversationTeammatesByWorkspace(workspaceId)
  ]);
  const teammatesByConversationId = new Map<string, Array<{ id: string; name: string }>>();

  for (const teammate of teammateRows) {
    const existing = teammatesByConversationId.get(teammate.conversationId) ?? [];
    existing.push({
      id: teammate.agentId,
      name: teammate.agentName
    });
    teammatesByConversationId.set(teammate.conversationId, existing);
  }

  return conversations.map((conversation) => ({
    id: conversation.id,
    contactName: conversation.contactName,
    photoUrl: conversation.photoUrl,
    phone: conversation.phone,
    isGroup: conversation.isGroup,
    status: conversation.status,
    snoozedUntil: conversation.snoozedUntil,
    unreadCount: conversation.unreadCount,
    assignee: conversation.assigneeId
      ? {
          id: conversation.assigneeId,
          name: conversation.assigneeName ?? "Unknown"
        }
      : null,
    teammates: teammatesByConversationId.get(conversation.id) ?? [],
    isHotLead: conversation.isHotLead,
    lastMessagePreview: conversation.lastMessagePreview,
    lastMessageAt: conversation.lastMessageAt
  }));
}

export async function getConversationDetail(conversationId: string) {
  const workspaceId = await requireCurrentWorkspaceId();
  const [conversation, messages, notes, auditEvents, lead, teammateRows, automationState] = await Promise.all([
    findConversationHeader(conversationId, workspaceId),
    listConversationMessages(conversationId),
    listConversationNotes(conversationId),
    prisma.conversationAuditEvent.findMany({
      where: {
        conversationId,
        workspaceId
      },
      orderBy: {
        createdAt: "asc"
      },
      include: {
        actor: {
          select: {
            name: true
          }
        },
        fromAssignee: {
          select: {
            name: true
          }
        },
        toAssignee: {
          select: {
            name: true
          }
        }
      }
    }),
    prisma.lead.findFirst({
      where: {
        contact: {
          conversations: {
            some: {
              id: conversationId,
              workspaceId
            }
          }
        }
      },
      include: {
        product: true,
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
      }
    }),
    listConversationTeammatesByWorkspace(workspaceId),
    prisma.conversationAutomationState.findUnique({
      where: {
        conversationId
      },
      select: {
        automationPausedUntil: true,
        activeFlowKey: true,
        activeFlowStep: true,
        lastAutoReplyAt: true,
        lastMatchedRuleId: true
      }
    })
  ]);

  if (!conversation) {
    return null;
  }

  const teammates = teammateRows
    .filter((teammate) => teammate.conversationId === conversation.id)
    .map((teammate) => ({
      id: teammate.agentId,
      name: teammate.agentName
    }));

  const messageProviderIds = messages
    .map((message) => message.providerMessageId?.trim() ?? "")
    .filter(Boolean);
  const messageProviderLookupIds = Array.from(
    new Set(
      messageProviderIds
        .flatMap((providerMessageId) => [providerMessageId, getWhatsAppMessageShortId(providerMessageId)])
        .filter(Boolean)
    )
  );

  const reactionEnvelopes = await prisma.whatsAppMessageEnvelope.findMany({
    where: {
      workspaceId,
      messageType: "reaction",
      OR: [
        {
          conversationId
        },
        ...(messageProviderLookupIds.length
          ? [
              {
                quotedMessageId: {
                  in: messageProviderLookupIds
                }
              }
            ]
          : [])
      ]
    },
    orderBy: {
      messageTimestamp: "asc"
    },
    select: {
      id: true,
      quotedMessageId: true,
      body: true,
      fromMe: true,
      from: true,
      messageTimestamp: true
    }
  });

  const reactionsByProviderMessageId = new Map<
    string,
    Array<{
      id: string;
      emoji: string;
      senderId: string | null;
      sender: string;
      sentAt: Date;
    }>
  >();

  for (const envelope of reactionEnvelopes) {
    const targetProviderMessageId = resolveStoredProviderMessageId(
      envelope.quotedMessageId?.trim() ?? "",
      messageProviderIds
    );
    const emoji = envelope.body?.trim() ?? "";
    if (!targetProviderMessageId || !emoji) {
      continue;
    }

    const existing = reactionsByProviderMessageId.get(targetProviderMessageId) ?? [];
    existing.push({
      id: envelope.id,
      emoji,
      senderId: envelope.from?.trim() || null,
      sender: envelope.fromMe ? "You" : envelope.from?.trim() || "Contact",
      sentAt: envelope.messageTimestamp ?? new Date()
    });
    reactionsByProviderMessageId.set(targetProviderMessageId, existing);
  }

  const leadCustomData = lead ? parseLeadCustomData(lead.customData) : {};
  const effectiveAutomationState = await expireStaleConversationWorkflowIfNeeded({
    workspaceId,
    conversationId,
    state: automationState
  });

  const matchedRule =
    effectiveAutomationState?.lastMatchedRuleId
      ? await prisma.automationRule.findFirst({
          where: {
            id: effectiveAutomationState.lastMatchedRuleId,
            workspaceId
          },
          select: {
            name: true
          }
        })
      : null;

  return {
    id: conversation.id,
    contactName: conversation.contactName,
    photoUrl: conversation.photoUrl,
    lead: lead
      ? {
          id: lead.id,
          product: lead.product,
          appointments: lead.appointments,
          project: getLeadCustomString(leadCustomData, "project") ?? lead.project,
          stage: lead.stage,
          priority: lead.priority,
          preferredArea: getLeadCustomString(leadCustomData, "preferredArea") ?? lead.preferredArea,
          budget: getLeadCustomString(leadCustomData, "budget") ?? (lead.budget === null ? null : `${lead.budget}`),
          budgetValue: lead.value ?? lead.budget,
          financingStatus: getLeadCustomString(leadCustomData, "financingStatus") ?? lead.financingStatus,
          nextActionAt: lead.nextActionAt,
          sourceDetail: lead.sourceDetail,
          customData: leadCustomData
        }
      : null,
    phone: conversation.phone,
    isGroup: conversation.isGroup,
    status: conversation.status,
    snoozedUntil: conversation.snoozedUntil,
    assignee: conversation.assigneeId
      ? {
          id: conversation.assigneeId,
          name: conversation.assigneeName ?? "Unknown"
        }
      : null,
    teammates,
    tags: splitTags(conversation.tags),
    notes: notes.map((note) => ({
      id: note.id,
      body: note.body,
      author: note.author,
      createdAt: note.createdAt
    })),
    auditEvents: auditEvents.map((event) => ({
      id: event.id,
      type: event.type,
      actor: event.actor.name,
      fromAssignee: event.fromAssignee?.name ?? null,
      toAssignee: event.toAssignee?.name ?? null,
      createdAt: event.createdAt
    })),
    automation: effectiveAutomationState
      ? {
          automationPausedUntil: effectiveAutomationState.automationPausedUntil,
          activeFlowKey: effectiveAutomationState.activeFlowKey,
          activeFlowStep: effectiveAutomationState.activeFlowStep,
          lastAutoReplyAt: effectiveAutomationState.lastAutoReplyAt,
          lastMatchedRuleName: matchedRule?.name ?? null
        }
      : null,
    messages: messages.map((message) => ({
      id: message.id,
      attachmentMimeType: message.attachmentMimeType,
      attachmentName: message.attachmentName,
      attachmentUrl: message.attachmentUrl,
      body: message.body,
      deletedAt: message.deletedAt,
      direction: message.direction,
      isConnexaOutbound: message.isConnexaOutbound,
      outboundJobAvailableAt: message.outboundJobAvailableAt,
      outboundJobLastError: message.outboundJobLastError,
      outboundJobStatus: message.outboundJobStatus,
      providerMessageId: message.providerMessageId,
      rawPayload: message.rawPayload,
      whatsAppEnvelopeMentionedIdsJson: message.whatsAppEnvelopeMentionedIdsJson,
      whatsAppEnvelopeGroupMentionsJson: message.whatsAppEnvelopeGroupMentionsJson,
      whatsAppEnvelopeRawJson: message.whatsAppEnvelopeRawJson,
      replyToMessageId: message.replyToMessageId,
      replyToMessage:
        message.replyToMessageId
          ? {
              id: message.replyToMessageId,
              body: message.replyToBody,
              attachmentName: message.replyToAttachmentName,
              sender: message.replyToSender
            }
          : null,
      reactions: message.providerMessageId ? reactionsByProviderMessageId.get(message.providerMessageId) ?? [] : [],
      sender: message.sender,
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
    priority: LeadPriority;
    project: string;
    sourceDetail?: string | null;
    stage: LeadStage;
  }
) {
  const workspaceId = await requireCurrentWorkspaceId();
  const conversation = await findPropertyLeadConversation(conversationId, workspaceId);

  if (!conversation) {
    throw new Error("Conversation not found.");
  }

  const project = input.project.trim();
  if (!project) {
    throw new Error("Lead title is required.");
  }

  const lead = await upsertPropertyLeadForConversationRecord(conversation, {
    workspaceId,
    budget: input.budget ?? null,
    financingStatus: input.financingStatus?.trim() || null,
    nextActionAt: input.nextActionAt ?? null,
    preferredArea: input.preferredArea?.trim() || null,
    priority: input.priority,
    project,
    sourceDetail: input.sourceDetail?.trim() || null,
    stage: input.stage
  });

  if (!conversation.existingLeadId && lead && typeof lead === "object" && "id" in lead && typeof lead.id === "string") {
    await prisma.leadActivity.create({
      data: {
        workspaceId,
        leadId: lead.id,
        createdById: conversation.assigneeId ?? null,
        type: LeadActivityType.LEAD_CREATED,
        title: "Lead created",
        description: "Created from inbox conversation"
      }
    });
  }

  return lead;
}

export async function updateConversation(
  conversationId: string,
  updates: {
    status?: ConversationStatus;
    assigneeId?: string | null;
    teammateIds?: string[];
    snoozedUntil?: Date | null;
    unreadCount?: number;
  }
) {
  const agent = await requireCurrentAgent();
  const workspaceId = agent.workspaceId;
  const conversation = await findConversationForWorkspace(conversationId, workspaceId);

  if (!conversation) {
    throw new Error("Conversation not found.");
  }

  const updatedConversation = await updateConversationRecord(conversation.id, {
    status: updates.status,
    assigneeId: updates.assigneeId,
    snoozedUntil: updates.snoozedUntil,
    unreadCount: updates.unreadCount
  });

  if (updates.teammateIds !== undefined) {
    const effectiveAssigneeId = updates.assigneeId !== undefined ? updates.assigneeId : conversation.assigneeId;
    await setConversationTeammates(
      conversation.id,
      updates.teammateIds.filter((teammateId) => teammateId !== effectiveAssigneeId)
    );
  }

  if (updates.assigneeId !== undefined && updates.assigneeId !== conversation.assigneeId) {
    await prisma.conversationAuditEvent.create({
      data: {
        workspaceId,
        conversationId: conversation.id,
        actorId: agent.id,
        type: resolveConversationAuditEventType({
          actorId: agent.id,
          fromAssigneeId: conversation.assigneeId,
          toAssigneeId: updates.assigneeId ?? null
        }),
        fromAssigneeId: conversation.assigneeId,
        toAssigneeId: updates.assigneeId ?? null
      }
    });
  }

  return updatedConversation;
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

  const conversation = await findConversationForWorkspace(conversationId, workspaceId);

  if (!conversation) {
    throw new Error("Conversation not found.");
  }

  await updateConversationTagsRecord(conversation.contactId, normalizedTags.join(", "));

  return normalizedTags;
}

export async function deleteConversation(conversationId: string) {
  const workspaceId = await requireCurrentWorkspaceId();
  return deleteConversationForWorkspace(workspaceId, conversationId);
}

export async function deleteConversationForWorkspace(workspaceId: string, conversationId: string) {
  const conversation = await findConversationForWorkspace(conversationId, workspaceId);

  if (!conversation) {
    throw new Error("Conversation not found.");
  }

  await prisma.conversation.delete({
    where: {
      id: conversation.id
    }
  });

  const remainingConversationCount = await prisma.conversation.count({
    where: {
      workspaceId,
      contactId: conversation.contactId
    }
  });

  if (remainingConversationCount === 0) {
    try {
      await prisma.contact.delete({
        where: {
          id: conversation.contactId
        }
      });
    } catch {
      // Leaving an unreferenced contact is acceptable for test cleanup; the inbox entry is already gone.
    }
  }

  return { id: conversation.id };
}

export async function createOutboundMessage(input: {
  conversationId: string;
  body: string;
  attachmentMimeType?: string | null;
  attachmentName?: string | null;
  attachmentUrl?: string | null;
  providerMessageId?: string | null;
  replyToMessageId?: string | null;
}) {
  const agent = await requireCurrentAgent();
  const workspaceId = agent.workspaceId;
  const normalizedBody = input.body.trim();
  if (!normalizedBody && !input.attachmentUrl) {
    throw new Error("Message body or attachment is required.");
  }

  const conversation = await findConversationContactPhone(input.conversationId, workspaceId);

  if (!conversation) {
    throw new Error("Conversation not found.");
  }

  const previewText =
    normalizedBody ||
    (input.attachmentName ? `Attachment: ${input.attachmentName}` : "Attachment sent");

  const message = await createOutboundMessageRecord({
    conversationId: input.conversationId,
    senderId: agent.id,
    providerMessageId: input.providerMessageId ?? null,
    replyToMessageId: input.replyToMessageId ?? null,
    direction: MessageDirection.OUTBOUND,
    body: normalizedBody,
    attachmentMimeType: input.attachmentMimeType ?? null,
    attachmentName: input.attachmentName ?? null,
    attachmentUrl: input.attachmentUrl ?? null,
    previewText,
    contactId: conversation.contactId
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
    sender: message?.sender ?? "Team",
    sentAt: message?.sentAt ?? new Date()
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

  const conversation = await findConversationForWorkspace(input.conversationId, workspaceId);

  if (!conversation) {
    throw new Error("Conversation not found.");
  }

  const note = await createConversationNoteRecord({
    workspaceId,
    contactId: conversation.contactId,
    conversationId: conversation.id,
    authorId: agent.id,
    body: normalizedBody
  });

  return {
    id: note.id,
    body: note.body,
    author: note.author,
    createdAt: note.createdAt
  };
}

function resolveConversationAuditEventType(input: {
  actorId: string;
  fromAssigneeId: string | null;
  toAssigneeId: string | null;
}) {
  if (!input.toAssigneeId) {
    return ConversationAuditEventType.RELEASED;
  }

  if (!input.fromAssigneeId) {
    return ConversationAuditEventType.ASSIGNED;
  }

  if (input.toAssigneeId === input.actorId && input.fromAssigneeId !== input.actorId) {
    return ConversationAuditEventType.TAKEN_OVER;
  }

  return ConversationAuditEventType.REASSIGNED;
}

export async function deleteConversationMessage(conversationId: string, messageId: string) {
  const workspaceId = await requireCurrentWorkspaceId();
  const conversation = await findConversationForWorkspace(conversationId, workspaceId);

  if (!conversation) {
    throw new Error("Conversation not found.");
  }

  const message = await prisma.message.findFirst({
    where: {
      id: messageId,
      conversationId: conversation.id
    },
    select: {
      id: true,
      sentAt: true,
      deletedAt: true
      ,
      direction: true,
      providerMessageId: true
    }
  });

  if (!message) {
    throw new Error("Message not found.");
  }

  if (message.deletedAt) {
    return { id: message.id };
  }

  if (message.direction !== "OUTBOUND") {
    throw new Error("Only outbound messages sent from Connexa can be deleted for everyone.");
  }

  if (!message.providerMessageId) {
    throw new Error("This message cannot be deleted for everyone.");
  }

  const outboundJob = await prisma.outboundMessageJob.findFirst({
    where: {
      messageId: message.id
    },
    select: {
      id: true
    }
  });

  if (!outboundJob) {
    throw new Error("Only messages sent via Connexa can be deleted for everyone.");
  }

  await deleteWhatsAppMessageForEveryone({
    workspaceId,
    providerMessageId: message.providerMessageId
  });

  await prisma.$transaction(async (tx) => {
    await tx.message.update({
      where: {
        id: message.id
      },
      data: {
        body: "",
        attachmentMimeType: null,
        attachmentName: null,
        attachmentUrl: null,
        deletedAt: new Date()
      }
    });

    const latestVisibleMessage = await tx.message.findFirst({
      where: {
        conversationId: conversation.id,
        deletedAt: null
      },
      orderBy: {
        sentAt: "desc"
      },
      select: {
        sentAt: true,
        body: true,
        attachmentName: true
      }
    });

    await tx.conversation.update({
      where: {
        id: conversation.id
      },
      data: {
        lastMessagePreview: latestVisibleMessage
          ? latestVisibleMessage.body.trim() ||
            (latestVisibleMessage.attachmentName ? `Attachment: ${latestVisibleMessage.attachmentName}` : "Attachment sent")
          : "No recent messages",
        lastMessageAt: latestVisibleMessage?.sentAt ?? message.sentAt
      }
    });
  });

  return { id: message.id };
}

function splitTags(tags: string) {
  return tags
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function resolveStoredProviderMessageId(value: string, providerMessageIds: string[]) {
  if (!value) {
    return null;
  }

  if (providerMessageIds.includes(value)) {
    return value;
  }

  return providerMessageIds.find((providerMessageId) => getWhatsAppMessageShortId(providerMessageId) === value) ?? null;
}

function getWhatsAppMessageShortId(providerMessageId: string) {
  const parts = providerMessageId.trim().split("_");
  return parts.length >= 3 ? parts[2] : providerMessageId.trim();
}
