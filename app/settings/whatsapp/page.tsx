import { DashboardShell } from "@/components/dashboard-shell";
import { WhatsAppConnectionOnboarding } from "@/components/whatsapp-connection-onboarding";
import { requireManager } from "@/lib/auth/current-user";
import { getMetaEmbeddedSignupConfig } from "@/lib/meta-whatsapp";
import { getPreferredWhatsAppChannelLabel } from "@/lib/whatsapp-channel-label";
import {
  ensureWorkspaceDefaultWhatsAppChannel,
  getWorkspaceWhatsAppChannels,
  type WorkspaceWhatsAppChannelStatus
} from "@/lib/whatsapp-channel";
import { getWorkspaceWhatsAppHealthForPage } from "@/lib/whatsapp-health";

type WhatsAppSetupPageProps = {
  searchParams?: Promise<{
    channelId?: string;
  }>;
};

function formatChannelLabel(channel: {
  id: string;
  displayName: string | null;
  phoneNumber: string | null;
}, index: number) {
  return getPreferredWhatsAppChannelLabel({
    displayName: channel.displayName,
    phoneNumber: channel.phoneNumber,
    fallbackLabel: `Number ${index + 1}`
  })!;
}

export default async function WhatsAppSetupPage({ searchParams }: WhatsAppSetupPageProps) {
  const manager = await requireManager();
  const params = searchParams ? await searchParams : undefined;
  await ensureWorkspaceDefaultWhatsAppChannel(manager.workspaceId);
  const channels = await getWorkspaceWhatsAppChannels(manager.workspaceId);
  const requestedChannelId = params?.channelId?.trim() || null;
  type WhatsAppChannel = (typeof channels)[number];
  const selectedChannel = channels.find((channel: WhatsAppChannel) => channel.id === requestedChannelId) ?? null;
  const health = await getWorkspaceWhatsAppHealthForPage({
    workspaceId: manager.workspaceId,
    agentId: manager.id,
    channelId: selectedChannel?.id ?? null,
    fallbackChannel: selectedChannel
  });
  const channel = health.channel as WorkspaceWhatsAppChannelStatus | null;
  const embeddedSignup = await getMetaEmbeddedSignupConfig();

  return (
    <DashboardShell currentPath="/settings">
      <WhatsAppConnectionOnboarding
        channelSelectionBasePath="/settings/whatsapp"
        channels={channels.map((entry: WhatsAppChannel, index: number) => ({
          id: entry.id,
          label: formatChannelLabel(entry, index),
          connectionMethod: entry.connectionMethod,
          connectionStatus: entry.connectionStatus,
          phoneNumber: entry.phoneNumber ?? null
        }))}
        health={{
          runtimeStatus: health.runtimeStatus,
          isConnectionStalled: health.isConnectionStalled,
          isInboxReady: health.isInboxReady,
          isHistoryStabilizing: health.isHistoryStabilizing,
          isHistoryStuck: health.isHistoryStuck,
          isLiveOnlyMode: health.isLiveOnlyMode,
          importedConversationCount: health.importedConversationCount,
          importedMessageCount: health.importedMessageCount,
          lastSyncError: health.lastSyncError
        }}
        initialWebSetup={{
          id: selectedChannel?.id ?? "",
          connectionMethod: selectedChannel?.connectionMethod ?? channel?.connectionMethod ?? "web",
          connectionStatus: selectedChannel?.connectionStatus ?? channel?.connectionStatus ?? "DISCONNECTED",
          connectedByAgentName: selectedChannel?.connectedByAgentName ?? channel?.connectedByAgentName ?? manager.name,
          displayName: selectedChannel?.displayName ?? channel?.displayName ?? "",
          phoneNumber: selectedChannel?.phoneNumber ?? channel?.phoneNumber ?? "",
          phoneNumberId: selectedChannel?.phoneNumberId ?? null,
          businessAccountId: selectedChannel?.businessAccountId ?? null,
          accessTokenLastFour: selectedChannel?.accessTokenLastFour ?? null,
          verifyTokenLastFour: selectedChannel?.verifyTokenLastFour ?? null,
          qrCodeDataUrl: channel?.qrCodeDataUrl ?? null,
          lastError: selectedChannel?.lastError ?? channel?.lastError ?? "",
          connectedAt: selectedChannel?.connectedAt?.toISOString() ?? channel?.connectedAt?.toISOString() ?? null
        }}
        metaEmbeddedSignup={embeddedSignup}
        selectedChannelId={selectedChannel?.id ?? null}
        workspaceId={manager.workspaceId}
      />
    </DashboardShell>
  );
}
