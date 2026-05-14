import { DashboardShell } from "@/components/dashboard-shell";

export default function SettingsPage() {
  return (
    <DashboardShell currentPath="/settings">
      <section className="settings-dark-hero">
        <div className="settings-dark-copy">
          <span className="badge connexa-public-badge">Workspace settings</span>
          <h1>Additional workspace configuration will live here later.</h1>
          <p>
            Core setup is already handled in the dedicated pages below. This route stays reserved for
            future modules that do not belong under account or industry setup.
          </p>
        </div>

        <div className="settings-dark-status">
          <div className="settings-dark-status-card">
            <span>Current state</span>
            <strong>Reserved for future modules</strong>
            <p>Keep navigation focused today without deleting the route you may need later.</p>
          </div>
        </div>
      </section>

      <section className="settings-dark-grid">
        <article className="content-card settings-dark-panel">
          <div className="card-header settings-dark-panel-head">
            <div>
              <h3 className="card-title">Account setting</h3>
              <p className="muted">
                Manage the connected WhatsApp number, connection health, and account-level setup from
                the main account configuration screen.
              </p>
            </div>
            <a className="button button-primary" href="/account-settings">
              Open account setting
            </a>
          </div>
        </article>

        <article className="content-card settings-dark-panel">
          <div className="card-header settings-dark-panel-head">
            <div>
              <h3 className="card-title">Industry setup</h3>
              <p className="muted">
                Choose the workspace industry profile and keep vertical-specific behavior in one
                focused setup flow.
              </p>
            </div>
            <a className="button button-primary" href="/settings/industry">
              Open industry setup
            </a>
          </div>
        </article>
      </section>
    </DashboardShell>
  );
}
