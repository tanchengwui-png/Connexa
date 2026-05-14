import { prisma } from "@/lib/prisma";
import { getWorkspaceWhatsAppHealth } from "@/lib/whatsapp-health";
import { WHATSAPP_RUNTIME_EVENT_TYPES } from "@/lib/whatsapp-runtime-events";
import { getWhatsAppSenderNodeMetrics } from "@/lib/whatsapp-runtime";

function getPlatformWorkspaceAlerts(input: {
  runtimeStatus: string;
  supervisor:
    | {
        requiresManualAttention?: boolean;
        manualAttentionReason?: string | null;
      }
    | null
    | undefined;
  isConnectionStalled: boolean;
  isHistoryStuck: boolean;
  isLiveOnlyMode: boolean;
  verificationState: string;
  lastSyncError: string | null;
  pendingOutbound: number;
  workerOnline: boolean;
}) {
  const alerts: string[] = [];

  if (input.runtimeStatus === "AUTH_FAILED" || input.runtimeStatus === "QR_READY") {
    alerts.push("QR session needs relink");
  } else if (input.runtimeStatus === "ERROR") {
    alerts.push("Sender runtime reported an error");
  }

  if (input.supervisor?.requiresManualAttention && input.supervisor.manualAttentionReason) {
    alerts.push(input.supervisor.manualAttentionReason);
  }

  if (input.isConnectionStalled) {
    alerts.push("Session stalled during reconnect");
  }

  if (input.isHistoryStuck) {
    alerts.push("Historical import looks stuck");
  }

  if (input.isLiveOnlyMode) {
    alerts.push("Running in live-only mode");
  }

  if (input.pendingOutbound > 0 && !input.workerOnline && input.runtimeStatus !== "QR_READY") {
    alerts.push("Outbound worker is offline with queued jobs");
  }

  if (
    input.lastSyncError &&
    !input.lastSyncError.toLowerCase().includes("deferred") &&
    !input.lastSyncError.toLowerCase().includes("preparing chat history")
  ) {
    alerts.push(input.lastSyncError);
  }

  if (input.verificationState === "unverified" && (input.isLiveOnlyMode || input.runtimeStatus === "READY")) {
    alerts.push("No live inbound or outbound traffic verified yet");
  }

  return alerts;
}

