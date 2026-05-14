import { DashboardShell } from "@/components/dashboard-shell";
import { MessageLogsBoard } from "@/components/message-logs-board";
import { getMessageLogsData, type MessageLogsFilter } from "@/lib/message-logs";

type MessageLogsPageProps = {
  searchParams?: Promise<{
    conversationId?: string;
    filter?: string;
    page?: string;
    pageSize?: string;
  }>;
};

const VALID_FILTERS = new Set<MessageLogsFilter>([
  "all",
  "canceled",
  "failed",
  "inbound",
  "outbound",
  "processing",
  "queued",
  "sent"
]);

export default async function MessageLogsPage({ searchParams }: MessageLogsPageProps) {
  const params = searchParams ? await searchParams : undefined;
  const filter = VALID_FILTERS.has((params?.filter as MessageLogsFilter | undefined) ?? "all")
    ? ((params?.filter as MessageLogsFilter | undefined) ?? "all")
    : "all";

  const data = await getMessageLogsData({
    filter,
    conversationId: params?.conversationId,
    page: params?.page ? Number.parseInt(params.page, 10) : undefined,
    pageSize: params?.pageSize ? Number.parseInt(params.pageSize, 10) : undefined
  });

  return (
    <DashboardShell currentPath="/message-logs">
      <MessageLogsBoard
        conversationId={data.conversationId}
        filter={data.filter}
        pagination={data.pagination}
        rows={data.rows}
        summary={data.summary}
      />
    </DashboardShell>
  );
}
