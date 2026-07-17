import { DashboardShell } from "@/components/dashboard-shell";
import { ScheduledMessagesBoard } from "@/components/scheduled-messages-board";
import { getScheduledMessagesData, type ScheduledMessagesFilter } from "@/lib/scheduled-messages";

type ScheduledMessagesPageProps = {
  searchParams?: Promise<{
    conversationId?: string;
    channelId?: string;
    filter?: string;
  }>;
};

const VALID_FILTERS = new Set<ScheduledMessagesFilter>(["all", "canceled", "due", "failed", "scheduled", "sent"]);

export default async function ScheduledMessagesPage({ searchParams }: ScheduledMessagesPageProps) {
  const params = searchParams ? await searchParams : undefined;
  const filter = VALID_FILTERS.has((params?.filter as ScheduledMessagesFilter | undefined) ?? "scheduled")
    ? ((params?.filter as ScheduledMessagesFilter | undefined) ?? "scheduled")
    : "scheduled";

  const data = await getScheduledMessagesData(filter, params?.conversationId, params?.channelId);

  return (
    <DashboardShell currentPath="/scheduled-messages">
      <ScheduledMessagesBoard
        conversationId={data.conversationId}
        channelId={data.channelId}
        filter={data.filter}
        rows={data.rows}
        summary={data.summary}
      />
    </DashboardShell>
  );
}
