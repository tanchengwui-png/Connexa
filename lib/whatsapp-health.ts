import { prisma } from "@/lib/prisma";
import { getOutboundMessageJobStatus } from "@/lib/outbound-message-jobs";
import type { WorkspaceWhatsAppChannelStatus } from "@/lib/whatsapp-channel";
import { getWorkspaceWhatsAppRuntimeStatus } from "@/lib/whatsapp-runtime";
import { MessageDirection } from "@prisma/client";

const WHATSAPP_HISTORY_STUCK_MS = Math.max(
  60_000,
  Number.parseInt(process.env.WHATSAPP_HISTORY_STUCK_MS ?? "300000", 10) || 300000
);

const WHATSAPP_CONNECTION_STALL_MS = Math.max(
  45_000,
  Number.parseInt(process.env.WHATSAPP_CONNECTION_STALL_MS ?? "90000", 10) || 90000
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
}) {
  const [runtime, conversationCount, messageCount, workerStatus, lastInboundMessage, lastOutboundMessage] = await Promise.all([
    getWorkspaceWhatsAppRuntimeStatus({
      workspaceId: input.workspaceId,
      agentId: input.agentId
    }).catch(async (error) => {
      const fallbackChannel = await prisma.whatsAppChannel.findUnique({
        where: {
          workspaceId: input.workspaceId
        }
      });

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
        workspaceId: input.workspaceId
      }
    }),
    prisma.message.count({
      where: {
        conversation: {
          workspaceId: input.workspaceId
        }
      }
    }),
    getOutboundMessageJobStatus(input.workspaceId),
    prisma.message.findFirst({
      where: {
        direction: MessageDirection.INBOUND,
        conversation: {
          workspaceId: input.workspaceId
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
          workspaceId: input.workspaceId
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
  const isDisconnectedRuntime = runtimeStatus === "DISCONNECTED" || runtimeStatus === "AUTH_FAILED";
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
  const isLiveRuntime =
    runtimeStatus === "READY" ||
    runtimeStatus === "SYNCING_HISTORY" ||
    runtimeStatus === "CONNECTED" ||
    runtimeStatus === "AUTHENTICATED" ||
    runtimeStatus === "QR_READY" ||
    runtimeStatus === "INITIALIZING";
  const isHistoryStabilizing =
    !isDisconnectedRuntime && (runtimeStatus === "CONNECTED" || runtimeStatus === "SYNCING_HISTORY") && !hasImportedHistory;
  const isHistoryStuck =
    isHistoryStabilizing &&
    referenceTime !== null &&
    Date.now() - referenceTime >= WHATSAPP_HISTORY_STUCK_MS;
  const isLiveOnlyMode = !isDisconnectedRuntime && isHistoryStuck && isLiveRuntime;
  const isInboxReady = !isDisconnectedRuntime && (runtimeStatus === "READY" || hasImportedHistory || isLiveOnlyMode);
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
