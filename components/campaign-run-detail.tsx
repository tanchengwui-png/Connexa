"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

type CampaignRunDetailProps = {
  run: {
    id: string;
    name: string;
    messageBody: string;
    scheduleAt: string;
    selectedAttachmentIds: string[];
    recipientCount: number;
    queuedJobCount: number;
    excludedCount: number;
    pendingJobCount: number;
    processingJobCount: number;
    sentJobCount: number;
    failedJobCount: number;
    canceledJobCount: number;
    createdAt: string;
    createdByName: string | null;
    recipients: Array<{
      id: string;
      status: "QUEUED" | "EXCLUDED";
      reason: string | null;
      queuedJobCount: number;
      conversationId: string | null;
      contact: {
        id: string;
        displayName: string;
        phone: string;
        ownerName: string;
      };
      scheduledJobCount: number;
      processingJobCount: number;
      sentJobCount: number;
      failedJobCount: number;
      canceledJobCount: number;
      jobs: Array<{
        id: string;
        status: string;
        availableAt: string;
        lastError: string | null;
        preview: string;
      }>;
    }>;
  };
};

type RecipientFilter = "all" | "scheduled" | "processing" | "sent" | "failed" | "excluded";

export function CampaignRunDetail({ run }: CampaignRunDetailProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string | null>(null);
  const [recipientFilter, setRecipientFilter] = useState<RecipientFilter>("all");
  const [searchValue, setSearchValue] = useState("");
  const hasActionableJobs = run.pendingJobCount + run.processingJobCount + run.failedJobCount > 0;
  const filteredRecipients = useMemo(
    () => {
      const query = searchValue.trim().toLowerCase();

      return run.recipients.filter((recipient) => {
        if (!matchesRecipientFilter(recipientFilter, recipient)) {
          return false;
        }

        if (!query) {
          return true;
        }

        return [
          recipient.contact.displayName,
          recipient.contact.phone,
          recipient.contact.ownerName
        ]
          .join(" ")
          .toLowerCase()
          .includes(query);
      });
    },
    [recipientFilter, run.recipients, searchValue]
  );

  const runBulkAction = (action: "cancel" | "send-now") => {
    setActionError(null);

    startTransition(async () => {
      const response = await fetch(`/api/campaigns/${run.id}/jobs`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ action })
      });

      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        setActionError(payload?.error ?? "Unable to update campaign run jobs.");
        return;
      }

      router.refresh();
    });
  };

  return (
    <section className="campaign-run-shell">
      <section className="hero campaigns-hero">
        <div>
          <span className="badge">Campaign Run</span>
          <h2>{run.name}</h2>
          <p className="muted">
            Created {formatDateTime(run.createdAt)}
            {run.createdByName ? ` by ${run.createdByName}` : ""}.
            {run.scheduleAt ? ` Scheduled for ${formatDateTime(run.scheduleAt)}.` : " Queued immediately."}
          </p>
        </div>
        <div className="campaign-run-header-actions">
          <Link className="button button-secondary" href="/campaigns">
            Back to campaigns
          </Link>
        </div>
      </section>

      <section className="campaigns-overview-grid">
        <article className="content-card campaigns-overview-card is-primary">
          <span className="metric-label">Recipients</span>
          <strong className="metric-value">{run.recipientCount}</strong>
          <span className="table-subtle">{run.excludedCount ? `${run.excludedCount} excluded before queueing` : "No exclusions on this run."}</span>
        </article>
        <article className="content-card campaigns-overview-card">
          <span className="metric-label">Queued jobs</span>
          <strong className="metric-value">{run.queuedJobCount}</strong>
          <span className="table-subtle">{run.selectedAttachmentIds.length ? `${run.selectedAttachmentIds.length} shared media attached` : "Text-only campaign"}</span>
        </article>
        <article className="content-card campaigns-overview-card">
          <span className="metric-label">In flight</span>
          <strong className="metric-value">{run.pendingJobCount + run.processingJobCount}</strong>
          <span className="table-subtle">{run.pendingJobCount} scheduled and {run.processingJobCount} processing or due now.</span>
        </article>
        <article className="content-card campaigns-overview-card">
          <span className="metric-label">Results</span>
          <strong className="metric-value">{run.sentJobCount}</strong>
          <span className="table-subtle">
            {run.failedJobCount} failed
            {run.canceledJobCount ? ` · ${run.canceledJobCount} canceled` : ""}.
          </span>
        </article>
      </section>

      <section className="campaign-run-grid">
        <article className="content-card campaign-run-message-card">
          <div className="card-header">
            <div>
              <h3 className="card-title">Payload</h3>
              <p className="muted">The exact content queued for this campaign run.</p>
            </div>
          </div>
          <div className="campaigns-preview-bubble">
            <div className="campaigns-preview-body">
              {run.messageBody.trim() ? renderMessageBody(run.messageBody) : <span className="table-subtle">No text body. Media-only run.</span>}
            </div>
          </div>
        </article>

        <article className="content-card campaign-run-message-card">
          <div className="card-header">
            <div>
              <h3 className="card-title">Queue summary</h3>
              <p className="muted">Each run keeps its own delivery footprint.</p>
            </div>
          </div>
          <div className="campaign-run-actions">
            <button
              className="button button-secondary"
              disabled={!hasActionableJobs || isPending}
              onClick={() => runBulkAction("send-now")}
              type="button"
            >
              {isPending ? "Updating..." : "Send All Now"}
            </button>
            <button
              className="button button-secondary"
              disabled={!hasActionableJobs || isPending}
              onClick={() => runBulkAction("cancel")}
              type="button"
            >
              {isPending ? "Updating..." : "Cancel Pending"}
            </button>
          </div>
          {actionError ? <div className="scheduled-message-error">{actionError}</div> : null}
          <div className="campaign-run-meta-list">
            <div className="campaign-run-meta-row">
              <span>Run ID</span>
              <strong>{run.id}</strong>
            </div>
            <div className="campaign-run-meta-row">
              <span>Created</span>
              <strong>{formatDateTime(run.createdAt)}</strong>
            </div>
            <div className="campaign-run-meta-row">
              <span>Schedule</span>
              <strong>{run.scheduleAt ? formatDateTime(run.scheduleAt) : "Immediate queue"}</strong>
            </div>
            <div className="campaign-run-meta-row">
              <span>Creator</span>
              <strong>{run.createdByName ?? "Unknown"}</strong>
            </div>
          </div>
        </article>
      </section>

      <section className="content-card campaign-run-recipient-card">
        <div className="card-header">
          <div>
            <h3 className="card-title">Recipients</h3>
            <p className="muted">Recipient-level queue state and links back into operations.</p>
          </div>
        </div>
        <div className="campaign-run-filter-row">
          <label className="campaigns-search-shell campaign-run-search-shell">
            <input
              className="campaigns-search-input"
              onChange={(event) => setSearchValue(event.target.value)}
              placeholder="Search recipient, phone, or owner"
              type="search"
              value={searchValue}
            />
          </label>
          {RECIPIENT_FILTER_OPTIONS.map((option) => (
            <button
              className={`scheduled-filter-chip${recipientFilter === option.key ? " active" : ""}`}
              key={option.key}
              onClick={() => setRecipientFilter(option.key)}
              type="button"
            >
              <strong>{option.label}</strong>
            </button>
          ))}
        </div>
        <div className="campaign-run-recipient-list">
          {filteredRecipients.length ? (
            filteredRecipients.map((recipient) => (
            <article className="campaign-run-recipient-row" key={recipient.id}>
              <div className="campaign-run-recipient-main">
                <div className="campaign-run-recipient-topline">
                  <div>
                    <strong>{recipient.contact.displayName}</strong>
                    <div className="campaign-run-recipient-meta">
                      <span>{recipient.contact.phone}</span>
                      <span>{recipient.contact.ownerName}</span>
                    </div>
                  </div>
                  <span className={`campaigns-eligibility-badge is-${recipient.status === "EXCLUDED" ? "excluded" : recipient.failedJobCount ? "caution" : "eligible"}`}>
                    {recipient.status === "EXCLUDED" ? "excluded" : "queued"}
                  </span>
                </div>
                <div className="campaign-run-recipient-stats">
                  <span>{recipient.queuedJobCount} queued</span>
                  <span>{recipient.sentJobCount} sent</span>
                  <span>{recipient.scheduledJobCount} scheduled</span>
                  <span>{recipient.processingJobCount} processing</span>
                  <span>{recipient.failedJobCount} failed</span>
                  {recipient.canceledJobCount ? <span>{recipient.canceledJobCount} canceled</span> : null}
                </div>
                {recipient.reason ? <div className="scheduled-message-error">{recipient.reason}</div> : null}
                {recipient.jobs.length ? (
                  <div className="campaign-run-job-list">
                    {recipient.jobs.map((job) => (
                      <div className="campaign-run-job-row" key={job.id}>
                        <div>
                          <strong>{job.preview}</strong>
                          <span>{formatDateTime(job.availableAt)}</span>
                        </div>
                        <span className="table-subtle">{job.status}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
              <div className="campaign-run-recipient-actions">
                {recipient.conversationId ? (
                  <Link className="inbox-search-tool" href={`/inbox?conversationId=${recipient.conversationId}`}>
                    Open inbox
                  </Link>
                ) : null}
                {recipient.conversationId ? (
                  <Link className="inbox-search-tool" href={`/scheduled-messages?conversationId=${recipient.conversationId}`}>
                    View queue
                  </Link>
                ) : null}
              </div>
            </article>
            ))
          ) : (
            <div className="campaigns-draft-empty">
              <strong>No recipients in this view.</strong>
              <span>Adjust the filter or search to inspect another slice of the campaign run.</span>
            </div>
          )}
        </div>
      </section>
    </section>
  );
}

const RECIPIENT_FILTER_OPTIONS: Array<{ key: RecipientFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "scheduled", label: "Scheduled" },
  { key: "processing", label: "Processing" },
  { key: "sent", label: "Sent" },
  { key: "failed", label: "Failed" },
  { key: "excluded", label: "Excluded" }
];

function matchesRecipientFilter(
  filter: RecipientFilter,
  recipient: CampaignRunDetailProps["run"]["recipients"][number]
) {
  switch (filter) {
    case "scheduled":
      return recipient.scheduledJobCount > 0;
    case "processing":
      return recipient.processingJobCount > 0;
    case "sent":
      return recipient.sentJobCount > 0;
    case "failed":
      return recipient.failedJobCount > 0;
    case "excluded":
      return recipient.status === "EXCLUDED";
    case "all":
    default:
      return true;
  }
}

function formatDateTime(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-MY", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Kuala_Lumpur"
  }).format(parsed);
}

function renderMessageBody(value: string) {
  return value.split(/\r?\n/).map((line, index) => (
    <p key={`${line}-${index}`}>{line || "\u00a0"}</p>
  ));
}
