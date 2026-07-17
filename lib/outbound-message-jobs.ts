import {
  ConversationStatus,
  MessageDirection,
  OutboundMessageJobStatus
} from "@/lib/db-types";
import { randomUUID } from "node:crypto";
import { estimateWhatsAppMessageCost } from "@/lib/message-usage";
import { getMessagingProvider } from "@/lib/messaging/provider";
import { assertWorkspaceHasOutboundMessageCapacity } from "@/lib/package-feature-limits";
import { prisma } from "@/lib/prisma";
import { isRemoteSenderServiceEnabled } from "@/lib/sender-service-client";
import { persistWhatsAppMessageAck } from "@/lib/whatsapp-ack";
import { resolveOutboundJobChannelId } from "@/lib/whatsapp-channel-routing";
import { getWhatsAppSenderNodeMetrics } from "@/lib/whatsapp-runtime";

type TransactionClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
type PrismaExecutor = {
  $queryRawUnsafe: <T = unknown>(query: string, ...values: unknown[]) => Promise<T>;
};

type EnqueueOutboundMessageInput = {
  workspaceId: string;
  conversationId: string;
  channelId?: string | null;
  campaignRunId?: string | null;
  campaignRunRecipientId?: string | null;
  to: string;
  body: string;
  availableAt?: Date | null;
  replyToMessageId?: string | null;
  senderId?: string | null;
  source: "manual-reply" | "automation-engine";
  mediaAssetId?: string | null;
  attachmentMimeType?: string | null;
  attachmentName?: string | null;
  attachmentUrl?: string | null;
  attachmentPath?: string | null;
  sendAudioAsVoice?: boolean;
  mentions?: Array<{
    id: string;
    label: string;
    token: string;
  }> | null;
  interactiveButtons?: string[] | null;
  interactiveListButtonText?: string | null;
  interactiveListOptions?: string[] | null;
  template?: {
    name: string;
    languageCode?: string | null;
    components?: unknown[] | null;
    variables?: unknown[] | null;
    bodyVariables?: unknown[] | null;
    headerVariables?: unknown[] | null;
  } | null;
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

  const channelId = await resolveOutboundJobChannelId({
    workspaceId: input.workspaceId,
    conversationId: conversation.id,
    explicitChannelId: input.channelId ?? conversation.channelId
  });
  const providerKind = await resolveChannelProviderKind(channelId);
  const normalizedBody = input.body.trim();
  const normalizedButtons = normalizeChoices(input.interactiveButtons, 3);
  const normalizedListOptions = normalizeChoices(input.interactiveListOptions, 10);
  const normalizedListButtonText = input.interactiveListButtonText?.trim() || "Choose option";
  const normalizedMentions = normalizeMentions(input.mentions);
  const normalizedTemplate =
    providerKind === "cloud" ? normalizeTemplatePayload(input.template) : null;
  const outboundBody = normalizedBody || (normalizedTemplate ? `Template: ${normalizedTemplate.name}` : "");
  const previewText =
    outboundBody ||
    (normalizedTemplate ? `Template: ${normalizedTemplate.name}` : "") ||
    (input.attachmentName ? `Attachment: ${input.attachmentName}` : "Attachment sent");

  if (!normalizedBody && !input.attachmentUrl && !normalizedTemplate) {
    throw new Error("Message body or attachment is required.");
  }

  if (input.attachmentUrl && (normalizedButtons.length || normalizedListOptions.length)) {
    throw new Error("Interactive messages cannot include attachments yet.");
  }

  if (normalizedButtons.length && normalizedListOptions.length) {
    throw new Error("Choose either buttons or a list for this reply.");
  }

  const message = await prisma.$transaction(async (tx: TransactionClient) => {
    const messageBody = buildStoredMessageBody(
      outboundBody,
      normalizedButtons,
      normalizedListButtonText,
      normalizedListOptions
    );
    const createdMessage = await insertOutboundMessageRecord(tx, {
      conversationId: conversation.id,
      senderId: input.senderId ?? null,
        replyToMessageId: replyTarget?.id ?? null,
        direction: MessageDirection.OUTBOUND,
        body: messageBody,
        mediaAssetId: input.mediaAssetId ?? null,
        attachmentMimeType: input.attachmentMimeType ?? null,
      attachmentName: input.attachmentName ?? null,
      attachmentUrl: input.attachmentUrl ?? null,
      rawPayload: JSON.stringify({
        source: input.source,
        queuedAt: new Date().toISOString(),
        delivery: "queued",
        mentions: normalizedMentions,
        template: normalizedTemplate,
        attachmentOptions: {
          attachmentPath: input.attachmentPath ?? null,
          sendAudioAsVoice: Boolean(input.sendAudioAsVoice)
        },
        queue: {
          kind: input.campaignRunId ? "campaign" : "direct"
        }
      })
    });
    const sender = input.senderId
      ? await tx.agent.findUnique({
          where: {
            id: input.senderId
          },
          select: {
            name: true
          }
        })
      : null;

    await tx.conversation.update({
      where: {
        id: conversation.id
      },
      data: {
        channelId: channelId ?? conversation.channelId ?? null,
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
        channelId,
        conversationId: conversation.id,
        messageId: createdMessage.id,
        mediaAssetId: input.mediaAssetId ?? null,
        campaignRunId: input.campaignRunId ?? null,
        campaignRunRecipientId: input.campaignRunRecipientId ?? null,
        to: input.to,
        body: outboundBody,
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

    return {
      ...createdMessage,
      senderName: sender?.name ?? null
    };
  });

  return {
    id: message.id,
    attachmentMimeType: message.attachmentMimeType,
    attachmentName: message.attachmentName,
    attachmentUrl: message.attachmentUrl,
    body: message.body,
    direction: message.direction,
    sender: message.senderName ?? "Team",
    sentAt: message.sentAt
  };
}

async function insertOutboundMessageRecord(
  executor: PrismaExecutor,
  input: {
    conversationId: string;
    senderId: string | null;
    replyToMessageId: string | null;
    direction: string;
    body: string;
    mediaAssetId: string | null;
    attachmentMimeType: string | null;
    attachmentName: string | null;
    attachmentUrl: string | null;
    rawPayload: string;
  }
) {
  const rows = await executor.$queryRawUnsafe<
    Array<{
      id: string;
      attachmentMimeType: string | null;
      attachmentName: string | null;
      attachmentUrl: string | null;
      body: string;
      direction: string;
      sentAt: Date;
    }>
  >(
    `INSERT INTO "Message" (
      id, "conversationId", "senderId", "replyToMessageId", direction, body,
      "mediaAssetId", "attachmentMimeType", "attachmentName", "attachmentUrl", "rawPayload"
    ) VALUES ($1, $2, $3, $4, CAST($5 AS "MessageDirection"), $6, $7, $8, $9, $10, $11)
    RETURNING id, "attachmentMimeType", "attachmentName", "attachmentUrl", body, direction, "sentAt"`,
    randomUUID().replace(/-/g, ""),
    input.conversationId,
    input.senderId,
    input.replyToMessageId,
    input.direction,
    input.body,
    input.mediaAssetId,
    input.attachmentMimeType,
    input.attachmentName,
    input.attachmentUrl,
    input.rawPayload
  );

  const created = rows[0];
  if (!created?.id) {
    throw new Error("Unable to create outbound message record.");
  }

  return {
    ...created,
    senderName: null as string | null
  };
}

export async function processPendingOutboundMessageJobs(limit = 10, workspaceId?: string) {
  const recovered = await recoverStaleRunningOutboundMessageJobs(workspaceId);
  const dueJobs = await findDueOutboundMessageJobs(limit, workspaceId);
  const selectedJobs = await applyProviderBatchLimits<(typeof dueJobs)[number]>(dueJobs, limit);

  let claimed = 0;
  let sent = 0;
  let failed = 0;
  let deferred = 0;
  const preflightByChannel = new Map<string, WorkspacePreflightResult>();

  for (const job of selectedJobs) {
    const preflightKey = job.channelId ?? `workspace:${job.workspaceId}`;
    let preflight = preflightByChannel.get(preflightKey);
    if (!preflight) {
      preflight = await runWorkspaceSendPreflight(job.workspaceId, job.channelId ?? null);
      preflightByChannel.set(preflightKey, preflight);
    }

    if (preflight.ok === false) {
      const { code, message, nextRetryAt } = preflight;
      await deferOutboundMessageJob(job.id, code, message, nextRetryAt);
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

    const runningJob = await findRunningOutboundMessageJob(job.id);

    if (!runningJob) {
      continue;
    }

    const provider = getMessagingProvider();
    const providerKind = await resolveChannelProviderKind(runningJob.channelId ?? null);
    const template =
      providerKind === "cloud"
        ? parseTemplateFromRawPayload(runningJob.message?.rawPayload ?? null)
        : null;
    const messageType = resolveOutboundMessageUsageType({
      attachmentUrl: runningJob.attachmentUrl,
      interactiveButtonsJson: runningJob.interactiveButtonsJson,
      interactiveListOptionsJson: runningJob.interactiveListOptionsJson,
      template
    });
    const idempotencyKey = buildOutboundJobIdempotencyKey(runningJob.id);
    const usageCostEstimate = estimateWhatsAppMessageCost({
      provider: providerKind,
      messageType
    });

    let providerMessageId = runningJob.message?.providerMessageId ?? null;

    if (!providerMessageId) {
      try {
        const result = await provider.sendOutboundMessage({
          channelId: runningJob.channelId ?? null,
          conversationId: runningJob.conversationId,
          workspaceId: runningJob.workspaceId,
          to: runningJob.to,
          body: runningJob.body,
          simulateTyping: !runningJob.message?.senderId,
          attachmentMimeType: runningJob.attachmentMimeType,
          attachmentName: runningJob.attachmentName,
          attachmentUrl: runningJob.attachmentUrl,
          attachmentPath: parseAttachmentOptionsFromRawPayload(runningJob.message?.rawPayload ?? null).attachmentPath,
          sendAudioAsVoice: parseAttachmentOptionsFromRawPayload(runningJob.message?.rawPayload ?? null).sendAudioAsVoice,
          mentions: parseMentionsFromRawPayload(runningJob.message?.rawPayload ?? null),
          quotedProviderMessageId: runningJob.quotedProviderMessageId,
          interactiveButtons: parseChoices(runningJob.interactiveButtonsJson),
          interactiveListButtonText: runningJob.interactiveListButtonText,
          interactiveListOptions: parseChoices(runningJob.interactiveListOptionsJson),
          template
        });
        providerMessageId = normalizeProviderMessageId(result.providerMessageId);
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
        continue;
      }
    }

    if (!providerMessageId) {
      const nextRetryAt = new Date(Date.now() + getRetryDelayMs(runningJob.attempts));
      await prisma.outboundMessageJob.update({
        where: {
          id: runningJob.id
        },
        data: {
          status:
            runningJob.attempts >= runningJob.maxAttempts
              ? OutboundMessageJobStatus.FAILED
              : OutboundMessageJobStatus.PENDING,
          lockedAt: null,
          lastError: formatOutboundJobError(
            "UNKNOWN",
            "Provider send could not be confirmed because no provider message id was returned."
          ),
          availableAt:
            runningJob.attempts >= runningJob.maxAttempts ? runningJob.availableAt : nextRetryAt
        }
      });
      failed += 1;
      continue;
    }

    try {
      await persistSuccessfulOutboundMessageJob({
        runningJob,
        providerMessageId,
        providerKind,
        messageType,
        usageCostEstimate,
        template,
        idempotencyKey
      });
      sent += 1;
    } catch (error) {
      await markOutboundMessageJobSentAfterSuccess({
        runningJobId: runningJob.id,
        workspaceId: runningJob.workspaceId,
        channelId: runningJob.channelId,
        messageId: runningJob.messageId,
        providerMessageId,
        originalRawPayload: runningJob.message?.rawPayload ?? null,
        template,
        idempotencyKey,
        persistenceError: error
      });
      sent += 1;
    }
  }

  return {
    recovered,
    fetched: dueJobs.length,
    selected: selectedJobs.length,
    claimed,
    sent,
    failed,
    deferred
  };
}

async function findDueOutboundMessageJobs(limit: number, workspaceId?: string) {
  try {
    return await prisma.outboundMessageJob.findMany({
      where: {
        ...(workspaceId ? { workspaceId } : {}),
        status: OutboundMessageJobStatus.PENDING,
        availableAt: {
          lte: new Date()
        }
      },
      orderBy: [{ availableAt: "asc" }, { createdAt: "asc" }],
      take: Math.max(limit * 4, limit)
    });
  } catch (error) {
    if (!isMissingOutboundMessageMediaAssetColumnError(error)) {
      throw error;
    }

    return prisma.$queryRawUnsafe<
      Array<{
        id: string;
        workspaceId: string;
        channelId: string | null;
        conversationId: string;
        messageId: string;
        campaignRunId: string | null;
        campaignRunRecipientId: string | null;
        status: OutboundMessageJobStatus;
        to: string;
        body: string;
        attachmentMimeType: string | null;
        attachmentName: string | null;
        attachmentUrl: string | null;
        quotedProviderMessageId: string | null;
        interactiveButtonsJson: string | null;
        interactiveListButtonText: string | null;
        interactiveListOptionsJson: string | null;
        attempts: number;
        maxAttempts: number;
        availableAt: Date;
        lockedAt: Date | null;
        lastError: string | null;
        createdAt: Date;
        updatedAt: Date;
      }>
    >(
      `SELECT
        id, "workspaceId", "channelId", "conversationId", "messageId",
        "campaignRunId", "campaignRunRecipientId", status, "to", body,
        "attachmentMimeType", "attachmentName", "attachmentUrl", "quotedProviderMessageId",
        "interactiveButtonsJson", "interactiveListButtonText", "interactiveListOptionsJson",
        attempts, "maxAttempts", "availableAt", "lockedAt", "lastError", "createdAt", "updatedAt"
      FROM "OutboundMessageJob"
      WHERE status = $1
        AND "availableAt" <= $2
        ${workspaceId ? 'AND "workspaceId" = $3' : ""}
      ORDER BY "availableAt" ASC, "createdAt" ASC
      LIMIT ${Math.max(limit * 4, limit)}`,
      ...(workspaceId
        ? [OutboundMessageJobStatus.PENDING, new Date(), workspaceId]
        : [OutboundMessageJobStatus.PENDING, new Date()])
    );
  }
}

async function findRunningOutboundMessageJob(jobId: string) {
  try {
    return await prisma.outboundMessageJob.findUnique({
      where: {
        id: jobId
      },
      include: {
        message: {
          select: {
            senderId: true,
            rawPayload: true,
            providerMessageId: true
          }
        }
      }
    });
  } catch (error) {
    if (!isMissingOutboundMessageMediaAssetColumnError(error)) {
      throw error;
    }

    const rows = await prisma.$queryRawUnsafe<
      Array<{
        id: string;
        workspaceId: string;
        channelId: string | null;
        conversationId: string;
        messageId: string;
        status: OutboundMessageJobStatus;
        to: string;
        body: string;
        attachmentMimeType: string | null;
        attachmentName: string | null;
        attachmentUrl: string | null;
        quotedProviderMessageId: string | null;
        interactiveButtonsJson: string | null;
        interactiveListButtonText: string | null;
        interactiveListOptionsJson: string | null;
        attempts: number;
        maxAttempts: number;
        availableAt: Date;
        lockedAt: Date | null;
        lastError: string | null;
        createdAt: Date;
        updatedAt: Date;
        messageSenderId: string | null;
        messageRawPayload: string | null;
        messageProviderMessageId: string | null;
      }>
    >(
      `SELECT
        job.id, job."workspaceId", job."channelId", job."conversationId", job."messageId",
        job.status, job."to", job.body, job."attachmentMimeType", job."attachmentName",
        job."attachmentUrl", job."quotedProviderMessageId", job."interactiveButtonsJson",
        job."interactiveListButtonText", job."interactiveListOptionsJson", job.attempts,
        job."maxAttempts", job."availableAt", job."lockedAt", job."lastError", job."createdAt", job."updatedAt",
        msg."senderId" AS "messageSenderId", msg."rawPayload" AS "messageRawPayload",
        msg."providerMessageId" AS "messageProviderMessageId"
      FROM "OutboundMessageJob" job
      LEFT JOIN "Message" msg ON msg.id = job."messageId"
      WHERE job.id = $1
      LIMIT 1`,
      jobId
    );

    const row = rows[0];
    if (!row) {
      return null;
    }

    return {
      ...row,
      message: {
        senderId: row.messageSenderId,
        rawPayload: row.messageRawPayload,
        providerMessageId: row.messageProviderMessageId
      }
    };
  }
}

function isMissingOutboundMessageMediaAssetColumnError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  const candidate = error as Error & { code?: string; meta?: { column?: string } };
  return (
    candidate.code === "P2022" &&
    (candidate.meta?.column === "OutboundMessageJob.mediaAssetId" ||
      candidate.message.includes("OutboundMessageJob.mediaAssetId"))
  );
}

async function persistSuccessfulOutboundMessageJob(input: {
  runningJob: {
    id: string;
    workspaceId: string;
    channelId: string | null;
    messageId: string;
    createdAt: Date;
    message?: {
      rawPayload: string | null;
    } | null;
  };
  providerMessageId: string;
  providerKind: "personal" | "cloud";
  messageType: "text" | "template" | "media" | "interactive";
  usageCostEstimate: number;
  template: {
    name: string;
    languageCode?: string | null;
    components?: unknown[] | null;
    variables?: unknown[] | null;
    bodyVariables?: unknown[] | null;
    headerVariables?: unknown[] | null;
  } | null;
  idempotencyKey: string;
}) {
  const sentAt = new Date();
  const existingRawPayload = parseRawPayload(input.runningJob.message?.rawPayload ?? null);
  const usageLoggedAt =
    typeof existingRawPayload.usageLoggedAt === "string" && existingRawPayload.usageLoggedAt.trim()
      ? existingRawPayload.usageLoggedAt.trim()
      : null;
  const nextRawPayload = buildSuccessfulOutboundRawPayload({
    existingRawPayload,
    queuedAt: input.runningJob.createdAt,
    sentAt,
    providerMessageId: input.providerMessageId,
    template: input.template,
    mentions: parseMentionsFromRawPayload(input.runningJob.message?.rawPayload ?? null),
    idempotencyKey: input.idempotencyKey,
    usageLoggedAt: usageLoggedAt ?? sentAt.toISOString()
  });

  await prisma.$transaction(async (tx: TransactionClient) => {
    await tx.message.update({
      where: {
        id: input.runningJob.messageId
      },
      data: {
        providerMessageId: input.providerMessageId,
        rawPayload: JSON.stringify(nextRawPayload)
      }
    });

    await tx.outboundMessageJob.update({
      where: {
        id: input.runningJob.id
      },
      data: {
        status: OutboundMessageJobStatus.SENT,
        lockedAt: null,
        lastError: null
      }
    });

    if (!usageLoggedAt) {
      await tx.messageUsageLog.create({
        data: {
          workspaceId: input.runningJob.workspaceId,
          accountId: input.runningJob.channelId ?? null,
          provider: input.providerKind,
          messageType: input.messageType,
          costEstimate: usageCostEstimateToDecimal(input.usageCostEstimate),
          timestamp: sentAt
        }
      });
    }
  });

  await persistWhatsAppMessageAck({
    workspaceId: input.runningJob.workspaceId,
    channelId: input.runningJob.channelId,
    providerMessageId: input.providerMessageId,
    ack: 1,
    occurredAt: sentAt
  }).catch(() => null);
}

async function markOutboundMessageJobSentAfterSuccess(input: {
  runningJobId: string;
  workspaceId: string;
  channelId: string | null;
  messageId: string;
  providerMessageId: string;
  originalRawPayload: string | null;
  template: {
    name: string;
    languageCode?: string | null;
    components?: unknown[] | null;
    variables?: unknown[] | null;
    bodyVariables?: unknown[] | null;
    headerVariables?: unknown[] | null;
  } | null;
  idempotencyKey: string;
  persistenceError: unknown;
}) {
  const sentAt = new Date();
  const existingRawPayload = parseRawPayload(input.originalRawPayload);
  const fallbackRawPayload = buildSuccessfulOutboundRawPayload({
    existingRawPayload,
    queuedAt:
      typeof existingRawPayload.queuedAt === "string" ? new Date(existingRawPayload.queuedAt) : sentAt,
    sentAt,
    providerMessageId: input.providerMessageId,
    template: input.template,
    mentions: parseMentionsFromRawPayload(input.originalRawPayload),
    idempotencyKey: input.idempotencyKey,
    usageLoggedAt:
      typeof existingRawPayload.usageLoggedAt === "string" ? existingRawPayload.usageLoggedAt : null,
    persistenceError: formatOutboundPostSendPersistenceError(input.persistenceError)
  });

  try {
    await prisma.outboundMessageJob.update({
      where: {
        id: input.runningJobId
      },
      data: {
        status: OutboundMessageJobStatus.SENT,
        lockedAt: null,
        lastError: formatOutboundPostSendPersistenceError(input.persistenceError)
      }
    });
  } catch {
    await prisma.outboundMessageJob.updateMany({
      where: {
        id: input.runningJobId
      },
      data: {
        status: OutboundMessageJobStatus.SENT,
        lockedAt: null,
        lastError: formatOutboundPostSendPersistenceError(input.persistenceError)
      }
    });
  }

  try {
    await prisma.message.updateMany({
      where: {
        id: input.messageId
      },
      data: {
        providerMessageId: input.providerMessageId,
        rawPayload: JSON.stringify(fallbackRawPayload)
      }
    });
  } catch {
    // Never rethrow after provider success; the job has already been finalized as SENT.
  }

  await persistWhatsAppMessageAck({
    workspaceId: input.workspaceId,
    channelId: input.channelId,
    providerMessageId: input.providerMessageId,
    ack: 1,
    occurredAt: sentAt
  }).catch(() => null);
}

function buildSuccessfulOutboundRawPayload(input: {
  existingRawPayload: Record<string, unknown>;
  queuedAt: Date;
  sentAt: Date;
  providerMessageId: string;
  template: {
    name: string;
    languageCode?: string | null;
    components?: unknown[] | null;
    variables?: unknown[] | null;
    bodyVariables?: unknown[] | null;
    headerVariables?: unknown[] | null;
  } | null;
  mentions: Array<{ id: string; label: string; token: string }>;
  idempotencyKey: string;
  usageLoggedAt?: string | null;
  persistenceError?: string | null;
}) {
  return {
    ...input.existingRawPayload,
    source: "outbound-worker",
    queuedAt: input.queuedAt.toISOString(),
    sentAt: input.sentAt.toISOString(),
    delivery: "sent",
    mentions: input.mentions,
    template: input.template,
    lastProviderMessageId: input.providerMessageId,
    idempotencyKey: input.idempotencyKey,
    ...(input.usageLoggedAt ? { usageLoggedAt: input.usageLoggedAt } : {}),
    ...(input.persistenceError ? { persistenceError: input.persistenceError } : {})
  };
}

function formatOutboundPostSendPersistenceError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown post-send persistence failure.";
  return `Provider send succeeded but post-send persistence failed: ${message}`;
}

function usageCostEstimateToDecimal(value: number) {
  const normalized = Number.isFinite(value) ? value : 0;
  return normalized.toFixed(4);
}

function buildOutboundJobIdempotencyKey(jobId: string) {
  return `outbound-job:${jobId}`;
}

function normalizeProviderMessageId(value: string | null | undefined) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) {
    throw new Error("Provider send could not be confirmed because no provider message id was returned.");
  }
  return normalized;
}

