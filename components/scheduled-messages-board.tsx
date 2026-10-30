"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ScheduleSendDialog } from "@/components/inbox/schedule-send-dialog";
import type { ScheduledMessagesFilter } from "@/lib/scheduled-messages";

type ScheduledMessageRow = {
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
};

type ScheduledMessagesBoardProps = {
  conversationId?: string | null;
  channelId?: string | null;
  filter: ScheduledMessagesFilter;
  rows: ScheduledMessageRow[];
  summary: {
    scheduled: number;
    due: number;
    sent: number;
    failed: number;
    canceled: number;
    total: number;
  };
};

type ConfirmationAction = {
  action: "cancel" | "send-now";
  jobIds: string[];
};

const FILTER_OPTIONS: Array<{ key: ScheduledMessagesFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "scheduled", label: "Scheduled" },
  { key: "due", label: "Due now" },
  { key: "failed", label: "Failed" },
  { key: "canceled", label: "Canceled" },
  { key: "sent", label: "Sent" }
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
  const [confirmation, setConfirmation] = useState<ConfirmationAction | null>(null);

  const actionableRows = rows.filter(isActionableRow);
  const allActionableSelected = actionableRows.length > 0 && actionableRows.every((row) => selectedIds.includes(row.id));
  const selectedCount = selectedIds.length;
  const visibleTotal = getFilterCount(filter, summary);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && confirmation && !isPending) {
        setConfirmation(null);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [confirmation, isPending]);

  const runAction = (jobId: string, payload: { action: "cancel" | "reschedule" | "send-now"; scheduledFor?: string }) => {
    setErrorById((current) => ({ ...current, [jobId]: "" }));
    setBulkError(null);

    startTransition(async () => {
      const response = await fetch(`/api/outbound-message-jobs/${jobId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
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

  const runBulkAction = (action: "cancel" | "send-now", jobIds: string[]) => {
    setBulkError(null);

    startTransition(async () => {
      const response = await fetch("/api/outbound-message-jobs/bulk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, jobIds })
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

  const confirmAction = () => {
    if (!confirmation) return;
    const { action, jobIds } = confirmation;
    setConfirmation(null);

    if (jobIds.length === 1) {
      runAction(jobIds[0], { action });
      return;
    }
    runBulkAction(action, jobIds);
  };

  const toggleSelected = (jobId: string) => {
    setSelectedIds((current) => (current.includes(jobId) ? current.filter((value) => value !== jobId) : [...current, jobId]));
  };

  return (
    <section className="scheduled-messages-page">
      <header className="scheduled-messages-page-header">
        <div>
          <span className="scheduled-messages-eyebrow">Outbound queue</span>
          <h1>Scheduled Messages</h1>
          <p>{conversationId ? "Manage outbound jobs for this conversation." : "Manage scheduled and queued outbound messages."}</p>
        </div>
        <div className="scheduled-summary" aria-label="Scheduled message summary">
          <SummaryItem label="total" value={summary.total} />
          <SummaryItem label="scheduled" value={summary.scheduled} />
          <SummaryItem label="due now" value={summary.due} />
          <SummaryItem label="failed" value={summary.failed} />
        </div>
        <p className="scheduled-queue-helper">
          {selectedCount
            ? `${selectedCount} selected for bulk action.`
            : `${actionableRows.length} actionable ${actionableRows.length === 1 ? "job" : "jobs"} · Filter the queue below to manage scheduled messages.`}
        </p>
      </header>

      <section className="scheduled-queue-panel" aria-label="Scheduled message queue">
        <nav aria-label="Scheduled message status filters" className="scheduled-status-filters">
          {FILTER_OPTIONS.map((option) => {
            const count = getFilterCount(option.key, summary);
            const isActive = filter === option.key;
            return (
              <a
                aria-current={isActive ? "page" : undefined}
                className={`scheduled-status-filter${isActive ? " active" : ""}${count === 0 ? " is-empty" : ""}`}
                href={buildScheduledMessagesHref(option.key, conversationId, channelId)}
                key={option.key}
              >
                <span>{option.label}</span>
                <strong>{count}</strong>
              </a>
            );
          })}
        </nav>

        {selectedCount ? (
          <div className="scheduled-bulk-toolbar" role="status">
            <strong>{selectedCount} selected</strong>
            <div className="scheduled-bulk-actions">
              <button className="button button-secondary" disabled={isPending} onClick={() => setConfirmation({ action: "send-now", jobIds: selectedIds })} type="button">
                Send selected now
              </button>
              <button className="button button-danger" disabled={isPending} onClick={() => setConfirmation({ action: "cancel", jobIds: selectedIds })} type="button">
                Cancel selected
              </button>
              <button className="button button-ghost" disabled={isPending} onClick={() => setSelectedIds([])} type="button">
                Clear selection
              </button>
            </div>
          </div>
        ) : null}

        {bulkError ? <div className="scheduled-message-error" role="alert">{bulkError}</div> : null}

        {rows.length ? (
          <>
            <div className="scheduled-table-scroll">
              <table className="scheduled-message-table">
                <colgroup>
                  <col className="scheduled-column-selection" />
                  <col className="scheduled-column-recipient" />
                  <col className="scheduled-column-message" />
                  <col className="scheduled-column-time" />
                  <col className="scheduled-column-creator" />
                  <col className="scheduled-column-status" />
                  <col className="scheduled-column-actions" />
                </colgroup>
                <thead>
                  <tr>
                    <th scope="col">
                      {actionableRows.length ? (
                        <label className="scheduled-select-all">
                          <input
                            aria-label="Select all actionable scheduled messages"
                            checked={allActionableSelected}
                            onChange={() => setSelectedIds(allActionableSelected ? [] : actionableRows.map((row) => row.id))}
                            type="checkbox"
                          />
                        </label>
                      ) : null}
                    </th>
                    <th scope="col">Recipient</th>
                    <th scope="col">Message preview</th>
                    <th scope="col">Scheduled for</th>
                    <th scope="col">Created by</th>
                    <th scope="col">Status</th>
                    <th scope="col"><span className="visually-hidden">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <ScheduledMessageTableRow
                      error={errorById[row.id]}
                      isPending={isPending}
                      key={row.id}
                      onConfirm={(action) => setConfirmation({ action, jobIds: [row.id] })}
                      onReschedule={() => setRescheduleTarget({ id: row.id, scheduledForIso: row.scheduledForIso })}
                      onToggleSelected={() => toggleSelected(row.id)}
                      row={row}
                      selected={selectedIds.includes(row.id)}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            <div className="scheduled-mobile-list">
              {rows.map((row) => (
                <ScheduledMessageMobileCard
                  error={errorById[row.id]}
                  isPending={isPending}
                  key={row.id}
                  onConfirm={(action) => setConfirmation({ action, jobIds: [row.id] })}
                  onReschedule={() => setRescheduleTarget({ id: row.id, scheduledForIso: row.scheduledForIso })}
                  onToggleSelected={() => toggleSelected(row.id)}
                  row={row}
                  selected={selectedIds.includes(row.id)}
                />
              ))}
            </div>
          </>
        ) : (
          <div className="scheduled-messages-empty">
            <strong>{getEmptyTitle(filter)}</strong>
            <p>{getEmptyDescription(filter, conversationId)}</p>
          </div>
        )}

        <footer className="scheduled-queue-footer">
          <span>{`Showing ${rows.length} of ${visibleTotal} ${visibleTotal === 1 ? "job" : "jobs"}`}</span>
        </footer>
      </section>

      <ScheduleSendDialog
        initialValue={rescheduleTarget?.scheduledForIso ?? null}
        isOpen={Boolean(rescheduleTarget)}
        isPending={isPending}
        onClose={() => setRescheduleTarget(null)}
        onSave={(value) => {
          if (rescheduleTarget) runAction(rescheduleTarget.id, { action: "reschedule", scheduledFor: value });
        }}
      />

      {confirmation ? (
        <div className="inbox-dialog-backdrop" onClick={() => !isPending && setConfirmation(null)}>
          <section aria-labelledby="scheduled-action-confirmation-title" aria-modal="true" className="inbox-dialog confirmation-dialog" onClick={(event) => event.stopPropagation()} role="dialog">
            <div className="inbox-dialog-head">
              <div>
                <strong id="scheduled-action-confirmation-title">{confirmation.action === "send-now" ? "Send scheduled message now?" : "Cancel scheduled message?"}</strong>
                <p>
                  {confirmation.action === "send-now"
                    ? `${confirmation.jobIds.length} selected ${confirmation.jobIds.length === 1 ? "message will" : "messages will"} bypass the scheduled time and send immediately.`
                    : `${confirmation.jobIds.length} selected ${confirmation.jobIds.length === 1 ? "message will" : "messages will"} be canceled. This cannot be undone.`}
                </p>
              </div>
              <button aria-label="Close confirmation" className="inbox-dialog-close" disabled={isPending} onClick={() => setConfirmation(null)} type="button">×</button>
            </div>
            <div className="inbox-dialog-actions">
              <button className="inbox-dialog-secondary" disabled={isPending} onClick={() => setConfirmation(null)} type="button">Keep scheduled</button>
              <button className={confirmation.action === "cancel" ? "confirmation-dialog-danger" : "inbox-dialog-primary"} disabled={isPending} onClick={confirmAction} type="button">
                {confirmation.action === "send-now" ? "Send now" : "Cancel messages"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}

function SummaryItem({ label, value }: { label: string; value: number }) {
  return <span className="scheduled-summary__item"><strong>{value}</strong><small>{label}</small></span>;
}

function ScheduledMessageTableRow({ error, isPending, onConfirm, onReschedule, onToggleSelected, row, selected }: ScheduledMessageRowProps) {
  const isActionable = isActionableRow(row);
  const recipient = getRecipient(row);

  return (
    <tr className={`scheduled-message-table-row ${row.statusKey}`}>
      <td>
        {isActionable ? <label className="scheduled-row-select"><input aria-label={`Select scheduled message for ${recipient.primary}`} checked={selected} onChange={onToggleSelected} type="checkbox" /></label> : null}
      </td>
      <td><RecipientCell recipient={recipient} /></td>
      <td>
        <p className="scheduled-message-preview" title={row.bodyPreview}>{row.bodyPreview || "No message content"}</p>
        {row.attachmentUrl ? <a className="scheduled-message-attachment-link" href={row.attachmentUrl} rel="noreferrer" target="_blank">{row.attachmentName || "Open attachment"}</a> : null}
        {row.lastError || error ? <div className="scheduled-message-error">{row.lastError || error}</div> : null}
      </td>
      <td><time dateTime={row.scheduledForIso} title={row.scheduledForIso}>{row.scheduledFor}</time></td>
      <td>{row.createdBy || "—"}</td>
      <td><span className={`scheduled-status-pill ${row.statusKey}`}>{row.status}</span></td>
      <td><ScheduledMessageActions isActionable={isActionable} isPending={isPending} onConfirm={onConfirm} onReschedule={onReschedule} recipient={recipient.primary} row={row} /></td>
    </tr>
  );
}

function ScheduledMessageMobileCard({ error, isPending, onConfirm, onReschedule, onToggleSelected, row, selected }: ScheduledMessageRowProps) {
  const isActionable = isActionableRow(row);
  const recipient = getRecipient(row);

  return (
    <article className={`scheduled-message-mobile-card ${row.statusKey}`}>
      <div className="scheduled-mobile-card-head">
        <div className="scheduled-mobile-recipient">
          {isActionable ? <label className="scheduled-row-select"><input aria-label={`Select scheduled message for ${recipient.primary}`} checked={selected} onChange={onToggleSelected} type="checkbox" /></label> : null}
          <RecipientCell recipient={recipient} />
        </div>
        <span className={`scheduled-status-pill ${row.statusKey}`}>{row.status}</span>
      </div>
      <p className="scheduled-message-preview" title={row.bodyPreview}>{row.bodyPreview || "No message content"}</p>
      <dl className="scheduled-mobile-meta"><div><dt>Scheduled</dt><dd><time dateTime={row.scheduledForIso}>{row.scheduledFor}</time></dd></div><div><dt>Created by</dt><dd>{row.createdBy || "—"}</dd></div></dl>
      {row.attachmentUrl ? <a className="scheduled-message-attachment-link" href={row.attachmentUrl} rel="noreferrer" target="_blank">{row.attachmentName || "Open attachment"}</a> : null}
      {row.lastError || error ? <div className="scheduled-message-error">{row.lastError || error}</div> : null}
      <ScheduledMessageActions isActionable={isActionable} isPending={isPending} onConfirm={onConfirm} onReschedule={onReschedule} recipient={recipient.primary} row={row} />
    </article>
  );
}

type ScheduledMessageRowProps = {
  error?: string;
  isPending: boolean;
  onConfirm: (action: "cancel" | "send-now") => void;
  onReschedule: () => void;
  onToggleSelected: () => void;
  row: ScheduledMessageRow;
  selected: boolean;
};

function ScheduledMessageActions({ isActionable, isPending, onConfirm, onReschedule, recipient, row }: Pick<ScheduledMessageRowProps, "isPending" | "onConfirm" | "onReschedule" | "row"> & { isActionable: boolean; recipient: string }) {
  return (
    <details className="scheduled-row-actions">
      <summary aria-label={`Actions for scheduled message to ${recipient}`}><span aria-hidden="true">⋯</span></summary>
      <div className="scheduled-row-actions-menu" role="menu">
        {isActionable ? <button disabled={isPending} onClick={() => onConfirm("send-now")} role="menuitem" type="button">Send now</button> : null}
        {isActionable ? <button disabled={isPending} onClick={onReschedule} role="menuitem" type="button">Reschedule</button> : null}
        <a href={`/inbox?conversationId=${row.conversationId}`} role="menuitem">Open conversation</a>
        {isActionable ? <button className="is-destructive" disabled={isPending} onClick={() => onConfirm("cancel")} role="menuitem" type="button">Cancel</button> : null}
      </div>
    </details>
  );
}

function RecipientCell({ recipient }: { recipient: { primary: string; secondary: string | null } }) {
  return <div className="scheduled-recipient"><strong>{recipient.primary}</strong>{recipient.secondary ? <span>{recipient.secondary}</span> : null}</div>;
}

function getRecipient(row: ScheduledMessageRow) {
  const name = row.contactName?.trim();
  const phone = row.phone?.trim();
  const hasContactName = Boolean(name && name !== "Unknown contact");
  return {
    primary: hasContactName ? name! : phone || "Unknown recipient",
    secondary: hasContactName && phone && phone !== name ? phone : null
  };
}

function isActionableRow(row: ScheduledMessageRow) {
  return row.statusKey === "scheduled" || row.statusKey === "due" || row.statusKey === "failed";
}

function buildScheduledMessagesHref(filter: ScheduledMessagesFilter, conversationId?: string | null, channelId?: string | null) {
  const params = new URLSearchParams();
  if (filter !== "scheduled") params.set("filter", filter);
  if (conversationId) params.set("conversationId", conversationId);
  if (channelId) params.set("channelId", channelId);
  const query = params.toString();
  return query ? `/scheduled-messages?${query}` : "/scheduled-messages";
}

function getFilterCount(filter: ScheduledMessagesFilter, summary: ScheduledMessagesBoardProps["summary"]) {
  switch (filter) {
    case "scheduled": return summary.scheduled;
    case "due": return summary.due;
    case "failed": return summary.failed;
    case "canceled": return summary.canceled;
    case "sent": return summary.sent;
    case "all": return summary.total;
  }
}

function getEmptyTitle(filter: ScheduledMessagesFilter) {
  if (filter === "failed") return "No failed scheduled messages";
  if (filter === "due") return "Nothing is due right now";
  if (filter === "all") return "No scheduled messages";
  return `No ${FILTER_OPTIONS.find((option) => option.key === filter)?.label.toLowerCase() ?? "scheduled"} messages`;
}

function getEmptyDescription(filter: ScheduledMessagesFilter, conversationId?: string | null) {
  if (conversationId) return "This conversation does not have outbound jobs in the selected queue view.";
  if (filter === "failed") return "Failed jobs will appear here when a delivery or queue action fails.";
  return "Messages scheduled for future delivery will appear here.";
}
