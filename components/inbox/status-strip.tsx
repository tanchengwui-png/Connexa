import type { InboxSummary, InboxWhatsAppStatus } from "@/components/inbox/types";

type StatusStripProps = {
  summary: InboxSummary;
  whatsapp: InboxWhatsAppStatus;
};

export function InboxStatusStrip({ summary, whatsapp }: StatusStripProps) {
  const stateLabel =
    whatsapp.mode === "mock"
      ? "Mock mode"
      : whatsapp.isLiveOnlyMode
        ? "Live only mode"
      : whatsapp.isInboxReady
        ? "Inbox ready"
        : whatsapp.isHistoryStuck
          ? "Connected, import stuck"
        : whatsapp.isConfigured
          ? "Connected, stabilizing"
          : "Setup needed";
  const stateDescription =
    whatsapp.mode === "mock"
      ? "Automation replies are simulated locally"
      : whatsapp.isLiveOnlyMode
        ? "WhatsApp is live for new inbound and outbound traffic. Historical import has been deferred because the earlier sync stalled."
      : whatsapp.isHistoryStuck
        ? "WhatsApp is connected, but historical import appears stuck. New live messages should still arrive. Consider removing and relinking the number if this does not improve."
      : whatsapp.isHistoryStabilizing
        ? "Historical chat import is still stabilizing. New live messages should still appear."
        : `Phone ${whatsapp.phoneNumberId ?? "Not set"}`;

  return (
    <div className="inbox-status-strip">
      <div className="inbox-status-strip-main">
        <span className={`inbox-status-state${whatsapp.isInboxReady ? " ready" : whatsapp.isConfigured ? " live" : ""}`}>
          {stateLabel}
        </span>
        <span className="inbox-status-copy">
          <strong>WhatsApp</strong>
          <span>{stateDescription}</span>
          <span>
            Imported {whatsapp.importedConversationCount} conversations and {whatsapp.importedMessageCount} messages
          </span>
          <span>Last channel update {whatsapp.updatedAt ?? "Not available"}</span>
          {whatsapp.lastSyncError ? <span>Latest sync issue: {whatsapp.lastSyncError}</span> : null}
        </span>
      </div>

      <div className="inbox-status-strip-summary">
        <span>{summary.open} open</span>
        <span>{summary.pending} pending</span>
        <span>{summary.unassigned} unassigned</span>
        <span>{summary.hotLeads} hot leads</span>
      </div>

      <div className="inbox-status-strip-actions">
        <a href="/settings/whatsapp">Setup</a>
        <a href={whatsapp.callbackUrl} rel="noreferrer" target="_blank">
          Webhook
        </a>
      </div>
    </div>
  );
}
