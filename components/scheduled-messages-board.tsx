"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AttachmentPreview } from "@/components/attachment-preview";
import { ScheduleSendDialog } from "@/components/inbox/schedule-send-dialog";
import { addMalaysiaDays, getMalaysiaDateKey } from "@/lib/malaysia-time";
import type { ScheduledMessagesFilter } from "@/lib/scheduled-messages";

type ScheduledMessagesBoardProps = {
  conversationId?: string | null;
  channelId?: string | null;
  filter: ScheduledMessagesFilter;
  rows: Array<{
    id: string;
    channelId: string | null;
    channelLabel: string | null;
    conversationId: string;
    contactName: string;
    phone: string;
    bodyPreview: string;
    attachmentMimeType: string | null;
    attachmentName: string | null;
    attachmentUrl: string | null;
    scheduledFor: string;
    scheduledForIso: string;
    createdAt: string;
    createdAtIso: string;
    status: "Canceled" | "Due now" | "Failed" | "Processing" | "Scheduled" | "Sent";
    statusKey: "canceled" | "due" | "failed" | "processing" | "scheduled" | "sent";
    createdBy: string;
    lastError: string | null;
  }>;
  summary: {
    scheduled: number;
    due: number;
    sent: number;
    failed: number;
    canceled: number;
    total: number;
  };
};

const FILTER_OPTIONS: Array<{ key: ScheduledMessagesFilter; label: string }> = [
  { key: "scheduled", label: "Scheduled" },
  { key: "due", label: "Due now" },
  { key: "failed", label: "Failed" },
  { key: "canceled", label: "Canceled" },
  { key: "sent", label: "Sent" },
  { key: "all", label: "All" }
];

