"use client";

type CampaignsErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function CampaignsError({ error, reset }: CampaignsErrorProps) {
  return (
    <main className="app-main">
      <div className="more-page-stack">
        <section className="auth-page-hero auth-page-hero-compact">
          <div className="auth-page-hero-copy">
            <span className="auth-page-kicker">Broadcast workflow</span>
            <h2>Campaigns</h2>
            <p>Campaign data could not be loaded. Review the error below and retry.</p>
          </div>
        </section>
        <section className="content-card campaigns-list-card campaigns-list-empty">
          <div className="campaigns-list-empty-copy">
            <strong>Unable to load campaigns</strong>
            <span className="muted">{error.message || "An unexpected campaign error occurred."}</span>
          </div>
          <div className="campaigns-list-empty-actions">
            <a className="button button-ghost" href="/campaigns">
              Back to campaigns
            </a>
            <button className="button button-secondary" onClick={reset} type="button">
              Try again
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}
