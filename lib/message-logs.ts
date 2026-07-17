import { requireCurrentWorkspaceId } from "@/lib/auth/current-user";
import { MessageDirection, OutboundMessageJobStatus } from "@/lib/db-types";
import { supportsCanceledOutboundMessageJobs } from "@/lib/outbound-message-job-status";
import { prisma } from "@/lib/prisma";

const DISPLAY_TIME_ZONE = "Asia/Kuala_Lumpur";

export type MessageLogsFilter =
  | "all"
  | "canceled"
  | "failed"
  | "inbound"
  | "outbound"
  | "processing"
  | "queued"
  | "sent";

const DEFAULT_MESSAGE_LOGS_PAGE_SIZE = 25;
const MAX_MESSAGE_LOGS_PAGE_SIZE = 100;

type MessageLogRow = {
  id: string;
  conversationId: string;
  contactName: string;
  phone: string;
  preview: string;
  attachmentMimeType: string | null;
  attachmentName: string | null;
  attachmentUrl: string | null;
  direction: "Inbound" | "Outbound";
  source: "Connexa outbound" | "Inbound" | "Manual outbound";
  status: "Canceled" | "Failed" | "Inbound" | "Processing" | "Queued" | "Sent";
  statusKey: "canceled" | "failed" | "inbound" | "processing" | "queued" | "sent";
  sentAt: string;
  sentAtIso: string;
  createdBy: string;
  providerMessageId: string | null;
  lastError: string | null;
};

async function findMessageLogRecords(input: {
  where: ReturnType<typeof buildMessageLogsWhere>;
  skip: number;
  take: number;
}) {
  return prisma.message.findMany({
    where: input.where,
    orderBy: {
      sentAt: "desc"
    },
    skip: input.skip,
    take: input.take,
    select: {
      id: true,
      conversationId: true,
      body: true,
      attachmentMimeType: true,
      attachmentName: true,
      attachmentUrl: true,
      direction: true,
      sentAt: true,
      providerMessageId: true,
      sender: {
        select: {
          name: true
        }
      },
      conversation: {
        select: {
          id: true,
          contact: {
            select: {
              displayName: true,
              phone: true
            }
          }
        }
      },
      outboundJob: {
        select: {
          status: true,
          lastError: true
        }
      }
    }
  });
}

function buildLinkedWhatsAppNumberWhere(workspaceId: string) {
  return {
    workspaceId,
    OR: [
      {
        phoneNumber: {
          not: null as string | null
        }
      },
      {
        phoneNumberId: {
          not: null as string | null
        }
      },
      {
        sessionClientId: {
          not: null as string | null
        }
      }
    ]
  };
}

type MessageLogRecord = Awaited<ReturnType<typeof findMessageLogRecords>>[number];

export async function getMessageLogsData(input?: {
  filter?: MessageLogsFilter;
  conversationId?: string | null;
  page?: number;
  pageSize?: number;
}) {
  const workspaceId = await requireCurrentWorkspaceId();
  const filter = input?.filter ?? "all";
  const scopedConversationId = input?.conversationId?.trim() || null;
  const pageSize = normalizePositiveInteger(input?.pageSize, DEFAULT_MESSAGE_LOGS_PAGE_SIZE, MAX_MESSAGE_LOGS_PAGE_SIZE);
  const where = buildMessageLogsWhere(workspaceId, filter, scopedConversationId);
  const total = await prisma.message.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(normalizePositiveInteger(input?.page, 1), totalPages);
  const skip = (page - 1) * pageSize;

  const [counts, messages, linkedChannelCount] = await Promise.all([
    getMessageLogCounts(workspaceId, scopedConversationId),
    findMessageLogRecords({
      where,
      skip,
      take: pageSize
    }),
    prisma.whatsAppChannel.count({
      where: buildLinkedWhatsAppNumberWhere(workspaceId)
    })
  ]);

  const rows = messages.map((message: (typeof messages)[number]) => mapMessageLogRow(message));

  return {
    filter,
    conversationId: scopedConversationId,
    rows,
    summary: counts,
    hasLinkedWhatsAppNumbers: linkedChannelCount > 0,
    pagination: {
      total,
      page,
      pageSize,
      totalPages,
      pageCount: rows.length
    }
  };
}

export async function deleteWorkspaceMessageLogs(workspaceId: string) {
  const linkedChannelCount = await prisma.whatsAppChannel.count({
    where: buildLinkedWhatsAppNumberWhere(workspaceId)
  });

  if (linkedChannelCount > 0) {
    throw new Error("Disconnect all linked WhatsApp numbers before deleting message logs.");
  }

  const conversationIds = await prisma.conversation.findMany({
    where: {
      workspaceId
    },
    select: {
      id: true
    }
  });

  const scopedConversationIds = conversationIds.map((conversation) => conversation.id);
  if (!scopedConversationIds.length) {
    return {
      deletedMessageCount: 0
    };
  }

  const result = await prisma.$transaction(async (tx) => {
    const deletedMessages = await tx.message.deleteMany({
      where: {
        conversationId: {
          in: scopedConversationIds
        }
      }
    });

    await tx.conversation.updateMany({
      where: {
        id: {
          in: scopedConversationIds
        }
      },
      data: {
        unreadCount: 0
      }
    });

    return deletedMessages;
  });

  return {
    deletedMessageCount: result.count
  };
}

