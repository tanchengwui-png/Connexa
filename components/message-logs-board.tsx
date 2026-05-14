"use client";

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
    attachmentName: string | null;
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

export function MessageLogsBoard({ conversationId = null, filter, pagination, rows, summary }: MessageLogsBoardProps) {
  return (
    <>
      <section className="settings-dark-hero">
        <div className="settings-dark-copy">
          <span className="badge connexa-public-badge">Message logs</span>
          <h1>Every message event should be visible outside the live inbox.</h1>
          <p>
            Review sent, queued, processing, failed, canceled, and inbound message history in one dedicated audit surface.
          </p>
        </div>

        <div className="settings-dark-status">
          <div className="settings-dark-status-card">
            <span>History coverage</span>
            <strong>{summary.total}</strong>
            <p>{conversationId ? "Message history for one conversation." : "Full workspace message history across inbound and outbound events."}</p>
          </div>
        </div>
      </section>

      <section className="metrics-grid">
        <article className="content-card metric-card">
          <div className="metric-label">Sent</div>
          <div className="metric-value">{summary.sent}</div>
          <div className="table-subtle">Outbound messages accepted by the provider</div>
        </article>
        <article className="content-card metric-card">
          <div className="metric-label">Queued</div>
          <div className="metric-value">{summary.queued}</div>
          <div className="table-subtle">Outbound messages waiting for delivery</div>
        </article>
        <article className="content-card metric-card">
          <div className="metric-label">Failed</div>
          <div className="metric-value">{summary.failed}</div>
          <div className="table-subtle">Outbound attempts that need operator attention</div>
        </article>
        <article className="content-card metric-card">
          <div className="metric-label">Inbound</div>
          <div className="metric-value">{summary.inbound}</div>
          <div className="table-subtle">Incoming customer messages captured in the workspace</div>
        </article>
      </section>

      <section className="content-card scheduled-messages-shell">
        <div className="card-header scheduled-messages-head">
          <div>
            <h3 className="card-title">Logs</h3>
            <p className="muted">
              {conversationId ? "Viewing message history for one conversation." : "Switch between message states and direction-specific history."}
            </p>
          </div>
          <div className="message-logs-controls">
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
          <div className="scheduled-messages-filters">
            {FILTER_OPTIONS.map((option) => (
              <a
                className={`scheduled-filter-chip${filter === option.key ? " active" : ""}`}
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
        </div>

        {rows.length ? (
          <div className="scheduled-message-list">
            {rows.map((row) => (
              <article className="scheduled-message-row" key={row.id}>
                <div className="scheduled-message-main">
                  <div className="scheduled-message-topline">
                    <div>
                      <strong>{row.contactName}</strong>
                      <span>{row.phone}</span>
                    </div>
                    <span className={`scheduled-status-pill ${row.statusKey}`}>{row.status}</span>
                  </div>

                  <p className="scheduled-message-preview">{row.preview}</p>

                  <div className="scheduled-message-meta">
                    <span>{row.direction}</span>
                    <span>{row.source}</span>
                    <span>{row.sentAt}</span>
                    <span>By {row.createdBy}</span>
                    {row.providerMessageId ? <span>Provider ID {row.providerMessageId}</span> : null}
                    {row.attachmentName ? <span>Attachment {row.attachmentName}</span> : null}
                  </div>

                  {row.lastError ? <div className="scheduled-message-error">{row.lastError}</div> : null}
                </div>

                <div className="scheduled-message-actions">
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
      </section>

      {pagination.totalPages > 1 ? (
        <div className="content-card contacts-pagination">
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
    </>
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
