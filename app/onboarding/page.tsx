import { DashboardShell } from "@/components/dashboard-shell";
import { WhatsAppConnectionOnboarding } from "@/components/whatsapp-connection-onboarding";
import { requireManager } from "@/lib/auth/current-user";
import { getMetaEmbeddedSignupConfig } from "@/lib/meta-whatsapp";
import { getPreferredWhatsAppChannelLabel } from "@/lib/whatsapp-channel-label";
import {
  ensureWorkspaceDefaultWhatsAppChannel,
  getWorkspaceWhatsAppChannels
} from "@/lib/whatsapp-channel";
import { resolveWhatsAppQrPresentation } from "@/lib/whatsapp-qr-state";

type OnboardingPageProps = {
  searchParams?: Promise<{
    channelId?: string;
  }>;
};

function formatChannelLabel(channel: {
  displayName: string | null;
  id: string;
  phoneNumber: string | null;
}, index: number) {
  return getPreferredWhatsAppChannelLabel({
    displayName: channel.displayName,
    phoneNumber: channel.phoneNumber,
    fallbackLabel: `Number ${index + 1}`
  })!;
}

export default async function OnboardingPage({ searchParams }: OnboardingPageProps) {
  const manager = await requireManager();
  const params = searchParams ? await searchParams : undefined;
  await ensureWorkspaceDefaultWhatsAppChannel(manager.workspaceId);
  const [channels, embeddedSignup] = await Promise.all([
    getWorkspaceWhatsAppChannels(manager.workspaceId),
    getMetaEmbeddedSignupConfig(manager.workspaceId)
  ]);
  const requestedChannelId = params?.channelId?.trim() || null;
  type WhatsAppChannel = (typeof channels)[number];
  // The guided flow normally has one channel. Select it server-side so the
  // browser does not render once, push ?channelId, and refresh the whole page
  // before pairing can even start.
  const selectedChannel =
    channels.find((channel: WhatsAppChannel) => channel.id === requestedChannelId) ??
    (!requestedChannelId && channels.length === 1 ? channels[0] : null);
  const runtimeStatus = selectedChannel?.connectionStatus ?? "DISCONNECTED";
  const qr = resolveWhatsAppQrPresentation({
    runtimePresent: runtimeStatus === "QR_READY",
    runtimeStatus,
    qrCodeDataUrl: selectedChannel?.qrCodeDataUrl ?? null,
    qrCodeGeneratedAt: selectedChannel?.qrCodeUpdatedAt ?? null
  });
  const isConnected = ["CONNECTED", "READY", "SYNCING_HISTORY"].includes(runtimeStatus);
  const userConnectionState = isConnected
    ? ("connected" as const)
    : runtimeStatus === "DISCONNECTED"
      ? ("disconnected" as const)
      : runtimeStatus === "REAUTH_REQUIRED"
        ? ("reconnection_required" as const)
        : (["ERROR", "AUTH_FAILED"].includes(runtimeStatus) ? "recovering" : "unknown") as
            | "recovering"
            | "unknown";

  return (
    <DashboardShell currentPath="/onboarding">
      <WhatsAppConnectionOnboarding
        channelSelectionBasePath="/onboarding"
        channels={channels.map((entry: WhatsAppChannel, index: number) => ({
          id: entry.id,
          label: formatChannelLabel(entry, index),
          connectionMethod: entry.connectionMethod,
          connectionStatus: entry.connectionStatus,
          phoneNumber: entry.phoneNumber ?? null
        }))}
        health={{
          runtimeStatus,
          runtimePresent: runtimeStatus !== "DISCONNECTED",
          senderReachable: true,
          senderError: null,
          userConnectionState,
          ...qr,
          isConnectionStalled: false,
          isInboxReady: isConnected,
          isHistoryStabilizing: runtimeStatus === "SYNCING_HISTORY",
          isHistoryStuck: false,
          isLiveOnlyMode: false,
          importedConversationCount: 0,
          importedMessageCount: 0,
          lastSyncError: selectedChannel?.lastError ?? null
        }}
        initialWebSetup={{
          id: selectedChannel?.id ?? "",
          connectionMethod: selectedChannel?.connectionMethod ?? "web",
          connectionStatus: runtimeStatus,
          connectedByAgentName: selectedChannel?.connectedByAgentName ?? manager.name,
          displayName: selectedChannel?.displayName ?? "",
          phoneNumber: selectedChannel?.phoneNumber ?? "",
          phoneNumberId: selectedChannel?.phoneNumberId ?? null,
          businessAccountId: selectedChannel?.businessAccountId ?? null,
          accessTokenLastFour: selectedChannel?.accessTokenLastFour ?? null,
          verifyTokenLastFour: selectedChannel?.verifyTokenLastFour ?? null,
          qrCodeDataUrl: qr.qrCodeDataUrl,
          lastError: selectedChannel?.lastError ?? "",
          connectedAt: selectedChannel?.connectedAt?.toISOString() ?? null
        }}
        metaEmbeddedSignup={embeddedSignup}
        mode="guided"
        selectedChannelId={selectedChannel?.id ?? null}
        workspaceId={manager.workspaceId}
      />
    </DashboardShell>
  );
}
