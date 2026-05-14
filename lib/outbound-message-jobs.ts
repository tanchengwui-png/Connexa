import {
  ConversationStatus,
  MessageDirection,
  OutboundMessageJobStatus
} from "@prisma/client";
import { getMessagingProvider } from "@/lib/messaging/provider";
import { assertWorkspaceHasOutboundMessageCapacity } from "@/lib/package-feature-limits";
import { prisma } from "@/lib/prisma";
import { isRemoteSenderServiceEnabled } from "@/lib/sender-service-client";
import { getWhatsAppSenderNodeMetrics } from "@/lib/whatsapp-runtime";

type EnqueueOutboundMessageInput = {
  workspaceId: string;
  conversationId: string;
  campaignRunId?: string | null;
  campaignRunRecipientId?: string | null;
  to: string;
  body: string;
  availableAt?: Date | null;
  replyToMessageId?: string | null;
  senderId?: string | null;
  source: "manual-reply" | "automation-engine";
  attachmentMimeType?: string | null;
  attachmentName?: string | null;
  attachmentUrl?: string | null;
  mentions?: Array<{
    id: string;
    label: string;
    token: string;
  }> | null;
  interactiveButtons?: string[] | null;
  interactiveListButtonText?: string | null;
  interactiveListOptions?: string[] | null;
};

const STALE_RUNNING_JOB_MS = Math.max(
  60_000,
  Number.parseInt(process.env.OUTBOUND_WORKER_STALE_LOCK_MS ?? "300000", 10) || 300000
);
const DEFERRED_RETRY_MS = Math.max(
  30_000,
  Number.parseInt(process.env.OUTBOUND_WORKER_DEFERRED_RETRY_MS ?? "120000", 10) || 120000
);

type OutboundJobErrorCode =
  | "SENDER_TIMEOUT"
  | "SENDER_UNAVAILABLE"
  | "CHANNEL_NOT_CONNECTED"
  | "SESSION_RELINK_REQUIRED"
  | "APP_UNREACHABLE"
  | "INVALID_RECIPIENT"
  | "UNKNOWN";

type OutboundJobDisposition = "deferred" | "transient" | "permanent";

type WorkspacePreflightResult =
  | {
      ok: true;
    }
  | {
      ok: false;
      code: OutboundJobErrorCode;
      message: string;
      disposition: "deferred";
      nextRetryAt: Date;
    };

