import { prisma } from "@/lib/prisma";
import { getPreferredWhatsAppChannelLabel } from "@/lib/whatsapp-channel-label";
import { getWorkspaceWhatsAppChannels } from "@/lib/whatsapp-channel";
import { getWorkspaceWhatsAppHealth } from "@/lib/whatsapp-health";
import { WHATSAPP_RUNTIME_EVENT_TYPES } from "@/lib/whatsapp-runtime-events";
import { getWhatsAppSenderNodeMetrics } from "@/lib/whatsapp-runtime";

type SenderWorkspaceMetric = NonNullable<
  Awaited<ReturnType<typeof getWhatsAppSenderNodeMetrics>>
>["workspaces"][number];

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
        agents: {
          orderBy: [{ createdAt: "asc" }],
          take: 1,
          select: {
            id: true,
            email: true
          }
        }
      }
    }),
    getWhatsAppSenderNodeMetrics().catch(() => null)
  ]);
  type RecentEvent = (typeof recentEvents)[number];
  type PlatformWorkspace = (typeof workspaces)[number];
  const senderWorkspaceMetrics = new Map(
    (senderMetrics?.workspaces ?? []).map((workspace: SenderWorkspaceMetric) => [workspace.workspaceId, workspace])
  );

  const rows = await Promise.all(
    workspaces.map(async (workspace: PlatformWorkspace) => {
      const workspaceEvents = recentEvents.filter(
        (event: RecentEvent) => event.workspaceId === workspace.id
      );
      const workspaceChannels = await getWorkspaceWhatsAppChannels(workspace.id);
      const visibleChannels = workspaceChannels.filter(
        (channel) =>
          Boolean(channel.phoneNumber?.trim()) ||
          Boolean(channel.phoneNumberId?.trim()) ||
          Boolean(channel.sessionClientId?.trim()) ||
          Boolean(channel.displayName?.trim()) ||
          channel.connectionStatus !== "DISCONNECTED"
      );
      const primaryChannel =
        visibleChannels.find((channel) => channel.id === workspaceChannels[0]?.id) ??
        visibleChannels[0] ??
        workspaceChannels[0] ??
        null;
      const referenceAgentId =
        primaryChannel?.connectedByAgentId ?? workspace.agents[0]?.id ?? "platform-health";
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
        loginEmail: workspace.agents[0]?.email ?? null,
        createdAt: workspace.createdAt.toISOString(),
        channels: visibleChannels.map((channel, index) => ({
          id: channel.id,
          label: getPreferredWhatsAppChannelLabel({
            displayName: channel.displayName,
            phoneNumber: channel.phoneNumber,
            fallbackLabel: `Phone ${index + 1}`
          })!,
          phoneNumber: channel.phoneNumber ?? null,
          connectionStatus: channel.connectionStatus,
          connectionMethod: channel.connectionMethod,
          connectedAt: channel.connectedAt?.toISOString() ?? null,
          connectedBy:
            channel.connectedByAgentName?.trim() || null,
          lastError: channel.lastError ?? null
        })),
        phoneNumber: health.channel?.phoneNumber ?? null,
        connectedAt: health.channel?.connectedAt?.toISOString() ?? null,
        connectedBy:
          primaryChannel?.connectedByAgentName ?? null,
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
          qrEvents24h: workspaceEvents.filter(
            (event: RecentEvent) => event.eventType === WHATSAPP_RUNTIME_EVENT_TYPES.QR_READY
          ).length,
          authFailures24h: workspaceEvents.filter(
            (event: RecentEvent) => event.eventType === WHATSAPP_RUNTIME_EVENT_TYPES.AUTH_FAILURE
          ).length,
          reconnects24h: workspaceEvents.filter(
            (event: RecentEvent) =>
              event.eventType === WHATSAPP_RUNTIME_EVENT_TYPES.RECONNECT_SCHEDULED ||
              event.eventType === WHATSAPP_RUNTIME_EVENT_TYPES.STALL_RECOVERY
          ).length,
          idleEvictions24h: workspaceEvents.filter(
            (event: RecentEvent) => event.eventType === WHATSAPP_RUNTIME_EVENT_TYPES.IDLE_EVICTED
          ).length,
          latestEvents: workspaceEvents.slice(0, 3).map((event: RecentEvent) => ({
            eventType: event.eventType,
            message: event.message,
            createdAt: event.createdAt.toISOString()
          }))
        },
        alerts
      };
    })
  );
  type HealthRow = (typeof rows)[number];

  return {
    rows,
    summary: {
      totalWorkspaces: rows.length,
      connectedWorkspaces: rows.filter(
        (row: HealthRow) => row.runtimeStatus !== "DISCONNECTED" || row.phoneNumber
      ).length,
      readyWorkspaces: rows.filter((row: HealthRow) => row.isInboxReady && !row.isLiveOnlyMode).length,
      liveOnlyWorkspaces: rows.filter((row: HealthRow) => row.isLiveOnlyMode).length,
      alertWorkspaces: rows.filter((row: HealthRow) => row.alerts.length > 0).length,
      qrEvents24h: rows.reduce((sum: number, row: HealthRow) => sum + row.runtimeMetrics.qrEvents24h, 0),
      authFailures24h: rows.reduce(
        (sum: number, row: HealthRow) => sum + row.runtimeMetrics.authFailures24h,
        0
      ),
      reconnects24h: rows.reduce((sum: number, row: HealthRow) => sum + row.runtimeMetrics.reconnects24h, 0),
      idleEvictions24h: rows.reduce(
        (sum: number, row: HealthRow) => sum + row.runtimeMetrics.idleEvictions24h,
        0
      ),
      totalImportedConversations: rows.reduce(
        (sum: number, row: HealthRow) => sum + row.importedConversationCount,
        0
      ),
      totalImportedMessages: rows.reduce((sum: number, row: HealthRow) => sum + row.importedMessageCount, 0)
    },
    senderMetrics
  };
}
