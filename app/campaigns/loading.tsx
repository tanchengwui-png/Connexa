import { DashboardShell } from "@/components/dashboard-shell";

export default function CampaignsLoading() {
  return (
    <DashboardShell currentPath="/campaigns">
      <div className="more-page-stack">
        <section className="auth-page-hero auth-page-hero-compact">
          <div className="auth-page-hero-copy">
            <span className="auth-page-kicker">Broadcast workflow</span>
            <h2>Campaigns</h2>
            <p>Loading campaign data...</p>
          </div>
        </section>
        <section className="content-card campaigns-list-card campaigns-list-empty">
          <div className="campaigns-list-empty-copy">
            <strong>Preparing campaign list</strong>
            <span className="muted">Loading saved drafts, status, and available actions.</span>
          </div>
        </section>
      </div>
    </DashboardShell>
  );
}
