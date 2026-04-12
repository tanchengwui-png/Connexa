import { DashboardShell } from "@/components/dashboard-shell";
import { getDashboardData } from "@/lib/dashboard";

export default async function CampaignsPage() {
  const { sourceMix } = await getDashboardData();

  return (
    <DashboardShell currentPath="/campaigns">
      <section className="hero">
        <div>
          <span className="badge">Campaigns</span>
          <h2>Re-engage old leads without losing attribution.</h2>
          <p className="muted">
            Broadcasts should stay tied to segments, source quality, and manager
            reporting instead of becoming a spam tool.
          </p>
        </div>
      </section>

      <section className="insight-grid">
        <article className="content-card">
          <div className="card-header">
            <div>
              <h3 className="card-title">Suggested segments</h3>
              <p className="muted">A practical first release can ship with fixed campaign audiences.</p>
            </div>
          </div>

          <div className="panel-row">
            <div className="lead-row">
              <strong>Hot leads with no reply in 3 days</strong>
              <div className="table-subtle">Use a site-visit follow-up template with agent owner preserved.</div>
            </div>
            <div className="lead-row">
              <strong>Investors above RM700k budget</strong>
              <div className="table-subtle">Send a new-launch teaser only to opted-in high-value contacts.</div>
            </div>
            <div className="lead-row">
              <strong>Past viewings with no booking</strong>
              <div className="table-subtle">Re-activate with a financing or rebate angle.</div>
            </div>
          </div>
        </article>

        <article className="content-card">
          <div className="card-header">
            <div>
              <h3 className="card-title">Acquisition baseline</h3>
              <p className="muted">Campaign reporting should map back to the original source mix.</p>
            </div>
          </div>

          <div className="channel-bars">
            {sourceMix.map((source) => (
              <div className="channel-row" key={source.source}>
                <span>{source.source}</span>
                <div className="channel-track">
                  <div
                    className="channel-fill"
                    style={{ width: `${source.share}%` }}
                  />
                </div>
                <strong>{source.share}%</strong>
              </div>
            ))}
          </div>
        </article>
      </section>
    </DashboardShell>
  );
}
