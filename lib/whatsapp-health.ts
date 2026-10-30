import { prisma } from "@/lib/prisma";
import { getOutboundMessageJobStatus } from "@/lib/outbound-message-jobs";
import { MessageDirection } from "@/lib/db-types";
import type { WorkspaceWhatsAppChannelStatus } from "@/lib/whatsapp-channel";
import { getWhatsAppChannelStatusById, getWorkspaceWhatsAppChannelStatus } from "@/lib/whatsapp-channel";
import {
  isWhatsAppDisconnectedRuntimeStatus
} from "@/lib/whatsapp-runtime-status";
import { getWorkspaceWhatsAppRuntimeStatus } from "@/lib/whatsapp-runtime";

const WHATSAPP_HISTORY_STUCK_MS = Math.max(
  60_000,
  Number.parseInt(process.env.WHATSAPP_HISTORY_STUCK_MS ?? "300000", 10) || 300000
);

const WHATSAPP_CONNECTION_STALL_MS = Math.max(
  45_000,
  Number.parseInt(process.env.WHATSAPP_CONNECTION_STALL_MS ?? "90000", 10) || 90000
);

const WHATSAPP_PAGE_HEALTH_TIMEOUT_MS = Math.max(
  1000,
  Number.parseInt(process.env.WHATSAPP_PAGE_HEALTH_TIMEOUT_MS ?? "3000", 10) || 3000
);

function getDateTimestamp(value: Date | string | null | undefined) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.getTime();
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
}

