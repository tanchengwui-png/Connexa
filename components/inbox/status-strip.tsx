import type { InboxSummary, InboxWhatsAppStatus } from "@/components/inbox/types";
import { SyncIcon } from "@/components/inbox/icons";

type StatusStripProps = {
  summary: InboxSummary;
  whatsapp: InboxWhatsAppStatus;
};

export function InboxStatusStrip({ summary, whatsapp }: StatusStripProps) {
  const isHistoryDeferred = whatsapp.historySyncPhase === "deferred";
  const isHistoryError = whatsapp.historySyncPhase === "error" || whatsapp.isHistoryStuck;
  const isHistoryComplete =
    whatsapp.historySyncPhase === "idle" &&
    !whatsapp.historySyncActive &&
    whatsapp.historySyncFullyCaughtUp;
  const historyStateLabel = isHistoryComplete
    ? "History up to date"
    : getHistoryPhaseLabel(whatsapp.historySyncPhase, whatsapp.historySyncActive);
  const processedChats = Math.min(
    whatsapp.historySyncProcessedChats,
    whatsapp.historySyncTotalChats ?? whatsapp.historySyncProcessedChats
  );
  const progressLabel = whatsapp.historySyncActive
    ? whatsapp.historySyncTotalChats && processedChats > 0
      ? `${historyStateLabel} ${processedChats} / ${whatsapp.historySyncTotalChats}`
      : historyStateLabel
    : historyStateLabel;
  const progressPercent = whatsapp.historySyncTotalChats
    ? Math.min(100, Math.max(0, (processedChats / whatsapp.historySyncTotalChats) * 100))
    : null;
  const stateDescription =
    whatsapp.mode === "mock"
      ? "Automation replies are simulated locally"
      : isHistoryDeferred
        ? "WhatsApp is live for new inbound and outbound traffic. Historical import has been deferred because the earlier sync stalled."
      : isHistoryError
      ? "WhatsApp is connected, but historical import has not progressed recently. New live messages still arrive while Connexa isolates a problematic chat and continues automatically."
      : whatsapp.historySyncActive
        ? "History work is active. Live incoming and outgoing messages continue on their priority path."
        : isHistoryComplete
          ? "History is up to date. The next lightweight reconciliation runs automatically in the background."
          : whatsapp.historySyncPhase === "idle"
            ? "WhatsApp is connected. Connexa is checking the latest history-sync state."
          : `Phone ${whatsapp.phoneNumberId ?? "Not set"}`;
  const lastProgress = formatStatusTime(whatsapp.historySyncProgressAt ?? whatsapp.historySyncLastSuccessfulAt);
  const statusTimeLabel = isHistoryComplete
    ? `Completed ${formatStatusTime(whatsapp.historySyncLastSuccessfulAt)}`
    : `Last progress ${lastProgress}`;

  return (
    <details
      className={`inbox-history-sync-compact${isHistoryDeferred || isHistoryError ? " is-history-attention" : ""}${whatsapp.historySyncActive ? " is-active" : ""}${isHistoryComplete ? " is-complete" : ""}`}
    >
      <summary
        aria-label={`${progressLabel}. Open sync details.`}
        title={`${progressLabel}. Open sync details.`}
      >
        <span aria-hidden="true" className={`inbox-history-sync-dot${whatsapp.historySyncActive ? " is-active" : ""}`} />
        <SyncIcon />
        <span className="inbox-history-sync-summary-copy">
          <strong>{progressLabel}</strong>
          <small>{statusTimeLabel}</small>
        </span>
      </summary>
      <div className="inbox-history-sync-popover" role="status">
        <div className="inbox-history-sync-popover-head">
          <span>WhatsApp</span>
          <strong>{historyStateLabel}</strong>
        </div>
        <p>{stateDescription}</p>
        {whatsapp.historySyncActive && progressPercent !== null ? (
          <div
            aria-label={`${Math.round(progressPercent)}% of chats processed`}
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={Math.round(progressPercent)}
            className="inbox-history-sync-progress"
            role="progressbar"
          >
            <span style={{ width: `${progressPercent}%` }} />
          </div>
        ) : null}
        <span className="inbox-history-sync-meta">
          {whatsapp.historySyncTotalChats && processedChats > 0
            ? `${processedChats} / ${whatsapp.historySyncTotalChats} chats processed`
            : `${whatsapp.importedConversationCount} chats and ${whatsapp.importedMessageCount} messages imported`}
          {` · ${whatsapp.historySyncRemainingChats} remaining · ${whatsapp.historySyncDeferredChats} deferred · ${whatsapp.historySyncNewMessages} new`}
          {isHistoryComplete
            ? ` · Completed ${formatStatusTime(whatsapp.historySyncLastSuccessfulAt)}`
            : ` · Last progress ${lastProgress}`}
        </span>
        {whatsapp.lastSyncError ? (
          <span className="inbox-history-sync-error">Latest sync issue: {whatsapp.lastSyncError}</span>
        ) : null}
        <div className="inbox-history-sync-counts">
          <span>{summary.open} open</span>
          <span>{summary.pending} pending</span>
          <span>{summary.unassigned} unassigned</span>
          <span>{summary.hotLeads} hot leads</span>
        </div>
      </div>
    </details>
  );
}

function getHistoryPhaseLabel(phase: InboxWhatsAppStatus["historySyncPhase"], active: boolean) {
  switch (phase) {
    case "fast_bootstrap": return active ? "Loading recent chats" : "Recent-chat bootstrap queued";
    case "incremental_sync": return active ? "Importing older history" : "History import queued";
    case "media_enrichment": return active ? "Enriching media" : "Media enrichment queued";
    case "initial_import": return active ? "Importing history" : "History import queued";
    case "catch_up": return active ? "Catching up" : "Catch-up queued";
    case "reconcile": return active ? "Reconciling" : "Reconciliation queued";
    case "deferred": return "History sync deferred";
    case "error": return "History sync needs attention";
    case "disconnected": return "WhatsApp disconnected";
    case "idle": return active ? "Checking history" : "Checking history status";
    default: return "Checking history status";
  }
}

function formatStatusTime(value: string | null) {
  if (!value) return "not available";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "not available";
  return new Intl.DateTimeFormat("en-MY", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Kuala_Lumpur"
  }).format(parsed);
}
