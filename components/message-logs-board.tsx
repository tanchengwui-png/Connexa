"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AttachmentPreview } from "@/components/attachment-preview";
import { useConfirmation } from "@/components/confirmation-provider";
import { useToast } from "@/components/toast-provider";
import type { MessageLogsFilter } from "@/lib/message-logs";

type MessageLogsBoardProps = {
  conversationId?: string | null;
  filter: MessageLogsFilter;
  pagination: {
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
    pageCount: number;
  };
  rows: Array<{
    id: string;
    conversationId: string;
    contactName: string;
    phone: string;
    preview: string;
    attachmentMimeType: string | null;
    attachmentName: string | null;
    attachmentUrl: string | null;
    direction: "Inbound" | "Outbound";
    source: "Connexa outbound" | "Inbound" | "Manual outbound";
    status: "Canceled" | "Failed" | "Inbound" | "Processing" | "Queued" | "Sent";
    statusKey: "canceled" | "failed" | "inbound" | "processing" | "queued" | "sent";
    sentAt: string;
    sentAtIso: string;
    createdBy: string;
    providerMessageId: string | null;
    lastError: string | null;
  }>;
  summary: {
    total: number;
    inbound: number;
    outbound: number;
    sent: number;
    queued: number;
    processing: number;
    failed: number;
    canceled: number;
  };
  hasLinkedWhatsAppNumbers: boolean;
};

const FILTER_OPTIONS: Array<{ key: MessageLogsFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "sent", label: "Sent" },
  { key: "queued", label: "Queued" },
  { key: "processing", label: "Processing" },
  { key: "failed", label: "Failed" },
  { key: "canceled", label: "Canceled" },
  { key: "inbound", label: "Inbound" },
  { key: "outbound", label: "Outbound" }
];