async function loadWorkspaceWhatsAppHealth(input: {
  workspaceId: string;
  agentId: string;
  channelId?: string | null;
}) {
  const [runtime, conversationCount, messageCount, workerStatus, lastInboundMessage, lastOutboundMessage] = await Promise.all([
    getWorkspaceWhatsAppRuntimeStatus({
      workspaceId: input.workspaceId,
      agentId: input.agentId,
      channelId: input.channelId ?? null
    }).catch(async (error) => {
      const fallbackChannel = input.channelId
        ? await getWhatsAppChannelStatusById(input.channelId)
        : await getWorkspaceWhatsAppChannelStatus(input.workspaceId);

      return {
        channel: fallbackChannel,
        runtimeStatus: fallbackChannel?.connectionStatus ?? "DISCONNECTED",
        runtimePresent: false,
        userConnectionState: "unknown" as const,
        runtimeHealthStatus: fallbackChannel?.runtimeHealthStatus ?? "UNKNOWN",
        lastHealthCheckAt: fallbackChannel?.latestHealthCheckAt?.toISOString() ?? null,
        lastHealthyAt: fallbackChannel?.lastHealthyAt?.toISOString() ?? null,
        nextRecoveryAt: fallbackChannel?.nextRecoveryAt?.toISOString() ?? null,
        senderReachable: false,
        senderError:
          error instanceof Error
            ? error.message
            : "Unable to reach WhatsApp runtime status.",
        qrCodeDataUrl: null,
        qrCodeGeneratedAt: null,
        qrCodeExpiresAt: null,
        qrCodeExpired: fallbackChannel?.connectionStatus === "QR_READY",
        lastError:
          error instanceof Error
            ? error.message
            : "Unable to reach WhatsApp runtime status.",
        connectedByCurrentAgent: fallbackChannel?.connectedByAgentId === input.agentId,
        isSyncingHistory: false,
        historySyncFullyCaughtUp: false,
        historySyncCursor: 0,
        historySyncTotal: null,
        historySyncProgressAt: null,
        historySync: null,
        supervisor: null
      };
    }),
    prisma.conversation.count({
      where: {
        workspaceId: input.workspaceId,
        ...(input.channelId ? { channelId: input.channelId } : {})
      }
    }),
    prisma.message.count({
      where: {
        conversation: {
          workspaceId: input.workspaceId,
          ...(input.channelId ? { channelId: input.channelId } : {})
        }
      }
    }),
    getOutboundMessageJobStatus(input.workspaceId, input.channelId ?? null),
    prisma.message.findFirst({
      where: {
        direction: MessageDirection.INBOUND,
        conversation: {
          workspaceId: input.workspaceId,
          ...(input.channelId ? { channelId: input.channelId } : {})
        }
      },
      orderBy: {
        sentAt: "desc"
      },
      select: {
        sentAt: true
      }
    }),
    prisma.message.findFirst({
      where: {
        direction: MessageDirection.OUTBOUND,
        conversation: {
          workspaceId: input.workspaceId,
          ...(input.channelId ? { channelId: input.channelId } : {})
        }
      },
      orderBy: {
        sentAt: "desc"
      },
      select: {
        sentAt: true
      }
    })
  ]);

  const channel = runtime.channel as WorkspaceWhatsAppChannelStatus | null;
  const runtimeStatus = runtime.runtimeStatus ?? channel?.connectionStatus ?? "DISCONNECTED";
  const historySync = runtime.historySync;
  const historySyncTotalChats = historySync?.totalChats ?? runtime.historySyncTotal ?? null;
  const historySyncProcessedChats = Math.max(0, historySync?.processedChats ?? runtime.historySyncCursor ?? 0);
  const historySyncFullyCaughtUp = historySync
    ? historySync.phase === "idle" && Boolean(historySync.lastSuccessfulSyncAt)
    : runtime.historySyncFullyCaughtUp === true;
  const isHistorySyncInProgress = historySync?.active === true;
  const lastSyncError = historySync?.lastError ?? runtime.lastError ?? channel?.lastError ?? null;
  const hasDeferredHistory = historySync?.phase === "deferred";
  const isDisconnectedRuntime = isWhatsAppDisconnectedRuntimeStatus(runtimeStatus);
  const isIntermediateRuntime = runtimeStatus === "INITIALIZING" || runtimeStatus === "AUTHENTICATED";
  const hasImportedHistory = conversationCount > 0 || messageCount > 0;
  const connectedAtTime = getDateTimestamp(channel?.connectedAt);
  const updatedAtTime = getDateTimestamp(channel?.updatedAt);
  const historySyncProgressAtTime = getDateTimestamp(historySync?.progressAt ?? runtime.historySyncProgressAt);
  // Channel writes happen at batch boundaries, while a large batch can spend
  // minutes importing individual chats. Runtime progress is the authoritative
  // signal that the importer is still moving and prevents false stuck alerts.
  const referenceTimes = [connectedAtTime, updatedAtTime, historySyncProgressAtTime].filter(
    (value): value is number => value !== null
  );
  const referenceTime = referenceTimes.length > 0 ? Math.max(...referenceTimes) : null;
  const intermediateReferenceTime = updatedAtTime ?? connectedAtTime;
  const isConnectionStalled =
    isIntermediateRuntime &&
    intermediateReferenceTime !== null &&
    Date.now() - intermediateReferenceTime >= WHATSAPP_CONNECTION_STALL_MS;
  const userConnectionState = runtime.userConnectionState ?? "unknown";
  const isLiveRuntime = userConnectionState === "connected";
  const isHistoryStabilizing =
    !isDisconnectedRuntime &&
    !hasDeferredHistory &&
    isHistorySyncInProgress;
  const isHistoryStuck =
    !hasDeferredHistory &&
    isHistoryStabilizing &&
    referenceTime !== null &&
    Date.now() - referenceTime >= WHATSAPP_HISTORY_STUCK_MS;
  const isLiveOnlyMode = !isDisconnectedRuntime && hasDeferredHistory && !hasImportedHistory;
  const isInboxReady =
    userConnectionState === "connected" &&
    !isDisconnectedRuntime &&
    (["CONNECTED", "READY", "SYNCING_HISTORY"].includes(runtimeStatus) || hasImportedHistory || isLiveOnlyMode);
  const hasRecentInbound = Boolean(lastInboundMessage);
  const hasRecentOutbound = Boolean(lastOutboundMessage);
  const verificationState =
    hasRecentInbound && hasRecentOutbound
      ? "two_way_live"
      : hasRecentInbound
        ? "inbound_live"
        : hasRecentOutbound
          ? "outbound_live"
          : "unverified";

  return {
    runtimeStatus,
    runtimePresent: runtime.runtimePresent === true,
    userConnectionState,
    runtimeHealthStatus: runtime.runtimeHealthStatus ?? channel?.runtimeHealthStatus ?? "UNKNOWN",
    lastHealthCheckAt: runtime.lastHealthCheckAt ?? channel?.latestHealthCheckAt?.toISOString() ?? null,
    lastHealthyAt: runtime.lastHealthyAt ?? channel?.lastHealthyAt?.toISOString() ?? null,
    nextRecoveryAt: runtime.nextRecoveryAt ?? channel?.nextRecoveryAt?.toISOString() ?? null,
    senderReachable: runtime.senderReachable !== false,
    senderError: runtime.senderError ?? null,
    qrCodeDataUrl: runtime.qrCodeDataUrl ?? null,
    qrCodeGeneratedAt: runtime.qrCodeGeneratedAt ?? null,
    qrCodeExpiresAt: runtime.qrCodeExpiresAt ?? null,
    qrCodeExpired: runtime.qrCodeExpired === true,
    channel,
    supervisor: runtime.supervisor ?? null,
    isLiveRuntime,
    isConnectionStalled,
    isInboxReady,
    isHistoryStabilizing,
    historySyncFullyCaughtUp,
    historySyncProcessedChats,
    historySyncTotalChats,
    historySyncPhase: historySync?.phase ?? (isDisconnectedRuntime ? "disconnected" : isHistorySyncInProgress ? "reconcile" : "idle"),
    historySyncActive: isHistorySyncInProgress,
    historySyncStartedAt: historySync?.startedAt ?? null,
    historySyncProgressAt: historySync?.progressAt ?? runtime.historySyncProgressAt ?? null,
    historySyncLastSuccessfulAt: historySync?.lastSuccessfulSyncAt ?? null,
    historySyncNextReconciliationAt: historySync?.nextReconciliationAt ?? null,
    historySyncRemainingChats: historySync?.remainingChats ?? 0,
    historySyncDeferredChats: historySync?.deferredChats ?? 0,
    historySyncNewMessages: historySync?.newMessages ?? 0,
    isHistoryStuck,
    isLiveOnlyMode,
    hasImportedHistory,
    hasRecentInbound,
    hasRecentOutbound,
    lastInboundAt: lastInboundMessage?.sentAt.toISOString() ?? null,
    lastOutboundAt: lastOutboundMessage?.sentAt.toISOString() ?? null,
    verificationState,
    importedConversationCount: conversationCount,
    importedMessageCount: messageCount,
    lastSyncError,
    workerStatus
  };
}

