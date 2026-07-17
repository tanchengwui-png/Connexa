import { DashboardShell } from "@/components/dashboard-shell";
import { InboxWorkspace } from "@/components/inbox-workspace";
import { getAgentEntryPath } from "@/lib/auth/entry-path";
import { getCurrentAgent } from "@/lib/auth/current-user";
import { getInboxData } from "@/lib/inbox";
import { redirect } from "next/navigation";

type InboxPageProps = {
  searchParams?: Promise<{
    conversationId?: string;
    channelId?: string;
  }>;
};

export default async function InboxPage({ searchParams }: InboxPageProps) {
  const params = searchParams ? await searchParams : undefined;
  const agent = await getCurrentAgent();

  if (agent) {
    const entryPath = await getAgentEntryPath(agent);
    if (entryPath !== "/inbox") {
      redirect(entryPath);
    }
  }

  const { conversations, quickReplies, whatsapp, agents, selectedConversation, summary, currentAgent, workspaceIndustryType, mediaAssets, contactTags } =
    await getInboxData(params?.conversationId, params?.channelId ?? null);
  const hasDisconnectedWhatsAppSession =
    (whatsapp.runtimeStatus === "DISCONNECTED" || whatsapp.runtimeStatus === "AUTH_FAILED");
  const isWhatsAppReady = whatsapp.isConfigured && !hasDisconnectedWhatsAppSession;
  const footerStatusLabel =
    !whatsapp.isConfigured
      ? "Setup needed"
      : hasDisconnectedWhatsAppSession
        ? "Connection lost"
        : whatsapp.isLiveOnlyMode
          ? "Live mode"
          : "Connected";

  return (
    <DashboardShell currentPath="/inbox">
      <div className="inbox-page-shell">
        <InboxWorkspace
          conversations={conversations}
          contactTags={contactTags}
          quickReplies={quickReplies}
          mediaAssets={mediaAssets}
          whatsapp={whatsapp}
          agents={agents}
          currentAgent={currentAgent}
          summary={summary}
          selectedConversation={selectedConversation}
          workspaceIndustryType={workspaceIndustryType}
        />
        <footer className="inbox-shell-footer" aria-label="Inbox status">
          <span>Connexa</span>
          <span>Shared Inbox</span>
          <span>{conversations.length} conversations</span>
          <span>{footerStatusLabel}</span>
        </footer>
      </div>
    </DashboardShell>
  );
}