export function ScheduledMessagesBoard({
  conversationId = null,
  channelId = null,
  filter,
  rows,
  summary
}: ScheduledMessagesBoardProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [errorById, setErrorById] = useState<Record<string, string>>({});
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [rescheduleTarget, setRescheduleTarget] = useState<{ id: string; scheduledForIso: string } | null>(null);

  const actionableRows = rows.filter(
    (row) => row.statusKey === "scheduled" || row.statusKey === "due" || row.statusKey === "failed"
  );
  const allActionableSelected = actionableRows.length > 0 && actionableRows.every((row) => selectedIds.includes(row.id));

  const runAction = (jobId: string, payload: { action: "cancel" | "reschedule" | "send-now"; scheduledFor?: string }) => {
    setErrorById((current) => ({ ...current, [jobId]: "" }));
    setBulkError(null);

    startTransition(async () => {
      const response = await fetch(`/api/outbound-message-jobs/${jobId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      const data = (await response.json().catch(() => null)) as { error?: string } | null;

      if (!response.ok) {
        setErrorById((current) => ({ ...current, [jobId]: data?.error ?? "Unable to update scheduled job." }));
        return;
      }

      setRescheduleTarget(null);
      router.refresh();
    });
  };

  const runBulkAction = (action: "cancel" | "send-now") => {
    setBulkError(null);

    startTransition(async () => {
      const response = await fetch("/api/outbound-message-jobs/bulk", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          action,
          jobIds: selectedIds
        })
      });

      const data = (await response.json().catch(() => null)) as { error?: string } | null;

      if (!response.ok) {
        setBulkError(data?.error ?? "Unable to update selected scheduled jobs.");
        return;
      }

      setSelectedIds([]);
      router.refresh();
    });
  };

  const toggleSelected = (jobId: string) => {
    setSelectedIds((current) =>
      current.includes(jobId) ? current.filter((value) => value !== jobId) : [...current, jobId]
    );
  };

  return (
    <>
      <section className="auth-page-stack">
        <section className="auth-page-hero auth-page-hero-compact scheduled-messages-hero">
          <div className="auth-page-hero-copy">
            <span className="auth-page-kicker">Outbound queue</span>
            <h2>Scheduled Messages</h2>
            <p>
              {conversationId
                ? "Manage outbound jobs for this conversation with clear queue state, timing, and recovery actions."
                : "Review, bulk-manage, and reschedule queued outbound jobs from one controlled queue."}
            </p>
            <div className="auth-page-hero-metrics">
              <span className="auth-page-hero-stat">
                <strong>{summary.total}</strong>
                <small>total jobs</small>
              </span>
              <span className="auth-page-hero-stat">
                <strong>{summary.due}</strong>
                <small>due now</small>
              </span>
              <span className="auth-page-hero-stat">
                <strong>{summary.failed}</strong>
                <small>failed</small>
              </span>
              <span className="auth-page-hero-panel scheduled-queue-status-card">
                <span className="auth-page-hero-panel-label">Queue status</span>
                <strong>{selectedIds.length ? `${selectedIds.length} selected for bulk action` : `${actionableRows.length} actionable jobs`}</strong>
                <p>
                  Filter by scheduled, due, failed, canceled, or sent jobs, then act on the queue below.
                </p>
              </span>
            </div>
          </div>
        </section>

        <section className="content-card scheduled-messages-shell">
        <div className="card-header scheduled-messages-head">
          <div>
            <h3 className="card-title">Queue view</h3>
            <p className="muted">
              {conversationId
                ? "Viewing scheduled outbound activity for one conversation."
                : "Review and manage queued outbound jobs from one clean list."}
            </p>
          </div>
          <div className="scheduled-inline-stats">
            <span>{summary.total} total</span>
            <span>{summary.due} due</span>
            <span>{summary.failed} failed</span>
            <span>{summary.sent} sent</span>
          </div>
          <div className="scheduled-messages-filters">
            {FILTER_OPTIONS.map((option) => (
              <a
                className={`scheduled-filter-chip${filter === option.key ? " active" : ""}`}
                href={buildScheduledMessagesHref(option.key, conversationId, channelId)}
                key={option.key}
              >
                <span>{option.label}</span>
                <strong>{getFilterCount(option.key, summary)}</strong>
              </a>
            ))}
          </div>
        </div>

        {actionableRows.length ? (
          <div className="scheduled-bulk-toolbar">
            <label className="auth-checkbox scheduled-bulk-select-all">
              <input
                checked={allActionableSelected}
                onChange={() =>
                  setSelectedIds(allActionableSelected ? [] : actionableRows.map((row) => row.id))
                }
                type="checkbox"
              />
              <span>Select all actionable</span>
            </label>
            <span className="table-subtle">
              {selectedIds.length ? `${selectedIds.length} selected` : "Select scheduled, due, or failed jobs for bulk actions."}
            </span>
            <div className="scheduled-bulk-actions">
              <button
                className="button button-secondary"
                disabled={isPending || !selectedIds.length}
                onClick={() => runBulkAction("send-now")}
                type="button"
              >
                Send selected now
              </button>
              <button
                className="button button-secondary"
                disabled={isPending || !selectedIds.length}
                onClick={() => runBulkAction("cancel")}
                type="button"
              >
                Cancel selected
              </button>
            </div>
          </div>
        ) : null}

        {bulkError ? <div className="scheduled-message-error">{bulkError}</div> : null}

        {rows.length ? (
          <div className="scheduled-queue-sections">
            {renderQueueSection({
              title: getQueueTitle(filter),
              description: getQueueDescription(filter, conversationId),
              rows,
              emptyText: getEmptyTitle(filter),
              selectedIds,
              toggleSelected,
              isPending,
              errorById,
              runAction,
              setRescheduleTarget
            })}
          </div>
        ) : (
          <div className="scheduled-messages-empty">
            <strong>{getEmptyTitle(filter)}</strong>
            <p className="muted">{getEmptyDescription(filter, conversationId)}</p>
          </div>
        )}
        </section>
      </section>

      <ScheduleSendDialog
        initialValue={rescheduleTarget?.scheduledForIso ?? null}
        isOpen={Boolean(rescheduleTarget)}
        isPending={isPending}
        onClose={() => setRescheduleTarget(null)}
        onSave={(value) => {
          if (!rescheduleTarget) {
            return;
          }

          runAction(rescheduleTarget.id, {
            action: "reschedule",
            scheduledFor: value
          });
        }}
      />
    </>
  );
}

function buildScheduledMessagesHref(
  filter: ScheduledMessagesFilter,
  conversationId?: string | null,
  channelId?: string | null
) {
  const params = new URLSearchParams();

  if (filter !== "scheduled") {
    params.set("filter", filter);
  }

  if (conversationId) {
    params.set("conversationId", conversationId);
  }
  if (channelId) {
    params.set("channelId", channelId);
  }

  const query = params.toString();
  return query ? `/scheduled-messages?${query}` : "/scheduled-messages";
}

function getFilterCount(
  filter: ScheduledMessagesFilter,
  summary: ScheduledMessagesBoardProps["summary"]
) {
  switch (filter) {
    case "scheduled":
      return summary.scheduled;
    case "due":
      return summary.due;
    case "failed":
      return summary.failed;
    case "canceled":
      return summary.canceled;
    case "sent":
      return summary.sent;
    case "all":
      return summary.total;
    default:
      return 0;
  }
}

function getEmptyTitle(filter: ScheduledMessagesFilter) {
  switch (filter) {
    case "failed":
      return "No failed jobs.";
    case "due":
      return "Nothing is due right now.";
    case "sent":
      return "No sent jobs yet.";
    case "canceled":
      return "No canceled jobs yet.";
    case "all":
      return "No scheduled jobs yet.";
    default:
      return "No scheduled jobs in this view yet.";
  }
}

function getEmptyDescription(filter: ScheduledMessagesFilter, conversationId?: string | null) {
  if (conversationId) {
    return "This conversation does not have any outbound jobs in the selected queue view.";
  }

  switch (filter) {
    case "failed":
      return "The queue is healthy. Failed jobs will appear here when delivery needs a manual retry.";
    case "due":
      return "Jobs that need immediate worker attention will show up here.";
    case "sent":
      return "Completed outbound sends will appear here once the queue starts delivering jobs.";
    case "canceled":
      return "Canceled jobs are preserved here for operator history.";
    default:
      return "Once scheduled sending is used from the composer, this queue becomes the clean place to manage it.";
  }
}

function getQueueTitle(filter: ScheduledMessagesFilter) {
  switch (filter) {
    case "due":
      return "Due Now";
    case "failed":
      return "Failed Jobs";
    case "canceled":
      return "Canceled Jobs";
    case "sent":
      return "Sent Jobs";
    case "all":
      return "All Jobs";
    default:
      return "Scheduled Jobs";
  }
}

function getQueueDescription(filter: ScheduledMessagesFilter, conversationId?: string | null) {
  if (conversationId) {
    return "Outbound jobs for the selected conversation, grouped by scheduled time.";
  }

  switch (filter) {
    case "due":
      return "Jobs that should be sent now or need immediate operator review.";
    case "failed":
      return "Outbound jobs that need a retry or manual intervention.";
    case "canceled":
      return "Canceled jobs preserved for operational history.";
    case "sent":
      return "Completed outbound sends grouped by their scheduled time.";
    case "all":
      return "The full outbound queue in one grouped list.";
    default:
      return "Future outbound jobs waiting in the queue.";
  }
}

function groupRowsByTimeBucket(rows: ScheduledMessagesBoardProps["rows"]) {
  const now = new Date();
  const todayKey = getMalaysiaDateKey(now);
  const tomorrowKey = getMalaysiaDateKey(addMalaysiaDays(now, 1));

  const buckets: Array<{
    key: "overdue" | "today" | "tomorrow" | "later";
    label: string;
    description: string;
    rows: ScheduledMessagesBoardProps["rows"];
  }> = [
    {
      key: "overdue",
      label: "Overdue",
      description: "Past scheduled times that should be reviewed first.",
      rows: []
    },
    {
      key: "today",
      label: "Today",
      description: "Jobs scheduled before the day ends.",
      rows: []
    },
    {
      key: "tomorrow",
      label: "Tomorrow",
      description: "Upcoming jobs scheduled for the next day.",
      rows: []
    },
    {
      key: "later",
      label: "Later",
      description: "Future jobs beyond tomorrow.",
      rows: []
    }
  ];

  for (const row of rows) {
    const scheduledAtMs = Date.parse(row.scheduledForIso);

    if (Number.isNaN(scheduledAtMs)) {
      buckets[3].rows.push(row);
      continue;
    }

    if (scheduledAtMs < Date.now()) {
      buckets[0].rows.push(row);
      continue;
    }

    const scheduledDateKey = getMalaysiaDateKey(row.scheduledForIso);

    if (scheduledDateKey === todayKey) {
      buckets[1].rows.push(row);
      continue;
    }

    if (scheduledDateKey === tomorrowKey) {
      buckets[2].rows.push(row);
      continue;
    }

    buckets[3].rows.push(row);
  }

  return buckets.filter((bucket) => bucket.rows.length > 0);
}

function renderQueueSection(input: {
  title: string;
  description: string;
  rows: ScheduledMessagesBoardProps["rows"];
  emptyText: string;
  selectedIds: string[];
  toggleSelected: (jobId: string) => void;
  isPending: boolean;
  errorById: Record<string, string>;
  runAction: (jobId: string, payload: { action: "cancel" | "reschedule" | "send-now"; scheduledFor?: string }) => void;
  setRescheduleTarget: (target: { id: string; scheduledForIso: string } | null) => void;
}) {
  if (!input.rows.length) {
    return (
      <section className="scheduled-queue-section">
        <div className="scheduled-queue-section-head">
          <div>
            <h4>{input.title}</h4>
            <p>{input.description}</p>
          </div>
        </div>
        <div className="scheduled-messages-empty scheduled-messages-empty-inline">
          <strong>{input.emptyText}</strong>
        </div>
      </section>
    );
  }

  return (
    <section className="scheduled-queue-section">
      <div className={`scheduled-queue-section-head ${input.title === "All Jobs" ? "is-all-jobs" : ""}`}>
        <div>
          <h4>{input.title}</h4>
          <p>{input.description}</p>
        </div>
        <span className="scheduled-queue-section-count">{input.rows.length}</span>
      </div>
      <div className="scheduled-bucket-list">
        {groupRowsByTimeBucket(input.rows).map((bucket) => (
          <section className={`scheduled-time-bucket ${bucket.key === "overdue" ? "is-overdue" : ""}`} key={bucket.key}>
            <div className="scheduled-time-bucket-head">
              <div>
                <h5>{bucket.label}</h5>
                <p>{bucket.description}</p>
              </div>
              <span className="scheduled-time-bucket-count">{bucket.rows.length}</span>
            </div>
            <div className="scheduled-message-list">
              {bucket.rows.map((row) => {
                const isActionable =
                  row.statusKey === "scheduled" || row.statusKey === "due" || row.statusKey === "failed";

                return (
                  <article className={`scheduled-message-row ${row.statusKey}`} key={row.id}>
                    <div className="scheduled-message-main">
                      <div className="scheduled-message-topline">
                        <div className="scheduled-message-identity">
                          {isActionable ? (
                            <label className="auth-checkbox scheduled-row-select">
                              <input
                                checked={input.selectedIds.includes(row.id)}
                                onChange={() => input.toggleSelected(row.id)}
                                type="checkbox"
                              />
                              <span />
                            </label>
                          ) : null}
                          <div className="scheduled-message-identity-copy">
                            <strong>{row.contactName}</strong>
                            <span>{row.phone}</span>
                            {row.channelLabel ? <span>{row.channelLabel}</span> : null}
                          </div>
                        </div>
                        <span className={`scheduled-status-pill ${row.statusKey}`}>{row.status}</span>
                      </div>

                      <p className="scheduled-message-preview">{row.bodyPreview}</p>

                      {row.attachmentUrl ? (
                        <div className="scheduled-message-attachment">
                          <AttachmentPreview
                            className="attachment-preview-compact"
                            fileName={row.attachmentName}
                            mimeType={row.attachmentMimeType}
                            openLabel="Open attachment"
                            url={row.attachmentUrl}
                          />
                        </div>
                      ) : null}

                      <div className="scheduled-message-meta">
                        <span>Scheduled for {row.scheduledFor}</span>
                        <span>Queued {row.createdAt}</span>
                        <span>Created by {row.createdBy}</span>
                        {row.attachmentName && !row.attachmentUrl ? <span>Attachment {row.attachmentName}</span> : null}
                      </div>

                      {row.lastError ? <div className="scheduled-message-error">{row.lastError}</div> : null}
                      {input.errorById[row.id] ? <div className="scheduled-message-error">{input.errorById[row.id]}</div> : null}
                    </div>

                    <div className="scheduled-message-actions">
                      {isActionable ? (
                        <button
                          className="button button-primary"
                          disabled={input.isPending}
                          onClick={() => input.runAction(row.id, { action: "send-now" })}
                          type="button"
                        >
                          Send now
                        </button>
                      ) : null}

                      {isActionable ? (
                        <div className="scheduled-message-secondary-actions">
                          <button
                            className="button button-secondary"
                            disabled={input.isPending}
                            onClick={() => input.setRescheduleTarget({ id: row.id, scheduledForIso: row.scheduledForIso })}
                            type="button"
                          >
                            Reschedule
                          </button>
                          <button
                            className="button button-secondary"
                            disabled={input.isPending}
                            onClick={() => input.runAction(row.id, { action: "cancel" })}
                            type="button"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : null}

                      <a className="button button-secondary" href={`/inbox?conversationId=${row.conversationId}`}>
                        Open conversation
                      </a>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}
