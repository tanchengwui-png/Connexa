"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { useConfirmation } from "@/components/confirmation-provider";
import { useToast } from "@/components/toast-provider";

type DirectionFilter = "all" | "inbound" | "outbound";
type StatusFilter = "all" | "canceled" | "failed" | "processing" | "queued" | "received" | "sent";

type Row = {
  id: string;
  conversationId: string;
  contactName: string;
  phone: string;
  preview: string;
  fullMessage: string | null;
  attachmentName: string | null;
  attachmentUrl: string | null;
  direction: "Inbound" | "Outbound";
  source: "Connexa outbound" | "Inbound" | "Manual outbound";
  status: "Canceled" | "Failed" | "Processing" | "Queued" | "Received" | "Sent";
  statusKey: "canceled" | "failed" | "inbound" | "processing" | "queued" | "sent";
  sentAt: string;
  sentAtIso: string;
  createdBy: string;
  providerMessageId: string | null;
  lastError: string | null;
};

type MessageLogsBoardProps = {
  conversationId?: string | null;
  direction: DirectionFilter;
  status: StatusFilter;
  pagination: { total: number; page: number; pageSize: number; totalPages: number; pageCount: number };
  rows: Row[];
  summary: { total: number; inbound: number; outbound: number; failed: number };
  hasLinkedWhatsAppNumbers: boolean;
};

export function MessageLogsBoard({
  conversationId = null,
  direction,
  status,
  pagination,
  rows,
  summary,
  hasLinkedWhatsAppNumbers
}: MessageLogsBoardProps) {
  const router = useRouter();
  const { confirm } = useConfirmation();
  const { success, error: showError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [pageError, setPageError] = useState<string | null>(null);
  const pageSizeForm = useRef<HTMLFormElement>(null);
  const canDeleteLogs = summary.total > 0 && !hasLinkedWhatsAppNumbers;
  const hasActiveFilters = direction !== "all" || status !== "all";
  const rangeStart = pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.pageSize + 1;
  const rangeEnd = Math.min(pagination.total, rangeStart + pagination.pageCount - 1);

  const deleteLogs = async () => {
    const accepted = await confirm({
      title: `Delete ${summary.total} message log${summary.total === 1 ? "" : "s"}?`,
      description: "This permanently removes all message log entries in this workspace.",
      confirmLabel: "Delete logs",
      tone: "danger"
    });
    if (!accepted) return;
    setPageError(null);
    startTransition(async () => {
      const response = await fetch("/api/message-logs", { method: "DELETE" });
      const payload = (await response.json().catch(() => null)) as { error?: string; result?: { deletedMessageCount: number } } | null;
      if (!response.ok) {
        const message = payload?.error ?? "Unable to delete message logs.";
        setPageError(message);
        showError("Delete failed", message);
        return;
      }
      success("Message logs deleted", `${payload?.result?.deletedMessageCount ?? 0} log entries were removed from this workspace.`);
      router.refresh();
    });
  };

  return (
    <section className="message-logs-page" aria-labelledby="message-logs-title">
      <header className="message-logs-page-header">
        <div>
          <h1 id="message-logs-title">Message Logs</h1>
          <p>Review message delivery activity.</p>
          <div className="message-logs-summary" aria-label="Message log summary">
            <Stat label="total" value={summary.total} />
            <Stat label="inbound" value={summary.inbound} />
            <Stat label="outbound" value={summary.outbound} />
            <Stat label="failed" value={summary.failed} />
          </div>
        </div>
        {summary.total > 0 ? (
          <div className="message-logs-page-actions">
            <button className="button button-secondary" disabled={isPending || !canDeleteLogs} onClick={() => void deleteLogs()} type="button">
              {isPending ? "Deleting…" : "Delete logs"}
            </button>
            {!canDeleteLogs ? <span className="message-logs-delete-note">Disconnect linked WhatsApp numbers to delete logs.</span> : null}
          </div>
        ) : null}
      </header>

      <p className="message-logs-helper">
        Showing {pagination.pageCount} of {pagination.total} events{hasLinkedWhatsAppNumbers ? " · Bulk deletion is unavailable while linked WhatsApp numbers are active." : "."}
      </p>

      <section className="message-logs-panel" aria-label="Message log directory">
        <form action="/message-logs" className="message-logs-toolbar" ref={pageSizeForm}>
          {conversationId ? <input name="conversationId" type="hidden" value={conversationId} /> : null}
          <input name="page" type="hidden" value="1" />
          <label>
            <span>Direction</span>
            <select aria-label="Filter by direction" className="app-select" defaultValue={direction} name="direction" onChange={(event) => event.currentTarget.form?.requestSubmit()}>
              <option value="all">All directions</option><option value="inbound">Inbound</option><option value="outbound">Outbound</option>
            </select>
          </label>
          <label>
            <span>Status</span>
            <select aria-label="Filter by status" className="app-select" defaultValue={status} name="status" onChange={(event) => event.currentTarget.form?.requestSubmit()}>
              <option value="all">All statuses</option><option value="received">Received</option><option value="sent">Sent</option><option value="queued">Queued</option><option value="processing">Processing</option><option value="failed">Failed</option><option value="canceled">Canceled</option>
            </select>
          </label>
          {hasActiveFilters ? <a className="message-logs-clear" href={buildHref({ conversationId, pageSize: pagination.pageSize })}>Clear filters</a> : null}
        </form>
        {pageError ? <div className="message-logs-error" role="alert">{pageError}</div> : null}
        {rows.length ? <LogRows rows={rows} /> : <EmptyState hasActiveFilters={hasActiveFilters} conversationId={conversationId} pageSize={pagination.pageSize} />}
        <Pagination conversationId={conversationId} direction={direction} pagination={pagination} rangeEnd={rangeEnd} rangeStart={rangeStart} status={status} />
      </section>
    </section>
  );
}

function LogRows({ rows }: { rows: Row[] }) {
  return <><div className="message-logs-desktop message-logs-table-scroll"><table className="message-logs-table"><colgroup><col className="log-conversation" /><col className="log-preview" /><col className="log-direction" /><col className="log-status" /><col className="log-time" /><col className="log-actions" /></colgroup><thead><tr><th scope="col">Conversation</th><th scope="col">Message preview</th><th scope="col">Direction</th><th scope="col">Status</th><th scope="col">Time</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><strong>{row.contactName}</strong><span>{row.phone}</span></td><td className="message-preview-cell"><span className="message-logs-preview message-preview-text" title={row.fullMessage ?? row.preview}>{row.preview}</span>{row.attachmentUrl ? <a href={row.attachmentUrl}>Attachment</a> : null}</td><td><Badge tone={row.direction.toLowerCase()}>{row.direction}</Badge></td><td><Badge tone={row.statusKey}>{row.status}</Badge></td><td><time dateTime={row.sentAtIso} title={row.sentAtIso}>{row.sentAt}</time></td><td><RowActions row={row} /></td></tr>)}</tbody></table></div><div className="message-logs-mobile">{rows.map((row) => <article className="message-logs-card" key={row.id}><div><strong>{row.contactName}</strong><span>{row.phone}</span></div><p title={row.fullMessage ?? row.preview}>{row.preview}</p><div className="message-logs-card-meta"><Badge tone={row.direction.toLowerCase()}>{row.direction}</Badge><Badge tone={row.statusKey}>{row.status}</Badge><time dateTime={row.sentAtIso} title={row.sentAtIso}>{row.sentAt}</time></div><RowActions row={row} /></article>)}</div></>;
}

