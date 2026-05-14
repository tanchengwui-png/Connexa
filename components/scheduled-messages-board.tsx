"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ScheduleSendDialog } from "@/components/inbox/schedule-send-dialog";
import { addMalaysiaDays, getMalaysiaDateKey } from "@/lib/malaysia-time";
import type { ScheduledMessagesFilter } from "@/lib/scheduled-messages";

type ScheduledMessagesBoardProps = {
  conversationId?: string | null;
  filter: ScheduledMessagesFilter;
  rows: Array<{
    id: string;
    conversationId: string;
    contactName: string;
    phone: string;
    bodyPreview: string;
    attachmentName: string | null;
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
  const attentionRows = rows.filter(
    (row) => row.statusKey === "due" || row.statusKey === "failed" || row.statusKey === "processing"
  );
  const historyRows = rows.filter(
    (row) => row.statusKey === "scheduled" || row.statusKey === "sent" || row.statusKey === "canceled"
  );
  const allActionableSelected = actionableRows.length > 0 && actionableRows.every((row) => selectedIds.includes(row.id));
  const needsAttentionCount = summary.due + summary.failed;
  const completedCount = summary.sent + summary.canceled;

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
      <section className="settings-dark-hero scheduled-messages-hero">
        <div className="settings-dark-copy">
          <span className="badge connexa-public-badge">Scheduled messages</span>
          <h1>Scheduled queue should feel operational at a glance.</h1>
          <p>
            Review what needs action now, what is waiting in the queue, and what already finished without digging
            through live conversations.
          </p>
        </div>

        <div className="scheduled-hero-strip">
          <div className="settings-dark-status-card scheduled-hero-card waiting">
            <span>Waiting</span>
            <strong>{summary.scheduled}</strong>
            <p>Jobs queued for future send times.</p>
          </div>
          <div className="settings-dark-status-card scheduled-hero-card attention">
            <span>Needs attention</span>
            <strong>{needsAttentionCount}</strong>
            <p>Due now or failed jobs that need an operator.</p>
          </div>
          <div className="settings-dark-status-card scheduled-hero-card completed">
            <span>Completed</span>
            <strong>{completedCount}</strong>
            <p>Sent and canceled jobs preserved in queue history.</p>
          </div>
        </div>
      </section>

      <section className="scheduled-overview-grid">
        <article className="content-card scheduled-overview-card">
          <div className="scheduled-overview-head">
            <strong>Queue health</strong>
            <span>{summary.total} visible jobs</span>
          </div>
          <div className="scheduled-overview-stats">
            <div className="scheduled-overview-stat">
              <span>Due now</span>
              <strong>{summary.due}</strong>
            </div>
            <div className="scheduled-overview-stat">
              <span>Failed</span>
              <strong>{summary.failed}</strong>
            </div>
            <div className="scheduled-overview-stat">
              <span>Processing</span>
              <strong>{rows.filter((row) => row.statusKey === "processing").length}</strong>
            </div>
          </div>
        </article>
        <article className="content-card scheduled-overview-card">
          <div className="scheduled-overview-head">
            <strong>Queue mix</strong>
            <span>What is waiting vs completed</span>
          </div>
          <div className="scheduled-overview-stats">
            <div className="scheduled-overview-stat">
              <span>Scheduled</span>
              <strong>{summary.scheduled}</strong>
            </div>
            <div className="scheduled-overview-stat">
              <span>Sent</span>
              <strong>{summary.sent}</strong>
            </div>
            <div className="scheduled-overview-stat">
              <span>Canceled</span>
              <strong>{summary.canceled}</strong>
            </div>
          </div>
        </article>
      </section>

      <section className="content-card scheduled-messages-shell">
        <div className="card-header scheduled-messages-head">
          <div>
            <h3 className="card-title">Queue</h3>
            <p className="muted">
              {conversationId
                ? "Viewing scheduled outbound activity for one conversation."
                : "Switch views based on when outbound messages should fire and whether they need action."}
            </p>
          </div>
          <div className="scheduled-messages-filters">
            {FILTER_OPTIONS.map((option) => (
              <a
                className={`scheduled-filter-chip${filter === option.key ? " active" : ""}`}
                href={buildScheduledMessagesHref(option.key, conversationId)}
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
              title: "Needs attention",
              description: "Due now, failed, or actively processing jobs that deserve the first look.",
              rows: filter === "all" ? attentionRows : rows,
              emptyText: getAttentionEmptyText(filter),
              selectedIds,
              toggleSelected,
              isPending,
              errorById,
              runAction,
              setRescheduleTarget
            })}
            {filter === "all"
              ? renderQueueSection({
                  title: "Queue history",
                  description: "Scheduled sends and completed jobs that do not need immediate intervention.",
                  rows: historyRows,
                  emptyText: "No waiting or historical jobs in this view.",
                  selectedIds,
                  toggleSelected,
                  isPending,
                  errorById,
                  runAction,
                  setRescheduleTarget
                })
              : null}
          </div>
        ) : (
          <div className="scheduled-messages-empty">
            <strong>{getEmptyTitle(filter)}</strong>
            <p className="muted">{getEmptyDescription(filter, conversationId)}</p>
          </div>
        )}
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

function buildScheduledMessagesHref(filter: ScheduledMessagesFilter, conversationId?: string | null) {
  const params = new URLSearchParams();

  if (filter !== "scheduled") {
    params.set("filter", filter);
  }

  if (conversationId) {
    params.set("conversationId", conversationId);
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

function getAttentionEmptyText(filter: ScheduledMessagesFilter) {
  if (filter === "all") {
    return "Nothing needs attention right now.";
  }

  return "No jobs in this view need immediate action.";
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
      <div className="scheduled-queue-section-head">
        <div>
          <h4>{input.title}</h4>
          <p>{input.description}</p>
        </div>
        <span className="scheduled-queue-section-count">{input.rows.length}</span>
      </div>
      <div className="scheduled-bucket-list">
        {groupRowsByTimeBucket(input.rows).map((bucket) => (
          <section className="scheduled-time-bucket" key={bucket.key}>
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
                          </div>
                        </div>
                        <span className={`scheduled-status-pill ${row.statusKey}`}>{row.status}</span>
                      </div>

                      <p className="scheduled-message-preview">{row.bodyPreview}</p>

                      <div className="scheduled-message-meta">
                        <span>Scheduled for {row.scheduledFor}</span>
                        <span>Queued {row.createdAt}</span>
                        <span>Created by {row.createdBy}</span>
                        {row.attachmentName ? <span>Attachment {row.attachmentName}</span> : null}
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
