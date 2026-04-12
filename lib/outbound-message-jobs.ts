import {
  ConversationStatus,
  MessageDirection,
  OutboundMessageJobStatus
} from "@prisma/client";
import { getMessagingProvider } from "@/lib/messaging/provider";
import { prisma } from "@/lib/prisma";

type EnqueueOutboundMessageInput = {
  workspaceId: string;
  conversationId: string;
  to: string;
  body: string;
  senderId?: string | null;
  source: "manual-reply" | "automation-engine";
  attachmentMimeType?: string | null;
  attachmentName?: string | null;
  attachmentUrl?: string | null;
  interactiveButtons?: string[] | null;
  interactiveListButtonText?: string | null;
  interactiveListOptions?: string[] | null;
};

export async function enqueueOutboundMessage(input: EnqueueOutboundMessageInput) {
  const normalizedBody = input.body.trim();
  const normalizedButtons = normalizeChoices(input.interactiveButtons, 3);
  const normalizedListOptions = normalizeChoices(input.interactiveListOptions, 10);
  const normalizedListButtonText = input.interactiveListButtonText?.trim() || "Choose option";

  if (!normalizedBody && !input.attachmentUrl) {
    throw new Error("Message body or attachment is required.");
  }

  if (input.attachmentUrl && (normalizedButtons.length || normalizedListOptions.length)) {
    throw new Error("Interactive messages cannot include attachments yet.");
  }

  if (normalizedButtons.length && normalizedListOptions.length) {
    throw new Error("Choose either buttons or a list for this reply.");
  }

  const conversation = await prisma.conversation.findFirst({
    where: {
      id: input.conversationId,
      workspaceId: input.workspaceId
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
        conversationId: conversation.id,
        senderId: input.senderId ?? null,
        direction: MessageDirection.OUTBOUND,
        body: buildStoredMessageBody(
          normalizedBody,
          normalizedButtons,
          normalizedListButtonText,
          normalizedListOptions
        ),
        attachmentMimeType: input.attachmentMimeType ?? null,
        attachmentName: input.attachmentName ?? null,
        attachmentUrl: input.attachmentUrl ?? null,
        rawPayload: JSON.stringify({
          source: input.source,
          queuedAt: new Date().toISOString(),
          delivery: "queued"
        })
      },
      include: {
        sender: true
      }
    });

    await tx.conversation.update({
      where: {
        id: conversation.id
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

    await tx.outboundMessageJob.create({
      data: {
        workspaceId: input.workspaceId,
        conversationId: conversation.id,
        messageId: createdMessage.id,
        to: input.to,
        body: normalizedBody,
        attachmentMimeType: input.attachmentMimeType ?? null,
        attachmentName: input.attachmentName ?? null,
        attachmentUrl: input.attachmentUrl ?? null,
        interactiveButtonsJson: normalizedButtons.length ? JSON.stringify(normalizedButtons) : null,
        interactiveListButtonText: normalizedListOptions.length ? normalizedListButtonText : null,
        interactiveListOptionsJson: normalizedListOptions.length ? JSON.stringify(normalizedListOptions) : null
      }
    });

    return createdMessage;
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

export async function processPendingOutboundMessageJobs(limit = 10) {
  const dueJobs = await prisma.outboundMessageJob.findMany({
    where: {
      status: OutboundMessageJobStatus.PENDING,
      availableAt: {
        lte: new Date()
      }
    },
    orderBy: [{ availableAt: "asc" }, { createdAt: "asc" }],
    take: limit
  });

  let claimed = 0;
  let sent = 0;
  let failed = 0;

  for (const job of dueJobs) {
    const claim = await prisma.outboundMessageJob.updateMany({
      where: {
        id: job.id,
        status: OutboundMessageJobStatus.PENDING
      },
      data: {
        status: OutboundMessageJobStatus.RUNNING,
        lockedAt: new Date(),
        attempts: {
          increment: 1
        },
        lastError: null
      }
    });

    if (claim.count === 0) {
      continue;
    }

    claimed += 1;

    const runningJob = await prisma.outboundMessageJob.findUnique({
      where: {
        id: job.id
      }
    });

    if (!runningJob) {
      continue;
    }

    try {
      const provider = getMessagingProvider();
      const result = await provider.sendOutboundMessage({
        conversationId: runningJob.conversationId,
        workspaceId: runningJob.workspaceId,
        to: runningJob.to,
        body: runningJob.body,
        attachmentMimeType: runningJob.attachmentMimeType,
        attachmentName: runningJob.attachmentName,
        attachmentUrl: runningJob.attachmentUrl,
        interactiveButtons: parseChoices(runningJob.interactiveButtonsJson),
        interactiveListButtonText: runningJob.interactiveListButtonText,
        interactiveListOptions: parseChoices(runningJob.interactiveListOptionsJson)
      });

      await prisma.$transaction(async (tx) => {
        await tx.message.update({
          where: {
            id: runningJob.messageId
          },
          data: {
            providerMessageId: result.providerMessageId,
            rawPayload: JSON.stringify({
              source: "outbound-worker",
              queuedAt: runningJob.createdAt.toISOString(),
              sentAt: new Date().toISOString(),
              delivery: "sent"
            })
          }
        });

        await tx.outboundMessageJob.update({
          where: {
            id: runningJob.id
          },
          data: {
            status: OutboundMessageJobStatus.SENT,
            lockedAt: null,
            lastError: null
          }
        });
      });

      sent += 1;
    } catch (error) {
      const attempts = runningJob.attempts;
      const isExhausted = attempts >= runningJob.maxAttempts;
      const nextDelayMinutes = Math.min(30, Math.max(1, attempts * 2));

      await prisma.outboundMessageJob.update({
        where: {
          id: runningJob.id
        },
        data: {
          status: isExhausted ? OutboundMessageJobStatus.FAILED : OutboundMessageJobStatus.PENDING,
          lockedAt: null,
          lastError: error instanceof Error ? error.message : "Unable to send outbound message.",
          availableAt: isExhausted
            ? runningJob.availableAt
            : new Date(Date.now() + nextDelayMinutes * 60 * 1000)
        }
      });

      failed += 1;
    }
  }

  return {
    fetched: dueJobs.length,
    claimed,
    sent,
    failed
  };
}

export async function getOutboundMessageJobStatus(workspaceId: string) {
  const [pending, running, sent, failed, oldestPending, latestFailure, heartbeat] = await Promise.all([
    prisma.outboundMessageJob.count({
      where: {
        workspaceId,
        status: OutboundMessageJobStatus.PENDING
      }
    }),
    prisma.outboundMessageJob.count({
      where: {
        workspaceId,
        status: OutboundMessageJobStatus.RUNNING
      }
    }),
    prisma.outboundMessageJob.count({
      where: {
        workspaceId,
        status: OutboundMessageJobStatus.SENT
      }
    }),
    prisma.outboundMessageJob.count({
      where: {
        workspaceId,
        status: OutboundMessageJobStatus.FAILED
      }
    }),
    prisma.outboundMessageJob.findFirst({
      where: {
        workspaceId,
        status: OutboundMessageJobStatus.PENDING
      },
      orderBy: {
        availableAt: "asc"
      },
      select: {
        id: true,
        availableAt: true,
        createdAt: true
      }
    }),
    prisma.outboundMessageJob.findFirst({
      where: {
        workspaceId,
        status: OutboundMessageJobStatus.FAILED
      },
      orderBy: {
        updatedAt: "desc"
      },
      select: {
        id: true,
        lastError: true,
        updatedAt: true,
        attempts: true,
        maxAttempts: true
      }
    }),
    prisma.outboundWorkerHeartbeat.findUnique({
      where: {
        workspaceId
      },
      select: {
        workerLabel: true,
        lastSeenAt: true
      }
    })
  ]);

  return {
    pending,
    running,
    sent,
    failed,
    oldestPendingAt: oldestPending?.availableAt.toISOString() ?? null,
    latestFailure: latestFailure
      ? {
          id: latestFailure.id,
          message: latestFailure.lastError ?? "Unknown worker error.",
          updatedAt: latestFailure.updatedAt.toISOString(),
          attempts: latestFailure.attempts,
          maxAttempts: latestFailure.maxAttempts
        }
      : null,
    heartbeat: heartbeat
      ? {
          workerLabel: heartbeat.workerLabel ?? null,
          lastSeenAt: heartbeat.lastSeenAt.toISOString(),
          isOnline: Date.now() - heartbeat.lastSeenAt.getTime() <= 15_000
        }
      : null
  };
}

export async function retryFailedOutboundMessageJobs(workspaceId: string) {
  const result = await prisma.outboundMessageJob.updateMany({
    where: {
      workspaceId,
      status: OutboundMessageJobStatus.FAILED
    },
    data: {
      status: OutboundMessageJobStatus.PENDING,
      attempts: 0,
      lastError: null,
      lockedAt: null,
      availableAt: new Date()
    }
  });

  return {
    retried: result.count
  };
}

export async function recordOutboundWorkerHeartbeat(input: {
  workspaceId: string;
  workerLabel?: string | null;
}) {
  const heartbeat = await prisma.outboundWorkerHeartbeat.upsert({
    where: {
      workspaceId: input.workspaceId
    },
    create: {
      workspaceId: input.workspaceId,
      workerLabel: input.workerLabel?.trim() || null,
      lastSeenAt: new Date()
    },
    update: {
      workerLabel: input.workerLabel?.trim() || null,
      lastSeenAt: new Date()
    }
  });

  return {
    workerLabel: heartbeat.workerLabel,
    lastSeenAt: heartbeat.lastSeenAt.toISOString()
  };
}

function normalizeChoices(value: string[] | null | undefined, limit: number) {
  return (value ?? []).map((entry) => entry.trim()).filter(Boolean).slice(0, limit);
}

function parseChoices(value: string | null) {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      : [];
  } catch {
    return [];
  }
}

function buildStoredMessageBody(
  body: string,
  interactiveButtons: string[],
  interactiveListButtonText: string,
  interactiveListOptions: string[]
) {
  if (interactiveButtons.length) {
    return `${body}\n\n[Buttons]\n${interactiveButtons.map((label, index) => `${index + 1}. ${label}`).join("\n")}`;
  }

  if (!interactiveListOptions.length) {
    return body;
  }

  return `${body}\n\n[List: ${interactiveListButtonText || "Choose option"}]\n${interactiveListOptions
    .map((label, index) => `${index + 1}. ${label}`)
    .join("\n")}`;
}