export function MessageLogsBoard({
  conversationId = null,
  filter,
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

  const canDeleteLogs = summary.total > 0 && !hasLinkedWhatsAppNumbers;

  const deleteLogs = async () => {
    const accepted = await confirm({
      title: "Delete message logs?",
      description: "This will permanently remove all message log entries in this workspace.",
      confirmLabel: "Delete logs",
      tone: "danger"
    });

    if (!accepted) {
      return;
    }

    setPageError(null);
    startTransition(async () => {
      const response = await fetch("/api/message-logs", {
        method: "DELETE"
      });
      const payload = (await response.json().catch(() => null)) as
        | {
            error?: string;
            result?: {
              deletedMessageCount: number;
            };
          }
        | null;

      if (!response.ok) {
        const message = payload?.error ?? "Unable to delete message logs.";
        setPageError(message);
        showError("Delete failed", message);
        return;
      }

      success(
        "Message logs deleted",
        `${payload?.result?.deletedMessageCount ?? 0} log entries were removed from this workspace.`
      );
      router.refresh();
    });
  };

  return (
    <section className="auth-page-stack">
      <section className="auth-page-hero auth-page-hero-compact message-logs-hero">
        <div className="auth-page-hero-copy">
          <span className="auth-page-kicker">Message intelligence</span>
          <h2>Message Logs</h2>
          <p>
            {conversationId
              ? "Track delivery, source, and message history for this conversation in one operational view."
              : "Review inbound and outbound delivery history with clear status, filtering, and recovery actions."}
          </p>
          <div className="auth-page-hero-metrics">
            <span className="auth-page-hero-stat">
              <strong>{summary.total}</strong>
              <small>total events</small>
            </span>
            <span className="auth-page-hero-stat">
              <strong>{summary.sent}</strong>
              <small>sent</small>
            </span>
            <span className="auth-page-hero-stat">
              <strong>{summary.failed}</strong>
              <small>failed</small>
            </span>
            <span className="auth-page-hero-panel message-logs-current-view-card">
              <span className="auth-page-hero-panel-label">Current view</span>
              <strong>
                Showing {pagination.pageCount} of {pagination.total} events
              </strong>
              <p>
                {hasLinkedWhatsAppNumbers
                  ? "Linked WhatsApp numbers are active, so bulk deletion is disabled until they are disconnected."
                  : "Use filters and paging below to isolate failed, queued, inbound, or outbound events."}
              </p>
            </span>
          </div>
        </div>
        <div className="auth-page-hero-side">
          <div className="auth-page-hero-actions">
            {summary.total > 0 ? (
              <button
                className="button button-secondary"
                disabled={isPending || !canDeleteLogs}
                onClick={() => void deleteLogs()}
                title={
                  hasLinkedWhatsAppNumbers
                    ? "Disconnect all linked WhatsApp numbers before deleting message logs."
                    : "Delete all message logs in this workspace"
                }
                type="button"
              >
                {isPending ? "Deleting..." : "Delete logs"}
              </button>
            ) : null}
          </div>
        </div>
      </section>

      <section className="content-card scheduled-messages-shell message-logs-shell">
        <div className="card-header scheduled-messages-head message-logs-head">
          <div>
            <h3 className="card-title">Delivery view</h3>
            <p className="muted">
              {conversationId ? "Viewing message history for one conversation." : "Review inbound and outbound delivery history from one clean log."}
            </p>
          </div>
          <div className="scheduled-inline-stats message-logs-inline-stats">
            <span>{summary.total} total</span>
            <span>{summary.sent} sent</span>
            <span>{summary.failed} failed</span>
            <span>{summary.inbound} inbound</span>
          </div>
          <div className="message-logs-toolbar">
            <div className="scheduled-messages-filters message-logs-filters">
              {FILTER_OPTIONS.map((option) => (
                <a
                  className={`scheduled-filter-chip message-logs-filter-chip${filter === option.key ? " active" : ""}`}
                  href={buildMessageLogsHref({
                    filter: option.key,
                    conversationId,
                    page: 1,
                    pageSize: pagination.pageSize
                  })}
                  key={option.key}
                >
                  {option.label}
                </a>
              ))}
            </div>
            <div className="message-logs-controls">
            {summary.total > 0 ? (
              <button
                className="button button-secondary"
                disabled={isPending || !canDeleteLogs}
                onClick={() => void deleteLogs()}
                title={
                  hasLinkedWhatsAppNumbers
                    ? "Disconnect all linked WhatsApp numbers before deleting message logs."
                    : "Delete all message logs in this workspace"
                }
                type="button"
              >
                {isPending ? "Deleting..." : "Delete"}
              </button>
            ) : null}
            <span className="table-subtle">
              Showing {pagination.pageCount} of {pagination.total} events
            </span>
            <form action="/message-logs" className="contacts-pagination-form">
              {conversationId ? <input name="conversationId" type="hidden" value={conversationId} /> : null}
              {filter !== "all" ? <input name="filter" type="hidden" value={filter} /> : null}
              <input name="page" type="hidden" value="1" />
              <label className="contacts-page-size-label">
                <span className="table-subtle">Rows</span>
                <select
                  className="inbox-dialog-input app-select contacts-page-size-select"
                  defaultValue={String(pagination.pageSize)}
                  name="pageSize"
                >
                  {[25, 50, 100].map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
              </label>
              <button className="button button-secondary" type="submit">
                Apply
              </button>
            </form>
          </div>
          </div>
          {pageError ? <div className="scheduled-message-error message-logs-error">{pageError}</div> : null}
        </div>

        {rows.length ? (
          <div className="scheduled-message-list message-logs-list">
            {rows.map((row) => (
              <article className={`scheduled-message-row message-logs-row ${row.statusKey}`} key={row.id}>
                <div className="scheduled-message-main message-logs-main">
                  <div className="scheduled-message-topline message-logs-topline">
                    <div className="message-logs-identity">
                      <strong>{row.contactName}</strong>
                      <div className="message-logs-subline">
                        <span>{row.phone}</span>
                        <span className="message-logs-direction">{row.direction}</span>
                      </div>
                    </div>
                    <span className={`scheduled-status-pill ${row.statusKey}`}>{row.status}</span>
                  </div>

                  <p className="scheduled-message-preview message-logs-preview">{row.preview}</p>

                  {row.attachmentUrl ? (
                    <div className="message-logs-attachment">
                      <AttachmentPreview
                        className="attachment-preview-compact"
                        fileName={row.attachmentName}
                        mimeType={row.attachmentMimeType}
                        openLabel="Open attachment"
                        url={row.attachmentUrl}
                      />
                    </div>
                  ) : null}

                  <div className="scheduled-message-meta message-logs-meta">
                    <span>{row.direction}</span>
                    <span>{row.source}</span>
                    <span>{row.sentAt}</span>
                    <span>By {row.createdBy}</span>
                    {row.providerMessageId ? <span>Provider ID {row.providerMessageId}</span> : null}
                    {row.attachmentName && !row.attachmentUrl ? <span>Attachment {row.attachmentName}</span> : null}
                  </div>

                  {row.lastError ? <div className="scheduled-message-error message-logs-error">{row.lastError}</div> : null}
                </div>

                <div className="scheduled-message-actions message-logs-actions">
                  <a className="button button-secondary" href={`/inbox?conversationId=${row.conversationId}`}>
                    Open conversation
                  </a>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="scheduled-messages-empty">
            <strong>No message logs in this view yet.</strong>
            <p className="muted">This filter currently has no matching message events.</p>
          </div>
        )}

      {pagination.totalPages > 1 ? (
        <div className="contacts-pagination scheduled-pagination">
          <a
            aria-disabled={pagination.page <= 1}
            className={`button button-secondary${pagination.page <= 1 ? " is-disabled" : ""}`}
            href={buildMessageLogsHref({
              filter,
              conversationId,
              page: Math.max(1, pagination.page - 1),
              pageSize: pagination.pageSize
            })}
          >
            Previous
          </a>
          <div className="contacts-pagination-pages">
            {buildVisiblePageNumbers(pagination.page, pagination.totalPages).map((pageNumber) => (
              <a
                className={`button ${pageNumber === pagination.page ? "button-primary" : "button-secondary"}`}
                href={buildMessageLogsHref({
                  filter,
                  conversationId,
                  page: pageNumber,
                  pageSize: pagination.pageSize
                })}
                key={pageNumber}
              >
                {pageNumber}
              </a>
            ))}
          </div>
          <a
            aria-disabled={pagination.page >= pagination.totalPages}
            className={`button button-secondary${pagination.page >= pagination.totalPages ? " is-disabled" : ""}`}
            href={buildMessageLogsHref({
              filter,
              conversationId,
              page: Math.min(pagination.totalPages, pagination.page + 1),
              pageSize: pagination.pageSize
            })}
          >
            Next
          </a>
        </div>
      ) : null}
      </section>
    </section>
  );
}

function buildMessageLogsHref(input: {
  filter: MessageLogsFilter;
  conversationId?: string | null;
  page?: number;
  pageSize?: number;
}) {
  const params = new URLSearchParams();

  if (input.filter !== "all") {
    params.set("filter", input.filter);
  }

  if (input.conversationId) {
    params.set("conversationId", input.conversationId);
  }

  if (input.page && input.page > 1) {
    params.set("page", String(input.page));
  }

  if (input.pageSize) {
    params.set("pageSize", String(input.pageSize));
  }

  const query = params.toString();
  return query ? `/message-logs?${query}` : "/message-logs";
}

function buildVisiblePageNumbers(currentPage: number, totalPages: number) {
  const start = Math.max(1, currentPage - 2);
  const end = Math.min(totalPages, currentPage + 2);
  const pages: number[] = [];

  for (let page = start; page <= end; page += 1) {
    pages.push(page);
  }

  return pages;
}
