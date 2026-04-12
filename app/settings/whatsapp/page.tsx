import { DashboardShell } from "@/components/dashboard-shell";
import { OutboundWorkerStatusCard } from "@/components/outbound-worker-status-card";
import { WhatsAppSetupForm } from "@/components/whatsapp-setup-form";
import { requireManager } from "@/lib/auth/current-user";
import { getOutboundMessageJobStatus } from "@/lib/outbound-message-jobs";
import {
  getWhatsAppProviderMode,
  getWorkspaceWhatsAppChannelStatus
} from "@/lib/whatsapp-channel";

export default async function WhatsAppSetupPage() {
  const manager = await requireManager();
  const [channel, outboundWorkerStatus] = await Promise.all([
    getWorkspaceWhatsAppChannelStatus(manager.workspaceId),
    getOutboundMessageJobStatus(manager.workspaceId)
  ]);
  const providerMode = getWhatsAppProviderMode();
  const completedCount = [
    Boolean(channel?.sessionClientId),
    channel?.connectionStatus === "CONNECTED",
    Boolean(channel?.phoneNumber),
    Boolean(channel?.connectedByAgentId)
  ].filter(Boolean).length;

  return (
    <DashboardShell currentPath="/settings">
      <section className="settings-dark-hero">
        <div className="settings-dark-copy">
          <span className="badge connexa-public-badge">WhatsApp setup</span>
          <h1>Connect WhatsApp Web with a QR scan and keep that session tied to this login.</h1>
          <p>
            Connexa now uses `whatsapp-web.js`, so a manager can start a QR session from this
            page and reuse the saved local auth session on later restarts.
          </p>
        </div>

        <div className="settings-dark-status">
          <div className="settings-dark-status-card whatsapp-setup-status-card">
            <span>Connection status</span>
            <strong>{completedCount}/4 required items configured</strong>
            <p>
              The QR flow is active when the runtime has a local auth session, a connected agent,
              and a live WhatsApp Web connection.
            </p>
            <div className="whatsapp-status-row">
              <span className="whatsapp-status-pill is-ready">{providerMode}</span>
              <span className={`whatsapp-status-pill${channel?.sessionClientId ? " is-ready" : ""}`}>
                Local auth
              </span>
              <span className={`whatsapp-status-pill${channel?.connectedByAgentId ? " is-ready" : ""}`}>
                Bound login
              </span>
              <span className={`whatsapp-status-pill${channel?.phoneNumber ? " is-ready" : ""}`}>
                WhatsApp account
              </span>
              <span className={`whatsapp-status-pill${channel?.connectionStatus === "CONNECTED" ? " is-ready" : ""}`}>
                Connected
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="whatsapp-setup-grid">
        <WhatsAppSetupForm
          initialValues={{
            connectionStatus: channel?.connectionStatus ?? "DISCONNECTED",
            connectedByAgentName: channel?.connectedByAgentName ?? manager.name,
            displayName: channel?.displayName ?? "",
            phoneNumber: channel?.phoneNumber ?? "",
            lastError: channel?.lastError ?? "",
            connectedAt: channel?.connectedAt?.toISOString() ?? null
          }}
        />

        <OutboundWorkerStatusCard
          initialStatus={outboundWorkerStatus}
          workerConfig={{
            endpointConfigured: Boolean(process.env.OUTBOUND_WORKER_TOKEN?.trim()),
            appUrl: process.env.APP_URL?.trim() ?? null
          }}
        />

        <article className="content-card settings-dark-panel whatsapp-setup-panel">
          <div className="card-header settings-dark-panel-head">
            <div>
              <h3 className="card-title">Stored session</h3>
              <p className="muted">This workspace keeps one active WhatsApp Web session at a time.</p>
            </div>
          </div>

          <div className="whatsapp-setup-fields">
            <label className="control-block">
              <span className="control-label">Current status</span>
              <input className="control-input" readOnly type="text" value={channel?.connectionStatus ?? "DISCONNECTED"} />
            </label>

            <label className="control-block">
              <span className="control-label">Connected by</span>
              <input
                className="control-input"
                readOnly
                type="text"
                value={channel?.connectedByAgentName ?? "No active login"}
              />
            </label>

            <label className="control-block">
              <span className="control-label">WhatsApp number</span>
              <input
                className="control-input"
                readOnly
                type="text"
                value={channel?.phoneNumber ?? "Not connected yet"}
              />
            </label>

            <label className="control-block">
              <span className="control-label">Profile name</span>
              <input
                className="control-input"
                readOnly
                type="text"
                value={channel?.displayName ?? "Not connected yet"}
              />
            </label>
          </div>
        </article>
      </section>

      <section className="whatsapp-setup-grid whatsapp-setup-grid-secondary">
        <article className="content-card settings-dark-panel whatsapp-setup-panel">
          <div className="card-header settings-dark-panel-head">
            <div>
              <h3 className="card-title">Setup steps</h3>
              <p className="muted">This is the shortest path to getting the inbox live.</p>
            </div>
          </div>

          <div className="whatsapp-step-list">
            <div className="whatsapp-step-item">
              <strong>1. Start the WhatsApp Web runtime</strong>
              <p className="table-subtle">
                Click <code>Generate QR</code> to boot a `whatsapp-web.js` client for the current
                manager login.
              </p>
            </div>
            <div className="whatsapp-step-item">
              <strong>2. Scan the QR code with the phone</strong>
              <p className="table-subtle">
                Open WhatsApp on the phone, go to linked devices, and scan the QR shown on this page.
              </p>
            </div>
            <div className="whatsapp-step-item">
              <strong>3. Connexa stores the session for this login</strong>
              <p className="table-subtle">
                The auth files are kept locally and the workspace record stores which manager login
                created the active session.
              </p>
            </div>
            <div className="whatsapp-step-item">
              <strong>4. Send and receive messages from the inbox</strong>
              <p className="table-subtle">
                Text messages flow through the existing inbox and conversation models once the client
                is connected.
              </p>
            </div>
          </div>
        </article>

        <article className="content-card settings-dark-panel whatsapp-setup-panel">
          <div className="card-header settings-dark-panel-head">
            <div>
              <h3 className="card-title">Current limitations</h3>
              <p className="muted">These are the practical boundaries of the current implementation.</p>
            </div>
          </div>

          <div className="panel-row">
            <div className="lead-row">
              <strong>One active WhatsApp session per workspace</strong>
              <div className="table-subtle">
                The session is created by one login at a time, even though the auth files are keyed
                by agent login.
              </div>
            </div>
            <div className="lead-row">
              <strong>Focused on text-first messaging</strong>
              <div className="table-subtle">
                Inbound text and outbound text are the primary path. Attachments are sent through
                WhatsApp Web when available.
              </div>
            </div>
            <div className="lead-row">
              <strong>Runtime must stay on a Node server</strong>
              <div className="table-subtle">
                `whatsapp-web.js` depends on a live server process and local auth files, so
                serverless deployment is not a good fit.
              </div>
            </div>
          </div>
        </article>
      </section>
    </DashboardShell>
  );
}
