import { ConversationStatus, MessageDirection } from "@prisma/client";
import { getConversationDetail, listConversations } from "@/lib/conversations";
import { prisma } from "@/lib/prisma";
import { requireCurrentAgent, requireCurrentWorkspaceId } from "@/lib/auth/current-user";
import {
  getWhatsAppProviderMode,
  getWorkspaceWhatsAppChannelStatus,
  isWhatsAppMockModeEnabled
} from "@/lib/whatsapp-channel";

const statusLabels: Record<ConversationStatus, string> = {
  OPEN: "Open",
  PENDING: "Pending",
  CLOSED: "Closed"
};

export async function getInboxData(selectedConversationId?: string) {
  const currentAgent = await requireCurrentAgent();
  const workspaceId = await requireCurrentWorkspaceId();
  const whatsAppChannel = await getWorkspaceWhatsAppChannelStatus(workspaceId);
  const isMockMode = isWhatsAppMockModeEnabled();
  const appUrl = process.env.APP_URL?.replace(/\/$/, "") ?? "http://localhost:3000";
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
      quickReplies: {
        orderBy: {
          title: "asc"
        }
      },
      conversations: true
    }
  });

  if (!workspace) {
    throw new Error("No workspace found. Run the database seed first.");
  }

  const conversationRecords = await listConversations();
  const selectedConversationRecord =
    (selectedConversationId && (await getConversationDetail(selectedConversationId))) ||
    (conversationRecords[0] ? await getConversationDetail(conversationRecords[0].id) : null);

  return {
    whatsapp: {
      callbackUrl: `${appUrl}/api/webhooks/whatsapp`,
      isConfigured: isMockMode || whatsAppChannel?.connectionStatus === "CONNECTED",
      mode: getWhatsAppProviderMode(),
      phoneNumberId: isMockMode
        ? whatsAppChannel?.phoneNumber ?? "mock-channel"
        : whatsAppChannel?.phoneNumber ?? null,
      updatedAt: whatsAppChannel?.updatedAt ? formatDetailTimestamp(whatsAppChannel.updatedAt) : null
    },
    currentAgent: {
      id: currentAgent.id,
      name: currentAgent.name,
      role: currentAgent.role
    },
    workspaceIndustryType: workspace.industryType,
    summary: {
      open: workspace.conversations.filter((item) => item.status === ConversationStatus.OPEN).length,
      pending: workspace.conversations.filter((item) => item.status === ConversationStatus.PENDING).length,
      unassigned: workspace.conversations.filter((item) => !item.assigneeId).length,
      hotLeads: workspace.conversations.filter((item) => item.isHotLead).length
    },
    conversations: conversationRecords.map((conversation) => ({
      id: conversation.id,
      contactName: conversation.contactName,
      photoUrl: conversation.photoUrl ?? null,
      phone: conversation.phone,
      status: statusLabels[conversation.status],
      snoozedUntil: conversation.snoozedUntil ? formatSnoozeUntil(conversation.snoozedUntil) : null,
      snoozedUntilIso: conversation.snoozedUntil ? conversation.snoozedUntil.toISOString() : null,
      unreadCount: conversation.unreadCount,
      isHotLead: conversation.isHotLead,
      assigneeId: conversation.assignee?.id ?? null,
      assignee: conversation.assignee?.name ?? "Unassigned",
      lastMessagePreview: conversation.lastMessagePreview ?? "No recent messages",
      lastMessageAt: formatListTimestamp(conversation.lastMessageAt),
      lastMessageAtIso: conversation.lastMessageAt.toISOString()
    })),
    selectedConversation: selectedConversationRecord
        ? {
          id: selectedConversationRecord.id,
          contactName: selectedConversationRecord.contactName,
          photoUrl: selectedConversationRecord.photoUrl ?? null,
        lead: selectedConversationRecord.lead
          ? {
              id: selectedConversationRecord.lead.id,
              product: selectedConversationRecord.lead.product
                ? formatProductSummary(selectedConversationRecord.lead.product)
                : null,
              appointments: selectedConversationRecord.lead.appointments.map((appointment) => ({
                id: appointment.id,
                title: appointment.title,
                type: formatAppointmentType(appointment.type),
                startAt: formatDetailTimestamp(appointment.startAt),
                startAtIso: appointment.startAt.toISOString(),
                endAt: formatDetailTimestamp(appointment.endAt),
                endAtIso: appointment.endAt.toISOString(),
                location: appointment.location ?? null,
                note: appointment.note ?? null
              })),
              project: selectedConversationRecord.lead.project,
                stage: formatLeadStage(selectedConversationRecord.lead.stage),
                priority: formatLeadPriority(selectedConversationRecord.lead.priority),
                preferredArea: selectedConversationRecord.lead.preferredArea ?? null,
                budget:
                  typeof selectedConversationRecord.lead.budget === "number"
                    ? formatCurrency(selectedConversationRecord.lead.budget)
                    : null,
                budgetValue: selectedConversationRecord.lead.budget ?? null,
                financingStatus: selectedConversationRecord.lead.financingStatus ?? null,
                nextActionAt: selectedConversationRecord.lead.nextActionAt
                  ? formatDetailTimestamp(selectedConversationRecord.lead.nextActionAt)
                  : null,
                nextActionAtIso: selectedConversationRecord.lead.nextActionAt
                  ? selectedConversationRecord.lead.nextActionAt.toISOString()
                  : null,
                sourceDetail: selectedConversationRecord.lead.sourceDetail ?? null
              }
            : null,
          phone: selectedConversationRecord.phone,
          status: statusLabels[selectedConversationRecord.status],
          snoozedUntil: selectedConversationRecord.snoozedUntil
            ? formatSnoozeUntil(selectedConversationRecord.snoozedUntil)
            : null,
          snoozedUntilIso: selectedConversationRecord.snoozedUntil
            ? selectedConversationRecord.snoozedUntil.toISOString()
            : null,
          assignee: selectedConversationRecord.assignee?.name ?? "Unassigned",
          assigneeId: selectedConversationRecord.assignee?.id ?? null,
          tags: selectedConversationRecord.tags,
          notes: selectedConversationRecord.notes.map((note) => ({
            id: note.id,
            body: note.body,
            author: note.author,
            createdAt: formatDetailTimestamp(note.createdAt),
            createdAtIso: note.createdAt.toISOString()
          })),
          messages: selectedConversationRecord.messages.map((message) => ({
            id: message.id,
            attachmentMimeType: message.attachmentMimeType,
            attachmentName: message.attachmentName,
            attachmentUrl: message.attachmentUrl,
            body: message.body,
            direction:
              message.direction === MessageDirection.INBOUND
                ? ("inbound" as const)
                : ("outbound" as const),
            sender: message.sender,
            sentAt: formatMessageTime(message.sentAt),
            sentAtIso: message.sentAt.toISOString()
          }))
        }
      : null,
    quickReplies: workspace.quickReplies.map((item) => ({
      id: item.id,
      title: item.title,
      shortcut: item.shortcut,
      category: item.category,
      isPinned: item.isPinned,
      body: item.body
    })),
    agents: workspace.agents.map((agent) => ({
      id: agent.id,
      name: agent.name
    }))
  };
}

