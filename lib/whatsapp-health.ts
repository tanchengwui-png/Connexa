import { prisma } from "@/lib/prisma";
import { getOutboundMessageJobStatus } from "@/lib/outbound-message-jobs";
import { MessageDirection } from "@/lib/db-types";
import type { WorkspaceWhatsAppChannelStatus } from "@/lib/whatsapp-channel";
import { getWhatsAppChannelStatusById, getWorkspaceWhatsAppChannelStatus } from "@/lib/whatsapp-channel";
import {
  isWhatsAppConnectedRuntimeStatus,
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

export async function getWorkspaceWhatsAppHealth(input: {
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
        runtimeStatus: "DISCONNECTED",
        lastError:
          error instanceof Error
            ? error.message
            : "Unable to reach WhatsApp runtime status.",
        connectedByCurrentAgent: fallbackChannel?.connectedByAgentId === input.agentId,
        isSyncingHistory: false,
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
  const isDisconnectedRuntime = isWhatsAppDisconnectedRuntimeStatus(runtimeStatus);
  const isIntermediateRuntime = runtimeStatus === "INITIALIZING" || runtimeStatus === "AUTHENTICATED";
  const hasImportedHistory = conversationCount > 0 || messageCount > 0;
  const connectedAtTime = getDateTimestamp(channel?.connectedAt);
  const updatedAtTime = getDateTimestamp(channel?.updatedAt);
  const referenceTime = connectedAtTime ?? updatedAtTime;
  const intermediateReferenceTime = updatedAtTime ?? connectedAtTime;
  const isConnectionStalled =
    isIntermediateRuntime &&
    intermediateReferenceTime !== null &&
    Date.now() - intermediateReferenceTime >= WHATSAPP_CONNECTION_STALL_MS;
  const isLiveRuntime = isWhatsAppConnectedRuntimeStatus(runtimeStatus);
  const isHistoryStabilizing =
    !isDisconnectedRuntime && (runtimeStatus === "CONNECTED" || runtimeStatus === "SYNCING_HISTORY") && !hasImportedHistory;
  const isHistoryStuck =
    isHistoryStabilizing &&
    referenceTime !== null &&
    Date.now() - referenceTime >= WHATSAPP_HISTORY_STUCK_MS;
  const isLiveOnlyMode = false;
  const isInboxReady = !isDisconnectedRuntime && (runtimeStatus === "READY" || hasImportedHistory);
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
    channel,
    supervisor: runtime.supervisor ?? null,
    isLiveRuntime,
    isConnectionStalled,
    isInboxReady,
    isHistoryStabilizing,
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
    lastSyncError: runtime.lastError ?? channel?.lastError ?? null,
    workerStatus
  };
}

export type WorkspaceWhatsAppHealth = Awaited<ReturnType<typeof getWorkspaceWhatsAppHealth>>;

export async function getWorkspaceWhatsAppHealthForPage(input: {
  workspaceId: string;
  agentId: string;
  channelId?: string | null;
  fallbackChannel?: WorkspaceWhatsAppChannelStatus | null;
  timeoutMs?: number;
}): Promise<WorkspaceWhatsAppHealth> {
  const timeoutMs = Math.max(1000, input.timeoutMs ?? WHATSAPP_PAGE_HEALTH_TIMEOUT_MS);
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
  const isLiveRuntime = isWhatsAppConnectedRuntimeStatus(runtimeStatus);
  const isHistoryStabilizing = runtimeStatus === "CONNECTED" || runtimeStatus === "SYNCING_HISTORY";

  return {
    runtimeStatus,
    channel,
    supervisor: null,
    isLiveRuntime,
    isConnectionStalled: false,
    isInboxReady: !isDisconnectedRuntime && runtimeStatus === "READY",
    isHistoryStabilizing,
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