export async function getOutboundMessageJobStatus(workspaceId: string, channelId?: string | null) {
  const scope = {
    workspaceId,
    ...(channelId ? { channelId } : {})
  };
  const [pending, running, sent, failed, oldestPending, latestFailure, heartbeat] = await Promise.all([
    prisma.outboundMessageJob.count({
      where: {
        ...scope,
        status: OutboundMessageJobStatus.PENDING
      }
    }),
    prisma.outboundMessageJob.count({
      where: {
        ...scope,
        status: OutboundMessageJobStatus.RUNNING
      }
    }),
    prisma.outboundMessageJob.count({
      where: {
        ...scope,
        status: OutboundMessageJobStatus.SENT
      }
    }),
    prisma.outboundMessageJob.count({
      where: {
        ...scope,
        status: OutboundMessageJobStatus.FAILED
      }
    }),
    prisma.outboundMessageJob.findFirst({
      where: {
        ...scope,
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
        ...scope,
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

function parseChoices(value: string | null | undefined) {
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

function normalizeTemplatePayload(
  value:
    | {
        name: string;
        languageCode?: string | null;
        components?: unknown[] | null;
        variables?: unknown[] | null;
        bodyVariables?: unknown[] | null;
        headerVariables?: unknown[] | null;
      }
    | null
    | undefined
) {
  if (!value?.name?.trim()) {
    return null;
  }

  return {
    name: value.name.trim(),
    languageCode: value.languageCode?.trim() || "en_US",
    components: Array.isArray(value.components) ? value.components : [],
    variables: Array.isArray(value.variables) ? value.variables : [],
    bodyVariables: Array.isArray(value.bodyVariables) ? value.bodyVariables : [],
    headerVariables: Array.isArray(value.headerVariables) ? value.headerVariables : []
  };
}

function parseRawPayload(rawPayload: string | null) {
  if (!rawPayload) {
    return {};
  }

  try {
    const parsed = JSON.parse(rawPayload) as Record<string, unknown>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function parseMentionsFromRawPayload(rawPayload: string | null) {
  const parsed = parseRawPayload(rawPayload);
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
}

function parseTemplateFromRawPayload(rawPayload: string | null) {
  const parsed = parseRawPayload(rawPayload);
  const template = parsed.template;

  if (!template || typeof template !== "object") {
    return null;
  }

  const record = template as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name.trim() : "";
  if (!name) {
    return null;
  }

  return {
    name,
    languageCode:
      typeof record.languageCode === "string" ? record.languageCode.trim() || "en_US" : "en_US",
    components: Array.isArray(record.components) ? record.components : [],
    variables: Array.isArray(record.variables) ? record.variables : [],
    bodyVariables: Array.isArray(record.bodyVariables) ? record.bodyVariables : [],
    headerVariables: Array.isArray(record.headerVariables) ? record.headerVariables : []
  };
}

function parseAttachmentOptionsFromRawPayload(rawPayload: string | null) {
  const parsed = parseRawPayload(rawPayload);
  const attachmentOptions =
    parsed.attachmentOptions && typeof parsed.attachmentOptions === "object"
      ? (parsed.attachmentOptions as Record<string, unknown>)
      : null;

  return {
    attachmentPath:
      typeof attachmentOptions?.attachmentPath === "string" ? attachmentOptions.attachmentPath : null,
    sendAudioAsVoice: attachmentOptions?.sendAudioAsVoice === true
  };
}

async function applyProviderBatchLimits<
  T extends {
    channelId: string | null;
    workspaceId: string;
  }
>(jobs: T[], limit: number): Promise<T[]> {
  if (jobs.length <= 1) {
    return jobs.slice(0, limit);
  }

  const channelIds = Array.from(
    new Set(jobs.map((job) => job.channelId).filter((channelId): channelId is string => Boolean(channelId)))
  );
  const channels = channelIds.length
    ? await prisma.whatsAppChannel.findMany({
        where: {
          id: {
            in: channelIds
          }
        },
        select: {
          id: true,
          phoneNumberId: true,
          accessTokenCiphertext: true
        }
      })
    : [];
  const channelKindById = new Map<string, "personal" | "cloud">(
    channels.map((channel: (typeof channels)[number]) => [
      channel.id,
      channel.phoneNumberId && channel.accessTokenCiphertext ? "cloud" : "personal"
    ] as const)
  );
  const counts = new Map<string, number>();
  const selected: T[] = [];

  for (const job of jobs) {
    const providerKind: "personal" | "cloud" =
      (job.channelId ? channelKindById.get(job.channelId) : null) ?? "personal";
    const providerLimit = getProviderBatchSize(providerKind);
    const current = counts.get(providerKind) ?? 0;

    if (current >= providerLimit || selected.length >= limit) {
      continue;
    }

    counts.set(providerKind, current + 1);
    selected.push(job);
  }

  return selected;
}

function getProviderBatchSize(providerKind: "personal" | "cloud") {
  const fallback = providerKind === "cloud" ? 50 : 20;
  const configured = Number.parseInt(
    process.env[
      providerKind === "cloud"
        ? "WHATSAPP_CLOUD_BROADCAST_BATCH_SIZE"
        : "WHATSAPP_PERSONAL_BROADCAST_BATCH_SIZE"
    ] ?? `${fallback}`,
    10
  );

  return Number.isFinite(configured) && configured > 0 ? configured : fallback;
}

function resolveOutboundMessageUsageType(input: {
  attachmentUrl?: string | null;
  interactiveButtonsJson?: string | null;
  interactiveListOptionsJson?: string | null;
  template?: { name: string } | null;
}) {
  if (input.template?.name) {
    return "template" as const;
  }

  if (input.attachmentUrl) {
    return "media" as const;
  }

  if (parseChoices(input.interactiveButtonsJson).length || parseChoices(input.interactiveListOptionsJson).length) {
    return "interactive" as const;
  }

  return "text" as const;
}

async function resolveChannelProviderKind(channelId?: string | null) {
  if (!channelId) {
    return "personal" as const;
  }

  const channel = await prisma.whatsAppChannel.findUnique({
    where: {
      id: channelId
    },
    select: {
      phoneNumberId: true,
      accessTokenCiphertext: true
    }
  });

  if (channel?.phoneNumberId && channel.accessTokenCiphertext) {
    return "cloud" as const;
  }

  return "personal" as const;
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

async function runWorkspaceSendPreflight(
  workspaceId: string,
  channelId?: string | null
): Promise<WorkspacePreflightResult> {
  const channel = await prisma.whatsAppChannel.findFirst({
    where: channelId
      ? {
          id: channelId,
          workspaceId
        }
      : {
          workspaceId
        },
    select: {
      phoneNumberId: true,
      accessTokenCiphertext: true,
      connectionStatus: true,
      sessionClientId: true
    }
  });

  if (channel?.phoneNumberId && channel.accessTokenCiphertext) {
    return { ok: true };
  }

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