async function getMessageLogCounts(workspaceId: string, conversationId?: string | null) {
  const supportsCanceled = await supportsCanceledOutboundMessageJobs();
  const baseWhere = {
    conversation: {
      workspaceId,
      ...(conversationId ? { id: conversationId } : {})
    }
  };

  const [total, inbound, outbound, sent, queued, processing, failed, canceled] = await Promise.all([
    prisma.message.count({ where: baseWhere }),
    prisma.message.count({
      where: {
        ...baseWhere,
        direction: MessageDirection.INBOUND
      }
    }),
    prisma.message.count({
      where: {
        ...baseWhere,
        direction: MessageDirection.OUTBOUND
      }
    }),
    prisma.message.count({
      where: {
        ...baseWhere,
        outboundJob: {
          is: {
            status: OutboundMessageJobStatus.SENT
          }
        }
      }
    }),
    prisma.message.count({
      where: {
        ...baseWhere,
        outboundJob: {
          is: {
            status: OutboundMessageJobStatus.PENDING
          }
        }
      }
    }),
    prisma.message.count({
      where: {
        ...baseWhere,
        outboundJob: {
          is: {
            status: OutboundMessageJobStatus.RUNNING
          }
        }
      }
    }),
    prisma.message.count({
      where: {
        ...baseWhere,
        outboundJob: {
          is: {
            status: OutboundMessageJobStatus.FAILED
          }
        }
      }
    }),
    supportsCanceled
      ? prisma.message.count({
          where: {
            ...baseWhere,
            outboundJob: {
              is: {
                status: OutboundMessageJobStatus.CANCELED
              }
            }
          }
        })
      : Promise.resolve(0)
  ]);

  return {
    total,
    inbound,
    outbound,
    sent,
    queued,
    processing,
    failed,
    canceled
  };
}

function mapMessageLogRow(message: MessageLogRecord): MessageLogRow {
  const outboundJob = message.outboundJob;
  const preview = buildPreview(message.body, message.attachmentName);
  const statusKey =
    message.direction === MessageDirection.INBOUND
      ? "inbound"
      : outboundJob?.status === OutboundMessageJobStatus.CANCELED
        ? "canceled"
        : outboundJob?.status === OutboundMessageJobStatus.FAILED
          ? "failed"
          : outboundJob?.status === OutboundMessageJobStatus.RUNNING
            ? "processing"
            : outboundJob?.status === OutboundMessageJobStatus.PENDING
              ? "queued"
              : "sent";

  return {
    id: message.id,
    conversationId: message.conversation.id,
    contactName: message.conversation.contact.displayName,
    phone: message.conversation.contact.phone,
    preview,
    attachmentMimeType: message.attachmentMimeType,
    attachmentName: message.attachmentName,
    attachmentUrl: message.attachmentUrl,
    direction: message.direction === MessageDirection.INBOUND ? "Inbound" : "Outbound",
    source:
      message.direction === MessageDirection.INBOUND
        ? "Inbound"
        : outboundJob
          ? "Connexa outbound"
          : "Manual outbound",
    status:
      statusKey === "inbound"
        ? "Inbound"
        : statusKey === "canceled"
          ? "Canceled"
          : statusKey === "failed"
            ? "Failed"
            : statusKey === "processing"
              ? "Processing"
              : statusKey === "queued"
                ? "Queued"
                : "Sent",
    statusKey,
    sentAt: formatDateTime(message.sentAt),
    sentAtIso: message.sentAt.toISOString(),
    createdBy: message.sender?.name ?? (message.direction === MessageDirection.INBOUND ? "Customer" : "Team"),
    providerMessageId: message.providerMessageId,
    lastError: outboundJob?.lastError ?? null
  };
}

function buildPreview(body: string, attachmentName: string | null) {
  const normalized = body.trim();
  if (normalized) {
    return normalized;
  }

  if (attachmentName?.trim()) {
    return `Attachment: ${attachmentName.trim()}`;
  }

  return "Message event";
}

function formatDateTime(date: Date) {
  return new Intl.DateTimeFormat("en-MY", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: DISPLAY_TIME_ZONE
  }).format(date);
}

function buildMessageLogsWhere(
  workspaceId: string,
  filter: MessageLogsFilter,
  conversationId?: string | null
) {
  const baseWhere = {
    conversation: {
      workspaceId,
      ...(conversationId ? { id: conversationId } : {})
    }
  };

  switch (filter) {
    case "inbound":
      return {
        ...baseWhere,
        direction: MessageDirection.INBOUND
      };
    case "outbound":
      return {
        ...baseWhere,
        direction: MessageDirection.OUTBOUND
      };
    case "sent":
      return {
        ...baseWhere,
        outboundJob: {
          is: {
            status: OutboundMessageJobStatus.SENT
          }
        }
      };
    case "queued":
      return {
        ...baseWhere,
        outboundJob: {
          is: {
            status: OutboundMessageJobStatus.PENDING
          }
        }
      };
    case "processing":
      return {
        ...baseWhere,
        outboundJob: {
          is: {
            status: OutboundMessageJobStatus.RUNNING
          }
        }
      };
    case "failed":
      return {
        ...baseWhere,
        outboundJob: {
          is: {
            status: OutboundMessageJobStatus.FAILED
          }
        }
      };
    case "canceled":
      return {
        ...baseWhere,
        outboundJob: {
          is: {
            status: OutboundMessageJobStatus.CANCELED
          }
        }
      };
    case "all":
    default:
      return baseWhere;
  }
}

function normalizePositiveInteger(value: number | undefined, fallback: number, max?: number) {
  const normalized = Number.isFinite(value) ? Math.trunc(value as number) : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(normalized) || normalized < 1) {
    return fallback;
  }

  if (max && normalized > max) {
    return max;
  }

  return normalized;
}
