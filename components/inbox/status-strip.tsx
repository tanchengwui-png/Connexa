import type { InboxSummary, InboxWhatsAppStatus } from "@/components/inbox/types";

type StatusStripProps = {
  summary: InboxSummary;
  whatsapp: InboxWhatsAppStatus;
};

export function InboxStatusStrip({ summary, whatsapp }: StatusStripProps) {
  return (
    <div className="inbox-status-strip">
      <div className="inbox-status-strip-main">
        <span className={`inbox-status-state${whatsapp.isConfigured ? " ready" : ""}`}>
          {whatsapp.mode === "mock" ? "Mock mode" : whatsapp.isConfigured ? "Connected" : "Setup needed"}
        </span>
        <span className="inbox-status-copy">
          <strong>WhatsApp</strong>
          <span>{whatsapp.mode === "mock" ? "Automation replies are simulated locally" : `Phone ID ${whatsapp.phoneNumberId ?? "Not set"}`}</span>
          <span>Last sync {whatsapp.updatedAt ?? "Not available"}</span>
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
