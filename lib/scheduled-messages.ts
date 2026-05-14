import { OutboundMessageJobStatus } from "@prisma/client";
import { requireCurrentWorkspaceId } from "@/lib/auth/current-user";
import { supportsCanceledOutboundMessageJobs } from "@/lib/outbound-message-job-status";
import { prisma } from "@/lib/prisma";

const DISPLAY_TIME_ZONE = "Asia/Kuala_Lumpur";

export type ScheduledMessagesFilter = "all" | "canceled" | "due" | "failed" | "scheduled" | "sent";

export type ConversationScheduledStats = {
  conversationId: string;
  scheduledCount: number;
  nextScheduledAt: Date | null;
};

type ScheduledMessageRow = {
  id: string;
  conversationId: string;
  contactName: string;
  phone: string;
  bodyPreview: string;
  attachmentName: string | null;
  scheduledFor: string;
  scheduledForIso: string;
  createdAt: string;
  createdAtIso: string;
  status: "Canceled" | "Due now" | "Failed" | "Processing" | "Scheduled" | "Sent";
  statusKey: "canceled" | "due" | "failed" | "processing" | "scheduled" | "sent";
  createdBy: string;
  lastError: string | null;
};

export async function getScheduledMessagesData(
  filter: ScheduledMessagesFilter = "scheduled",
  conversationId?: string | null
) {
  const workspaceId = await requireCurrentWorkspaceId();
  const now = new Date();
  const scopedConversationId = conversationId?.trim() || null;
  const supportsCanceled = await supportsCanceledOutboundMessageJobs();

  const [scheduledCount, duePendingCount, runningCount, sentCount, failedCount, canceledCount, jobs] = await Promise.all([
    prisma.outboundMessageJob.count({
      where: {
        workspaceId,
        ...(scopedConversationId ? { conversationId: scopedConversationId } : {}),
        status: OutboundMessageJobStatus.PENDING,
        availableAt: {
          gt: now
        }
      }
    }),
    prisma.outboundMessageJob.count({
      where: {
        workspaceId,
        ...(scopedConversationId ? { conversationId: scopedConversationId } : {}),
        status: OutboundMessageJobStatus.PENDING,
        availableAt: {
          lte: now
        }
      }
    }),
    prisma.outboundMessageJob.count({
      where: {
        workspaceId,
        ...(scopedConversationId ? { conversationId: scopedConversationId } : {}),
        status: OutboundMessageJobStatus.RUNNING
      }
    }),
    prisma.outboundMessageJob.count({
      where: {
        workspaceId,
        ...(scopedConversationId ? { conversationId: scopedConversationId } : {}),
        status: OutboundMessageJobStatus.SENT
      }
    }),
    prisma.outboundMessageJob.count({
      where: {
        workspaceId,
        ...(scopedConversationId ? { conversationId: scopedConversationId } : {}),
        status: OutboundMessageJobStatus.FAILED
      }
    }),
    supportsCanceled
      ? prisma.outboundMessageJob.count({
          where: {
            workspaceId,
            ...(scopedConversationId ? { conversationId: scopedConversationId } : {}),
            status: OutboundMessageJobStatus.CANCELED
          }
        })
      : Promise.resolve(0),
    prisma.outboundMessageJob.findMany({
      where: buildFilterWhere(workspaceId, filter, now, scopedConversationId, supportsCanceled),
      orderBy: buildFilterOrder(filter),
      take: 120,
      select: {
        id: true,
        conversationId: true,
        messageId: true,
        to: true,
        body: true,
        attachmentName: true,
        availableAt: true,
        createdAt: true,
        status: true,
        lastError: true
      }
    })
  ]);

  const conversationIds = Array.from(new Set(jobs.map((job) => job.conversationId)));
  const messageIds = Array.from(new Set(jobs.map((job) => job.messageId)));

  const [conversations, messages] = await Promise.all([
    conversationIds.length
      ? prisma.conversation.findMany({
          where: {
            workspaceId,
            id: {
              in: conversationIds
            }
          },
          select: {
            id: true,
            contact: {
              select: {
                displayName: true,
                phone: true
              }
            }
          }
        })
      : [],
    messageIds.length
      ? prisma.message.findMany({
          where: {
            id: {
              in: messageIds
            }
          },
          select: {
            id: true,
            sender: {
              select: {
                name: true
              }
            }
          }
        })
      : []
  ]);

  const conversationsById = new Map(conversations.map((conversation) => [conversation.id, conversation]));
  const messagesById = new Map(messages.map((message) => [message.id, message]));

  const rows: ScheduledMessageRow[] = jobs.map((job) => {
    const conversation = conversationsById.get(job.conversationId);
    const message = messagesById.get(job.messageId);

    return {
      id: job.id,
      conversationId: job.conversationId,
      contactName: conversation?.contact.displayName?.trim() || "Unknown contact",
      phone: conversation?.contact.phone?.trim() || job.to,
      bodyPreview: buildBodyPreview(job.body, job.attachmentName),
      attachmentName: job.attachmentName ?? null,
      scheduledFor: formatDateTime(job.availableAt),
      scheduledForIso: job.availableAt.toISOString(),
      createdAt: formatDateTime(job.createdAt),
      createdAtIso: job.createdAt.toISOString(),
      status: formatStatus(job.status, job.availableAt, now),
      statusKey: formatStatusKey(job.status, job.availableAt, now),
      createdBy: message?.sender?.name ?? "Automation",
      lastError: job.lastError ?? null
    };
  });

  return {
    filter,
    conversationId: scopedConversationId,
    rows,
    summary: {
      scheduled: scheduledCount,
      due: duePendingCount + runningCount,
      sent: sentCount,
      failed: failedCount,
      canceled: canceledCount,
      total: scheduledCount + duePendingCount + runningCount + sentCount + failedCount + canceledCount
    }
  };
}

