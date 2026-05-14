import { MessageDirection, OutboundMessageJobStatus } from "@prisma/client";
import { requireCurrentWorkspaceId } from "@/lib/auth/current-user";
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
  attachmentName: string | null;
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

type MessageLogRecord = Awaited<
  ReturnType<
    typeof prisma.message.findMany<{
      include: {
        sender: {
          select: {
            name: true;
          };
        };
        conversation: {
          select: {
            id: true;
            contact: {
              select: {
                displayName: true;
                phone: true;
              };
            };
          };
        };
        outboundJob: {
          select: {
            status: true;
            lastError: true;
            availableAt: true;
          };
        };
      };
    }>
  >
>[number];

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

  const [counts, messages] = await Promise.all([
    getMessageLogCounts(workspaceId, scopedConversationId),
    prisma.message.findMany({
      where,
      orderBy: {
        sentAt: "desc"
      },
      skip,
      take: pageSize,
      include: {
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
            lastError: true,
            availableAt: true
          }
        }
      }
    })
  ]);

  const rows = messages.map((message) => mapMessageLogRow(message));

  return {
    filter,
    conversationId: scopedConversationId,
    rows,
    summary: counts,
    pagination: {
      total,
      page,
      pageSize,
      totalPages,
      pageCount: rows.length
    }
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
    attachmentName: message.attachmentName,
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