function formatMessageTime(date: Date) {
  return new Intl.DateTimeFormat("en-MY", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function formatDetailTimestamp(date: Date) {
  return new Intl.DateTimeFormat("en-MY", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function formatListTimestamp(date: Date) {
  return new Intl.DateTimeFormat("en-MY", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function formatSnoozeUntil(date: Date) {
  return `Snoozed until ${formatDetailTimestamp(date)}`;
}

function formatLeadStage(stage: string) {
  return stage
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatLeadPriority(priority: string) {
  const normalized = priority.toLowerCase();
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-MY", {
    style: "currency",
    currency: "MYR",
    maximumFractionDigits: 0
  }).format(value);
}

function formatAppointmentType(type: string) {
  return type
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatProductSummary(product: {
  id: string;
  name: string;
  description: string | null;
  area: string | null;
  location: string | null;
  mapUrl: string | null;
  websiteUrl: string | null;
  financing: string | null;
  financingTags: string | null;
  brochureName: string | null;
  brochureUrl: string | null;
  priceMin: number | null;
  priceMax: number | null;
  imageUrls: string | null;
  latitude: number | null;
  longitude: number | null;
}) {
  const images = parseImageUrls(product.imageUrls);
  return {
    id: product.id,
    name: product.name,
    description: product.description,
    area: product.area,
    location: product.location,
    mapUrl: product.mapUrl,
    websiteUrl: product.websiteUrl,
    financing: product.financing,
    financingTags: parseImageUrls(product.financingTags),
    brochureName: product.brochureName,
    brochureUrl: product.brochureUrl,
    priceMin: product.priceMin,
    priceMax: product.priceMax,
    imageUrls: images,
    latitude: product.latitude,
    longitude: product.longitude
  };
}

function parseImageUrls(value: string | null) {
  if (!value) {
    return [] as string[];
  }

  try {
    const payload = JSON.parse(value) as string[];
    return payload.filter((item) => typeof item === "string" && item.trim().length > 0);
  } catch {
    return [];
  }
}
