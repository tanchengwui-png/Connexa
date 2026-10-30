import { DashboardShell } from "@/components/dashboard-shell";
import { MessageLogsBoard } from "@/components/message-logs-board";
import { getMessageLogsData, type MessageLogsFilter } from "@/lib/message-logs";

type MessageLogsPageProps = {
  searchParams?: Promise<{
    conversationId?: string;
    filter?: string;
    direction?: string;
    status?: string;
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
  const legacyFilter = VALID_FILTERS.has((params?.filter as MessageLogsFilter | undefined) ?? "all")
    ? ((params?.filter as MessageLogsFilter | undefined) ?? "all")
    : "all";
  const direction: "all" | "inbound" | "outbound" = params?.direction === "inbound" || params?.direction === "outbound"
    ? params.direction
    : legacyFilter === "inbound" || legacyFilter === "outbound"
      ? legacyFilter
      : "all";
  const status: "all" | "canceled" | "failed" | "processing" | "queued" | "received" | "sent" = ["sent", "queued", "processing", "failed", "canceled", "received"].includes(params?.status ?? "")
    ? (params!.status as "canceled" | "failed" | "processing" | "queued" | "received" | "sent")
    : ["sent", "queued", "processing", "failed", "canceled"].includes(legacyFilter)
      ? (legacyFilter as "canceled" | "failed" | "processing" | "queued" | "sent")
      : "all";

  const data = await getMessageLogsData({
    filter: legacyFilter,
    direction,
    status,
    conversationId: params?.conversationId,
    page: params?.page ? Number.parseInt(params.page, 10) : undefined,
    pageSize: params?.pageSize ? Number.parseInt(params.pageSize, 10) : undefined
  });

  return (
    <DashboardShell currentPath="/message-logs">
      <MessageLogsBoard
        conversationId={data.conversationId}
        direction={data.direction}
        hasLinkedWhatsAppNumbers={data.hasLinkedWhatsAppNumbers}
        pagination={data.pagination}
        rows={data.rows}
        summary={data.summary}
        status={data.status}
      />
    </DashboardShell>
  );
}
