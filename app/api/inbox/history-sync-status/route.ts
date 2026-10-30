import { NextResponse } from "next/server";
import { requireCurrentApiAgent } from "@/lib/auth/current-user";
import { getWorkspaceWhatsAppChannels } from "@/lib/whatsapp-channel";
import { getPreferredWhatsAppChannelLabel } from "@/lib/whatsapp-channel-label";
import { getWorkspaceWhatsAppRuntimeStatus } from "@/lib/whatsapp-runtime";
import { isWhatsAppConnectedRuntimeStatus } from "@/lib/whatsapp-runtime-status";

export async function GET() {
  try {
    const agent = await requireCurrentApiAgent();
    const channels = (await getWorkspaceWhatsAppChannels(agent.workspaceId)).filter(
      (channel) =>
        channel.connectionMethod === "web" &&
        Boolean(channel.sessionClientId) &&
        isWhatsAppConnectedRuntimeStatus(channel.connectionStatus)
    );

    const channelStatuses = await Promise.all(
      channels.map(async (channel) => {
        const runtime = await getWorkspaceWhatsAppRuntimeStatus({
          workspaceId: agent.workspaceId,
          agentId: agent.id,
          channelId: channel.id
        }).catch(() => null);
        const runtimeStatus = runtime?.runtimeStatus ?? channel.connectionStatus;
        const historySync = runtime?.historySync ?? null;
        const completedAt = historySync?.lastSuccessfulSyncAt ?? runtime?.historySyncCompletedAt ?? null;
        const isCaughtUp =
          historySync?.phase === "idle" &&
          historySync.active !== true &&
          runtimeStatus === "READY" &&
          Boolean(completedAt);

        return {
          channelId: channel.id,
          channelLabel:
            getPreferredWhatsAppChannelLabel({
              displayName: channel.displayName,
              phoneNumber: channel.phoneNumber,
              fallbackLabel: `Channel ${channel.id.slice(0, 8)}`
            }) ?? `Channel ${channel.id.slice(0, 8)}`,
          runtimeStatus,
          phase: historySync?.phase ?? (runtimeStatus === "READY" ? "idle" : "disconnected"),
          active: historySync?.active ?? runtime?.isSyncingHistory === true,
          isCaughtUp,
          completedAt,
          startedAt: historySync?.startedAt ?? null,
          progressAt: historySync?.progressAt ?? runtime?.historySyncProgressAt ?? null,
          lastSuccessfulSyncAt: historySync?.lastSuccessfulSyncAt ?? completedAt,
          nextReconciliationAt: historySync?.nextReconciliationAt ?? null,
          totalChats: historySync?.totalChats ?? runtime?.historySyncTotal ?? null,
          processedChats: historySync?.processedChats ?? runtime?.historySyncCursor ?? 0,
          remainingChats: historySync?.remainingChats ?? 0,
          deferredChats: historySync?.deferredChats ?? 0,
          newMessages: historySync?.newMessages ?? 0,
          knownMessages: historySync?.knownMessages ?? 0,
          updatedMessages: historySync?.updatedMessages ?? 0,
          skippedMessages: historySync?.skippedMessages ?? 0,
          mediaDownloadsAvoided: historySync?.mediaDownloadsAvoided ?? 0,
          databaseWritesAvoided: historySync?.databaseWritesAvoided ?? 0,
          lastError: historySync?.lastError ?? runtime?.lastError ?? channel.lastError ?? null
        };
      })
    );

    const isCaughtUp =
      channelStatuses.length > 0 && channelStatuses.every((channel) => channel.isCaughtUp);
    const version = isCaughtUp
      ? channelStatuses
          .map((channel) => `${channel.channelId}:${channel.completedAt}`)
          .sort()
          .join("|")
      : null;

    return NextResponse.json(
      {
        checkedAt: new Date().toISOString(),
        isCaughtUp,
        version,
        channels: channelStatuses
      },
      {
        headers: {
          "cache-control": "no-store"
        }
      }
    );
  } catch (error) {
    const isUnauthorized =
      error instanceof Error &&
      (error.message === "UNAUTHORIZED" || error.message === "EMAIL_NOT_VERIFIED");
    return NextResponse.json(
      { error: isUnauthorized ? "Unauthorized." : "Unable to check WhatsApp history sync." },
      { status: isUnauthorized ? 401 : 500 }
    );
  }
}