export async function getConversationScheduledStats(workspaceId: string) {
  const jobs = await prisma.outboundMessageJob.findMany({
    where: {
      workspaceId,
      status: {
        in: [OutboundMessageJobStatus.PENDING, OutboundMessageJobStatus.RUNNING, OutboundMessageJobStatus.FAILED]
      }
    },
    select: {
      conversationId: true,
      availableAt: true
    }
  });

  const statsByConversationId = new Map<string, ConversationScheduledStats>();

  for (const job of jobs) {
    const current = statsByConversationId.get(job.conversationId) ?? {
      conversationId: job.conversationId,
      scheduledCount: 0,
      nextScheduledAt: null
    };

    current.scheduledCount += 1;
    if (!current.nextScheduledAt || job.availableAt.getTime() < current.nextScheduledAt.getTime()) {
      current.nextScheduledAt = job.availableAt;
    }

    statsByConversationId.set(job.conversationId, current);
  }

  return statsByConversationId;
}

function buildFilterWhere(
  workspaceId: string,
  filter: ScheduledMessagesFilter,
  now: Date,
  conversationId?: string | null,
  supportsCanceled = true
) {
  const baseWhere = {
    workspaceId,
    ...(conversationId ? { conversationId } : {})
  };

  switch (filter) {
    case "scheduled":
      return {
        ...baseWhere,
        status: OutboundMessageJobStatus.PENDING,
        availableAt: {
          gt: now
        }
      };
    case "due":
      return {
        ...baseWhere,
        OR: [
          {
            status: OutboundMessageJobStatus.PENDING,
            availableAt: {
              lte: now
            }
          },
          {
            status: OutboundMessageJobStatus.RUNNING
          }
        ]
      };
    case "sent":
      return {
        ...baseWhere,
        status: OutboundMessageJobStatus.SENT
      };
    case "canceled":
      if (!supportsCanceled) {
        return {
          ...baseWhere,
          id: {
            in: []
          }
        };
      }

      return {
        ...baseWhere,
        status: OutboundMessageJobStatus.CANCELED
      };
    case "failed":
      return {
        ...baseWhere,
        status: OutboundMessageJobStatus.FAILED
      };
    case "all":
    default:
      return baseWhere;
  }
}

function buildFilterOrder(filter: ScheduledMessagesFilter) {
  switch (filter) {
    case "scheduled":
      return [{ availableAt: "asc" as const }, { createdAt: "asc" as const }];
    case "due":
      return [{ availableAt: "asc" as const }, { createdAt: "asc" as const }];
    case "sent":
    case "canceled":
    case "failed":
    case "all":
    default:
      return [{ availableAt: "desc" as const }, { createdAt: "desc" as const }];
  }
}

function buildBodyPreview(body: string, attachmentName: string | null) {
  const normalized = body.trim();
  if (normalized) {
    return normalized;
  }

  if (attachmentName?.trim()) {
    return `Attachment: ${attachmentName.trim()}`;
  }

  return "Queued outbound message";
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

function formatStatus(status: OutboundMessageJobStatus, availableAt: Date, now: Date) {
  if (status === OutboundMessageJobStatus.SENT) {
    return "Sent";
  }

  if (status === OutboundMessageJobStatus.CANCELED) {
    return "Canceled";
  }

  if (status === OutboundMessageJobStatus.FAILED) {
    return "Failed";
  }

  if (status === OutboundMessageJobStatus.RUNNING) {
    return "Processing";
  }

  return availableAt.getTime() > now.getTime() ? "Scheduled" : "Due now";
}

function formatStatusKey(status: OutboundMessageJobStatus, availableAt: Date, now: Date) {
  if (status === OutboundMessageJobStatus.SENT) {
    return "sent";
  }

  if (status === OutboundMessageJobStatus.CANCELED) {
    return "canceled";
  }

  if (status === OutboundMessageJobStatus.FAILED) {
    return "failed";
  }

  if (status === OutboundMessageJobStatus.RUNNING) {
    return "processing";
  }

  return availableAt.getTime() > now.getTime() ? "scheduled" : "due";
}
