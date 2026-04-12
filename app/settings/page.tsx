import { DashboardShell } from "@/components/dashboard-shell";
import { TestEmailButton } from "@/components/test-email-button";

export default function SettingsPage() {
  return (
    <DashboardShell currentPath="/settings">
      <section className="settings-dark-hero">
        <div className="settings-dark-copy">
          <span className="badge connexa-public-badge">Workspace settings</span>
          <h1>Configuration should stay operational, not enterprise-heavy.</h1>
          <p>
            The first release only needs the settings that make the inbox usable:
            WhatsApp connection, assignment rules, roles, and queue stages.
          </p>
        </div>

        <div className="settings-dark-status">
          <div className="settings-dark-status-card">
            <span>Current setup</span>
            <strong>Foundational configuration</strong>
            <p>Focus on the settings required to run the shared inbox cleanly and consistently.</p>
          </div>
        </div>
      </section>

      <section className="settings-dark-grid">
        <article className="content-card settings-dark-panel">
          <div className="card-header settings-dark-panel-head">
            <div>
              <h3 className="card-title">WhatsApp connection</h3>
              <p className="muted">
                Open the dedicated setup screen to configure webhook and Cloud API values cleanly.
              </p>
            </div>
            <a className="button button-primary" href="/settings/whatsapp">
              Open setup
            </a>
          </div>

          <div className="panel-row">
            <div className="lead-row">
              <strong>One operational place for setup</strong>
              <div className="table-subtle">
                Keep callback URL, verification token, environment status, and setup steps in one page.
              </div>
            </div>
          </div>
        </article>

        <article className="content-card settings-dark-panel">
          <div className="card-header settings-dark-panel-head">
            <div>
              <h3 className="card-title">Setup checklist</h3>
              <p className="muted">
                Keep onboarding short enough that a manager can finish it in one sitting.
              </p>
            </div>
          </div>

          <div className="panel-row">
            <div className="lead-row">
              <strong>1. Connect WhatsApp Business number</strong>
              <div className="table-subtle">Webhook endpoint, verification token, and Cloud API credentials.</div>
            </div>
            <div className="lead-row">
              <strong>2. Define team and assignment rules</strong>
              <div className="table-subtle">Round robin, manual ownership, and escalation defaults.</div>
            </div>
            <div className="lead-row">
              <strong>3. Set queue states and SLA</strong>
              <div className="table-subtle">Open, pending, closed, unread pressure, and follow-up windows.</div>
            </div>
          </div>
        </article>

        <article className="content-card settings-dark-panel">
          <div className="card-header settings-dark-panel-head">
            <div>
              <h3 className="card-title">Industry profile</h3>
              <p className="muted">
                Choose the industry pack that shapes lead context, setup defaults, and inbox-side business cards.
              </p>
            </div>
            <a className="button button-primary" href="/settings/industry">
              Open industry setup
            </a>
          </div>

          <div className="panel-row">
            <div className="lead-row">
              <strong>Property first, workshop next</strong>
              <div className="table-subtle">
                Keep one shared inbox core, then load the correct sidebar context and workflow defaults by workspace industry.
              </div>
            </div>
          </div>
        </article>

        <article className="content-card settings-dark-panel">
          <div className="card-header settings-dark-panel-head">
            <div>
              <h3 className="card-title">What not to overbuild yet</h3>
              <p className="muted">
                The first version should stay close to the day-to-day inbox workflow.
              </p>
            </div>
          </div>

          <div className="panel-row">
            <div className="lead-row">
              <strong>Skip deep custom objects</strong>
              <div className="table-subtle">Conversation, contact, and note data should stay simple at MVP stage.</div>
            </div>
            <div className="lead-row">
              <strong>Skip generic AI chat</strong>
              <div className="table-subtle">Start with templates, automation rules, and reliable team workflows.</div>
            </div>
            <div className="lead-row">
              <strong>Skip too many channels</strong>
              <div className="table-subtle">Win on WhatsApp first, then expand only when the inbox model is stable.</div>
            </div>
          </div>
        </article>
      </section>

      <section className="content-card settings-dark-panel settings-dark-email-card">
        <div className="card-header settings-dark-panel-head">
          <div>
            <h3 className="card-title">Email test</h3>
            <p className="muted">Send a branded test email to `tanchengwui@hotmail.com`.</p>
          </div>
        </div>

        <TestEmailButton />
      </section>
    </DashboardShell>
  );
}
