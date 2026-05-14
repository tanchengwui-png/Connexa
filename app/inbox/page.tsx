import { DashboardShell } from "@/components/dashboard-shell";
import { InboxWorkspace } from "@/components/inbox-workspace";
import { getAgentEntryPath } from "@/lib/auth/entry-path";
import { getCurrentAgent } from "@/lib/auth/current-user";
import { getInboxData } from "@/lib/inbox";
import { redirect } from "next/navigation";

type InboxPageProps = {
  searchParams?: Promise<{
    conversationId?: string;
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

  const { conversations, quickReplies, whatsapp, agents, selectedConversation, summary, currentAgent, workspaceIndustryType, mediaAssets } =
    await getInboxData(params?.conversationId);

  return (
    <DashboardShell currentPath="/inbox">
      <div className="inbox-page-shell">
        <InboxWorkspace
          conversations={conversations}
          quickReplies={quickReplies}
          mediaAssets={mediaAssets}
          whatsapp={whatsapp}
          agents={agents}
          currentAgent={currentAgent}
          summary={summary}
          selectedConversation={selectedConversation}
          workspaceIndustryType={workspaceIndustryType}
        />
      </div>
    </DashboardShell>
  );
}