const whatsAppHealthCache = new Map<
  string,
  { expiresAt: number; promise: ReturnType<typeof loadWorkspaceWhatsAppHealth> }
>();

export function getWorkspaceWhatsAppHealth(input: {
  workspaceId: string;
  agentId: string;
  channelId?: string | null;
}) {
  const ttlMs = Math.max(
    500,
    Number.parseInt(process.env.WHATSAPP_HEALTH_CACHE_TTL_MS ?? "5000", 10) || 5000
  );
  const key = `${input.workspaceId}:${input.channelId ?? "default"}:${input.agentId}`;
  const cached = whatsAppHealthCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;

  const promise = loadWorkspaceWhatsAppHealth(input).catch((error) => {
    if (whatsAppHealthCache.get(key)?.promise === promise) whatsAppHealthCache.delete(key);
    throw error;
  });
  whatsAppHealthCache.set(key, { expiresAt: Date.now() + ttlMs, promise });
  return promise;
}

export type WorkspaceWhatsAppHealth = Awaited<ReturnType<typeof getWorkspaceWhatsAppHealth>>;

export async function getWorkspaceWhatsAppHealthForPage(input: {
  workspaceId: string;
  agentId: string;
  channelId?: string | null;
  fallbackChannel?: WorkspaceWhatsAppChannelStatus | null;
  timeoutMs?: number;
}): Promise<WorkspaceWhatsAppHealth> {
  const timeoutMs = Math.max(100, input.timeoutMs ?? WHATSAPP_PAGE_HEALTH_TIMEOUT_MS);
  const healthPromise = getWorkspaceWhatsAppHealth({
    workspaceId: input.workspaceId,
    agentId: input.agentId,
    channelId: input.channelId ?? null
  }).catch((error) => buildPageHealthFallback(input.fallbackChannel ?? null, getHealthErrorMessage(error)));

  let timeout: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<WorkspaceWhatsAppHealth>((resolve) => {
    timeout = setTimeout(() => {
      resolve(
        buildPageHealthFallback(
          input.fallbackChannel ?? null,
          `WhatsApp health check timed out after ${timeoutMs}ms. Showing the latest saved channel status.`
        )
      );
    }, timeoutMs);
  });

  try {
    return await Promise.race([healthPromise, timeoutPromise]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function getHealthErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unable to load WhatsApp health. Showing the latest saved channel status.";
}

function buildPageHealthFallback(
  channel: WorkspaceWhatsAppChannelStatus | null,
  lastSyncError: string | null
): WorkspaceWhatsAppHealth {
  const runtimeStatus = channel?.connectionStatus ?? "DISCONNECTED";
  const isDisconnectedRuntime = isWhatsAppDisconnectedRuntimeStatus(runtimeStatus);
  const isLiveRuntime = false;
  const isHistoryStabilizing = runtimeStatus === "CONNECTED" || runtimeStatus === "SYNCING_HISTORY";

  return {
    runtimeStatus,
    runtimePresent: false,
    userConnectionState: "unknown",
    runtimeHealthStatus: channel?.runtimeHealthStatus ?? "UNKNOWN",
    lastHealthCheckAt: channel?.latestHealthCheckAt?.toISOString() ?? null,
    lastHealthyAt: channel?.lastHealthyAt?.toISOString() ?? null,
    nextRecoveryAt: channel?.nextRecoveryAt?.toISOString() ?? null,
    senderReachable: false,
    senderError: lastSyncError,
    qrCodeDataUrl: null,
    qrCodeGeneratedAt: null,
    qrCodeExpiresAt: null,
    qrCodeExpired: channel?.connectionStatus === "QR_READY",
    channel,
    supervisor: null,
    isLiveRuntime,
    isConnectionStalled: false,
    isInboxReady: !isDisconnectedRuntime && ["CONNECTED", "READY", "SYNCING_HISTORY"].includes(runtimeStatus),
    isHistoryStabilizing,
    historySyncFullyCaughtUp: false,
    historySyncProcessedChats: 0,
    historySyncTotalChats: null,
    historySyncPhase: isDisconnectedRuntime ? "disconnected" : "idle",
    historySyncActive: false,
    historySyncStartedAt: null,
    historySyncProgressAt: null,
    historySyncLastSuccessfulAt: null,
    historySyncNextReconciliationAt: null,
    historySyncRemainingChats: 0,
    historySyncDeferredChats: 0,
    historySyncNewMessages: 0,
    isHistoryStuck: false,
    isLiveOnlyMode: false,
    hasImportedHistory: false,
    hasRecentInbound: false,
    hasRecentOutbound: false,
    lastInboundAt: null,
    lastOutboundAt: null,
    verificationState: "unverified",
    importedConversationCount: 0,
    importedMessageCount: 0,
    lastSyncError,
    workerStatus: {
      pending: 0,
      running: 0,
      sent: 0,
      failed: 0,
      oldestPendingAt: null,
      latestFailure: null,
      heartbeat: null
    }
  };
}