function RowActions({ row }: { row: Row }) {
  return <details className="message-logs-actions"><summary aria-label={`Actions for ${row.contactName}`}>•••</summary><div><a href={`/inbox?conversationId=${row.conversationId}`}>Open conversation</a><details><summary>View details</summary><dl><div><dt>Full message</dt><dd>{row.fullMessage ?? "No message content"}</dd></div><div><dt>Source</dt><dd>{row.source}</dd></div><div><dt>Provider ID</dt><dd className="message-logs-id">{row.providerMessageId ?? "—"}</dd></div>{row.lastError ? <div><dt>Error</dt><dd>{row.lastError}</dd></div> : null}</dl></details></div></details>;
}

function Pagination({ conversationId, direction, pagination, rangeEnd, rangeStart, status }: { conversationId: string | null; direction: DirectionFilter; pagination: MessageLogsBoardProps["pagination"]; rangeEnd: number; rangeStart: number; status: StatusFilter }) {
  return <footer className="message-logs-pagination message-logs-footer"><span>Showing {rangeStart}–{rangeEnd} of {pagination.total} events</span><div><form action="/message-logs">{conversationId ? <input name="conversationId" type="hidden" value={conversationId} /> : null}{direction !== "all" ? <input name="direction" type="hidden" value={direction} /> : null}{status !== "all" ? <input name="status" type="hidden" value={status} /> : null}<input name="page" type="hidden" value="1" /><label>Rows per page <select aria-label="Rows per page" className="app-select" defaultValue={String(pagination.pageSize)} name="pageSize" onChange={(event) => event.currentTarget.form?.requestSubmit()}>{[25, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}</select></label></form><a aria-disabled={pagination.page <= 1} className={pagination.page <= 1 ? "is-disabled" : ""} href={buildHref({ conversationId, direction, status, page: Math.max(1, pagination.page - 1), pageSize: pagination.pageSize })}>Previous</a><span aria-current="page">{pagination.page}</span><a aria-disabled={pagination.page >= pagination.totalPages} className={pagination.page >= pagination.totalPages ? "is-disabled" : ""} href={buildHref({ conversationId, direction, status, page: Math.min(pagination.totalPages, pagination.page + 1), pageSize: pagination.pageSize })}>Next</a></div></footer>;
}

function EmptyState({ hasActiveFilters, conversationId, pageSize }: { hasActiveFilters: boolean; conversationId: string | null; pageSize: number }) { return <div className="message-logs-empty"><strong>{hasActiveFilters ? "No events match the current filters" : "No message logs yet"}</strong>{hasActiveFilters ? <a href={buildHref({ conversationId, pageSize })}>Clear filters</a> : null}</div>; }
function Badge({ children, tone }: { children: React.ReactNode; tone: string }) { return <span className={`message-logs-badge ${tone}`}>{children}</span>; }
function Stat({ label, value }: { label: string; value: number }) { return <span><strong>{value}</strong><small>{label}</small></span>; }
function buildHref(input: { conversationId?: string | null; direction?: DirectionFilter; status?: StatusFilter; page?: number; pageSize?: number }) { const params = new URLSearchParams(); if (input.conversationId) params.set("conversationId", input.conversationId); if (input.direction && input.direction !== "all") params.set("direction", input.direction); if (input.status && input.status !== "all") params.set("status", input.status); if (input.page && input.page > 1) params.set("page", String(input.page)); if (input.pageSize) params.set("pageSize", String(input.pageSize)); const query = params.toString(); return query ? `/message-logs?${query}` : "/message-logs"; }
