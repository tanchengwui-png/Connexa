import { DashboardShell } from "@/components/dashboard-shell";
import { WhatsAppConnectionOnboarding } from "@/components/whatsapp-connection-onboarding";
import { requireManager } from "@/lib/auth/current-user";
import { getWorkspaceWhatsAppHealth } from "@/lib/whatsapp-health";
import type { WorkspaceWhatsAppChannelStatus } from "@/lib/whatsapp-channel";

export default async function WhatsAppSetupPage() {
  const manager = await requireManager();
  const health = await getWorkspaceWhatsAppHealth({
    workspaceId: manager.workspaceId,
    agentId: manager.id
  });
  const channel = health.channel as WorkspaceWhatsAppChannelStatus | null;

  return (
    <DashboardShell currentPath="/settings">
      <WhatsAppConnectionOnboarding
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
          connectionStatus: channel?.connectionStatus ?? "DISCONNECTED",
          connectedByAgentName: channel?.connectedByAgentName ?? manager.name,
          displayName: channel?.displayName ?? "",
          phoneNumber: channel?.phoneNumber ?? "",
          qrCodeDataUrl: channel?.qrCodeDataUrl ?? null,
          lastError: channel?.lastError ?? "",
          connectedAt: channel?.connectedAt?.toISOString() ?? null
        }}
      />
    </DashboardShell>
  );
}