export async function getPlatformWhatsAppHealthOverview() {
  const recentWindowStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [recentEvents, workspaces, senderMetrics] = await Promise.all([
    prisma.whatsAppRuntimeEvent.findMany({
      where: {
        createdAt: {
          gte: recentWindowStart
        }
      },
      orderBy: [{ createdAt: "desc" }],
      select: {
        workspaceId: true,
        eventType: true,
        message: true,
        createdAt: true
      },
      take: 2000
    }),
    prisma.workspace.findMany({
      orderBy: [{ createdAt: "asc" }],
      select: {
        id: true,
        name: true,
        slug: true,
        plan: true,
        createdAt: true,
        whatsAppChannel: {
          select: {
            connectedByAgentId: true,
            connectedByAgent: {
              select: {
                id: true,
                name: true,
                email: true
              }
            }
          }
        },
        agents: {
          orderBy: [{ createdAt: "asc" }],
          take: 1,
          select: {
            id: true
          }
        }
      }
    }),
    getWhatsAppSenderNodeMetrics().catch(() => null)
  ]);
  const senderWorkspaceMetrics = new Map(
    (senderMetrics?.workspaces ?? []).map((workspace) => [workspace.workspaceId, workspace])
  );

  const rows = await Promise.all(
    workspaces.map(async (workspace) => {
      const workspaceEvents = recentEvents.filter((event) => event.workspaceId === workspace.id);
      const referenceAgentId =
        workspace.whatsAppChannel?.connectedByAgentId ?? workspace.agents[0]?.id ?? "platform-health";
      const health = await getWorkspaceWhatsAppHealth({
        workspaceId: workspace.id,
        agentId: referenceAgentId
      });
      const workerOnline = Boolean(health.workerStatus.heartbeat?.isOnline);
      const alerts = getPlatformWorkspaceAlerts({
        runtimeStatus: health.runtimeStatus,
        supervisor: health.supervisor,
        isConnectionStalled: health.isConnectionStalled,
        isHistoryStuck: health.isHistoryStuck,
        isLiveOnlyMode: health.isLiveOnlyMode,
        verificationState: health.verificationState,
        lastSyncError: health.lastSyncError,
        pendingOutbound: health.workerStatus.pending,
        workerOnline
      });
      const workspaceSenderMetrics = senderWorkspaceMetrics.get(workspace.id) ?? null;

      return {
        id: workspace.id,
        name: workspace.name,
        slug: workspace.slug,
        plan: workspace.plan,
        createdAt: workspace.createdAt.toISOString(),
        phoneNumber: health.channel?.phoneNumber ?? null,
        connectedAt: health.channel?.connectedAt?.toISOString() ?? null,
        connectedBy:
          workspace.whatsAppChannel?.connectedByAgent?.name && workspace.whatsAppChannel.connectedByAgent.email
            ? `${workspace.whatsAppChannel.connectedByAgent.name} (${workspace.whatsAppChannel.connectedByAgent.email})`
            : workspace.whatsAppChannel?.connectedByAgent?.name ?? null,
        hasSession:
          Boolean(health.channel?.sessionClientId) ||
          Boolean(health.channel?.phoneNumber) ||
          health.runtimeStatus !== "DISCONNECTED",
        runtimeStatus: health.runtimeStatus,
        supervisor: health.supervisor,
        isConnectionStalled: health.isConnectionStalled,
        isInboxReady: health.isInboxReady,
        isHistoryStabilizing: health.isHistoryStabilizing,
        isHistoryStuck: health.isHistoryStuck,
        isLiveOnlyMode: health.isLiveOnlyMode,
        importedConversationCount: health.importedConversationCount,
        importedMessageCount: health.importedMessageCount,
        lastInboundAt: health.lastInboundAt,
        lastOutboundAt: health.lastOutboundAt,
        verificationState: health.verificationState,
        lastSyncError: health.lastSyncError,
        workerStatus: health.workerStatus,
        senderMetrics: workspaceSenderMetrics,
        runtimeMetrics: {
          lastEventAt: workspaceEvents[0]?.createdAt.toISOString() ?? null,
          qrEvents24h: workspaceEvents.filter((event) => event.eventType === WHATSAPP_RUNTIME_EVENT_TYPES.QR_READY)
            .length,
          authFailures24h: workspaceEvents.filter(
            (event) => event.eventType === WHATSAPP_RUNTIME_EVENT_TYPES.AUTH_FAILURE
          ).length,
          reconnects24h: workspaceEvents.filter(
            (event) =>
              event.eventType === WHATSAPP_RUNTIME_EVENT_TYPES.RECONNECT_SCHEDULED ||
              event.eventType === WHATSAPP_RUNTIME_EVENT_TYPES.STALL_RECOVERY
          ).length,
          idleEvictions24h: workspaceEvents.filter(
            (event) => event.eventType === WHATSAPP_RUNTIME_EVENT_TYPES.IDLE_EVICTED
          ).length,
          latestEvents: workspaceEvents.slice(0, 3).map((event) => ({
            eventType: event.eventType,
            message: event.message,
            createdAt: event.createdAt.toISOString()
          }))
        },
        alerts
      };
    })
  );

  return {
    rows,
    summary: {
      totalWorkspaces: rows.length,
      connectedWorkspaces: rows.filter((row) => row.runtimeStatus !== "DISCONNECTED" || row.phoneNumber).length,
      readyWorkspaces: rows.filter((row) => row.isInboxReady && !row.isLiveOnlyMode).length,
      liveOnlyWorkspaces: rows.filter((row) => row.isLiveOnlyMode).length,
      alertWorkspaces: rows.filter((row) => row.alerts.length > 0).length,
      qrEvents24h: rows.reduce((sum, row) => sum + row.runtimeMetrics.qrEvents24h, 0),
      authFailures24h: rows.reduce((sum, row) => sum + row.runtimeMetrics.authFailures24h, 0),
      reconnects24h: rows.reduce((sum, row) => sum + row.runtimeMetrics.reconnects24h, 0),
      idleEvictions24h: rows.reduce((sum, row) => sum + row.runtimeMetrics.idleEvictions24h, 0),
      totalImportedConversations: rows.reduce((sum, row) => sum + row.importedConversationCount, 0),
      totalImportedMessages: rows.reduce((sum, row) => sum + row.importedMessageCount, 0)
    },
    senderMetrics
  };
}
