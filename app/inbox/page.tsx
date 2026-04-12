import { DashboardShell } from "@/components/dashboard-shell";
import { InboxWorkspace } from "@/components/inbox-workspace";
import { getInboxData } from "@/lib/inbox";

type InboxPageProps = {
  searchParams?: Promise<{
    conversationId?: string;
  }>;
};

export default async function InboxPage({ searchParams }: InboxPageProps) {
  const params = searchParams ? await searchParams : undefined;
  const { conversations, quickReplies, whatsapp, agents, selectedConversation, summary, currentAgent, workspaceIndustryType } =
    await getInboxData(params?.conversationId);

  return (
    <DashboardShell currentPath="/inbox">
      <div className="inbox-page-shell">
        <InboxWorkspace
          conversations={conversations}
          quickReplies={quickReplies}
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