export async function enqueueOutboundMessage(input: EnqueueOutboundMessageInput) {
  const normalizedBody = input.body.trim();
  const normalizedButtons = normalizeChoices(input.interactiveButtons, 3);
  const normalizedListOptions = normalizeChoices(input.interactiveListOptions, 10);
  const normalizedListButtonText = input.interactiveListButtonText?.trim() || "Choose option";
  const normalizedMentions = normalizeMentions(input.mentions);

  if (!normalizedBody && !input.attachmentUrl) {
    throw new Error("Message body or attachment is required.");
  }

  if (input.attachmentUrl && (normalizedButtons.length || normalizedListOptions.length)) {
    throw new Error("Interactive messages cannot include attachments yet.");
  }

  if (normalizedButtons.length && normalizedListOptions.length) {
    throw new Error("Choose either buttons or a list for this reply.");
  }

  await assertWorkspaceHasOutboundMessageCapacity(input.workspaceId);

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

  const replyTarget = input.replyToMessageId
    ? await prisma.message.findFirst({
        where: {
          id: input.replyToMessageId,
          conversationId: conversation.id,
          deletedAt: null
        },
        select: {
          id: true,
          providerMessageId: true
        }
      })
    : null;

  if (input.replyToMessageId && !replyTarget) {
    throw new Error("Reply target was not found.");
  }

  const previewText =
    normalizedBody ||
    (input.attachmentName ? `Attachment: ${input.attachmentName}` : "Attachment sent");

  const message = await prisma.$transaction(async (tx) => {
    const createdMessage = await tx.message.create({
      data: {
        conversationId: conversation.id,
        senderId: input.senderId ?? null,
        replyToMessageId: replyTarget?.id ?? null,
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
          delivery: "queued",
          mentions: normalizedMentions
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
          campaignRunId: input.campaignRunId ?? null,
          campaignRunRecipientId: input.campaignRunRecipientId ?? null,
          to: input.to,
          body: normalizedBody,
          availableAt: input.availableAt ?? undefined,
          quotedProviderMessageId: replyTarget?.providerMessageId ?? null,
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

export async function processPendingOutboundMessageJobs(limit = 10, workspaceId?: string) {
  const recovered = await recoverStaleRunningOutboundMessageJobs(workspaceId);
  const dueJobs = await prisma.outboundMessageJob.findMany({
    where: {
      ...(workspaceId ? { workspaceId } : {}),
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
  let deferred = 0;
  const preflightByWorkspace = new Map<string, WorkspacePreflightResult>();

  for (const job of dueJobs) {
    let preflight = preflightByWorkspace.get(job.workspaceId);
    if (!preflight) {
      preflight = await runWorkspaceSendPreflight(job.workspaceId);
      preflightByWorkspace.set(job.workspaceId, preflight);
    }

    if (!preflight.ok) {
      await deferOutboundMessageJob(job.id, preflight.code, preflight.message, preflight.nextRetryAt);
      deferred += 1;
      continue;
    }

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
      },
      include: {
        message: {
          select: {
            senderId: true,
            rawPayload: true
          }
        }
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
        simulateTyping: !runningJob.message?.senderId,
        attachmentMimeType: runningJob.attachmentMimeType,
        attachmentName: runningJob.attachmentName,
        attachmentUrl: runningJob.attachmentUrl,
        mentions: parseMentionsFromRawPayload(runningJob.message?.rawPayload ?? null),
        quotedProviderMessageId: runningJob.quotedProviderMessageId,
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
              delivery: "sent",
              mentions: parseMentionsFromRawPayload(runningJob.message?.rawPayload ?? null)
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
      const classifiedError = classifyOutboundJobError(error);
      const attempts = runningJob.attempts;
      const shouldPreserveAttempt = classifiedError.disposition !== "deferred";
      const effectiveAttempts = shouldPreserveAttempt ? attempts : Math.max(0, attempts - 1);
      const isExhausted =
        classifiedError.disposition === "permanent" || effectiveAttempts >= runningJob.maxAttempts;
      const nextRetryAt =
        classifiedError.disposition === "deferred"
          ? new Date(Date.now() + DEFERRED_RETRY_MS)
          : new Date(Date.now() + getRetryDelayMs(effectiveAttempts));

      await prisma.outboundMessageJob.update({
        where: {
          id: runningJob.id
        },
        data: {
          status: isExhausted ? OutboundMessageJobStatus.FAILED : OutboundMessageJobStatus.PENDING,
          lockedAt: null,
          attempts: shouldPreserveAttempt ? undefined : { decrement: 1 },
          lastError: formatOutboundJobError(classifiedError.code, classifiedError.message),
          availableAt: isExhausted ? runningJob.availableAt : nextRetryAt
        }
      });

      if (classifiedError.disposition === "deferred") {
        deferred += 1;
      } else {
        failed += 1;
      }
    }
  }

  return {
    recovered,
    fetched: dueJobs.length,
    claimed,
    sent,
    failed,
    deferred
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
    prisma.outboundWorkerHeartbeat.findFirst({
      where: {
        workspaceId
      },
      orderBy: {
        lastSeenAt: "desc"
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
  workerLabel: string;
}) {
  const workspaceId = input.workspaceId.trim();
  const workerLabel = input.workerLabel.trim();

  if (!workspaceId) {
    throw new Error("workspaceId is required.");
  }

  if (!workerLabel) {
    throw new Error("workerLabel is required.");
  }

  const heartbeat = await prisma.outboundWorkerHeartbeat.upsert({
    where: {
      workspaceId_workerLabel: {
        workspaceId,
        workerLabel
      }
    },
    create: {
      workspaceId,
      workerLabel,
      lastSeenAt: new Date()
    },
    update: {
      workerLabel,
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

function normalizeMentions(
  value: Array<{ id: string; label: string; token: string }> | null | undefined
) {
  return Array.from(
    new Map(
      (value ?? [])
        .map((mention) => ({
          id: mention.id.trim(),
          label: mention.label.trim(),
          token: mention.token.trim()
        }))
        .filter((mention) => mention.id && mention.label && mention.token)
        .map((mention) => [mention.id, mention])
    ).values()
  );
}

function parseMentionsFromRawPayload(rawPayload: string | null) {
  if (!rawPayload) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawPayload) as Record<string, unknown>;
    const mentions = parsed.mentions;
    if (!Array.isArray(mentions)) {
      return [];
    }

    return normalizeMentions(
      mentions
        .map((mention) => {
          if (!mention || typeof mention !== "object") {
            return null;
          }

          const record = mention as Record<string, unknown>;
          return {
            id: typeof record.id === "string" ? record.id : "",
            label: typeof record.label === "string" ? record.label : "",
            token: typeof record.token === "string" ? record.token : ""
          };
        })
        .filter((mention): mention is { id: string; label: string; token: string } => Boolean(mention))
    );
  } catch {
    return [];
  }
}

async function recoverStaleRunningOutboundMessageJobs(workspaceId?: string) {
  const staleBefore = new Date(Date.now() - STALE_RUNNING_JOB_MS);
  const result = await prisma.outboundMessageJob.updateMany({
    where: {
      ...(workspaceId ? { workspaceId } : {}),
      status: OutboundMessageJobStatus.RUNNING,
      lockedAt: {
        lt: staleBefore
      }
    },
    data: {
      status: OutboundMessageJobStatus.PENDING,
      lockedAt: null,
      lastError: formatOutboundJobError(
        "APP_UNREACHABLE",
        `Recovered stale worker lock after ${Math.round(STALE_RUNNING_JOB_MS / 60000)} minute(s).`
      ),
      availableAt: new Date()
    }
  });

  return result.count;
}

async function runWorkspaceSendPreflight(workspaceId: string): Promise<WorkspacePreflightResult> {
  const channel = await prisma.whatsAppChannel.findUnique({
    where: {
      workspaceId
    },
    select: {
      connectionStatus: true,
      sessionClientId: true
    }
  });

  const connectionStatus = channel?.connectionStatus ?? "DISCONNECTED";
  if (connectionStatus === "QR_READY" || connectionStatus === "AUTH_FAILED") {
    return buildDeferredPreflight(
      "SESSION_RELINK_REQUIRED",
      "WhatsApp session needs relink before queued sends can continue."
    );
  }

  if (
    connectionStatus === "DISCONNECTED" ||
    connectionStatus === "ERROR" ||
    !channel?.sessionClientId
  ) {
    return buildDeferredPreflight(
      "CHANNEL_NOT_CONNECTED",
      "WhatsApp channel is not connected for outbound delivery."
    );
  }

  if (isRemoteSenderServiceEnabled()) {
    try {
      await getWhatsAppSenderNodeMetrics();
    } catch (error) {
      return buildDeferredPreflight(
        "SENDER_UNAVAILABLE",
        error instanceof Error ? error.message : "Sender service is unavailable."
      );
    }
  }

  return { ok: true };
}

function buildDeferredPreflight(code: OutboundJobErrorCode, message: string): WorkspacePreflightResult {
  return {
    ok: false,
    code,
    message,
    disposition: "deferred",
    nextRetryAt: new Date(Date.now() + DEFERRED_RETRY_MS)
  };
}

async function deferOutboundMessageJob(
  jobId: string,
  code: OutboundJobErrorCode,
  message: string,
  nextRetryAt: Date
) {
  await prisma.outboundMessageJob.update({
    where: {
      id: jobId
    },
    data: {
      status: OutboundMessageJobStatus.PENDING,
      lockedAt: null,
      lastError: formatOutboundJobError(code, message),
      availableAt: nextRetryAt
    }
  });
}

function classifyOutboundJobError(error: unknown): {
  code: OutboundJobErrorCode;
  disposition: OutboundJobDisposition;
  message: string;
} {
  const message = error instanceof Error ? error.message : "Unable to send outbound message.";
  const normalized = message.toLowerCase();

  if (normalized.includes("timed out")) {
    return {
      code: "SENDER_TIMEOUT",
      disposition: "transient",
      message
    };
  }

  if (normalized.includes("qr") || normalized.includes("relink") || normalized.includes("auth failed")) {
    return {
      code: "SESSION_RELINK_REQUIRED",
      disposition: "deferred",
      message
    };
  }

  if (
    normalized.includes("session") && normalized.includes("not") && normalized.includes("ready")
  ) {
    return {
      code: "SESSION_RELINK_REQUIRED",
      disposition: "deferred",
      message
    };
  }

  if (normalized.includes("recipient") || normalized.includes("phone number") || normalized.includes("jid")) {
    return {
      code: "INVALID_RECIPIENT",
      disposition: "permanent",
      message
    };
  }

  if (
    normalized.includes("sender service") ||
    normalized.includes("fetch failed") ||
    normalized.includes("econnrefused") ||
    normalized.includes("enotfound")
  ) {
    return {
      code: "SENDER_UNAVAILABLE",
      disposition: "deferred",
      message
    };
  }

  if (normalized.includes("502") || normalized.includes("503") || normalized.includes("bad gateway")) {
    return {
      code: "APP_UNREACHABLE",
      disposition: "deferred",
      message
    };
  }

  return {
    code: "UNKNOWN",
    disposition: "transient",
    message
  };
}

function formatOutboundJobError(code: OutboundJobErrorCode, message: string) {
  return `[${code}] ${message}`;
}

function getRetryDelayMs(attempts: number) {
  const boundedAttempts = Math.max(1, attempts);
  const baseDelayMinutes = Math.min(30, Math.max(1, boundedAttempts * 2));
  const jitterMs = Math.floor(Math.random() * 15_000);
  return baseDelayMinutes * 60 * 1000 + jitterMs;
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
