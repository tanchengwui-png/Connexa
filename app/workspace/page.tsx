import { DashboardShell } from "@/components/dashboard-shell";
import { getDashboardData } from "@/lib/dashboard";

export default async function WorkspacePage() {
  const { metrics, pipeline, sourceMix, hotLeads, inbox, teamBoard, timeline } =
    await getDashboardData();
  type Metric = (typeof metrics)[number];
  type PipelineItem = (typeof pipeline)[number];
  type SourceMixItem = (typeof sourceMix)[number];
  type HotLead = (typeof hotLeads)[number];
  type InboxItem = (typeof inbox)[number];
  type TeamBoardRow = (typeof teamBoard)[number];
  type TimelineItem = (typeof timeline)[number];

  return (
    <DashboardShell currentPath="/workspace">
      <section className="workspace-crm-header workspace-overview-hero workspace-overview-hero-compact">
        <div>
          <span className="badge">CRM Overview</span>
          <h2>Customer conversations, ownership, and follow-up.</h2>
          <p className="muted">
            Track queue pressure, lead flow, team workload, and recent activity.
          </p>
        </div>

        <div className="workspace-crm-header-actions workspace-overview-hero-actions">
          <a className="button button-primary" href="/inbox">
            Open inbox
          </a>
          <a className="button button-secondary" href="/leads">
            Open leads
          </a>
        </div>
      </section>

      <section className="metrics-grid workspace-kpi-grid">
        {metrics.map((metric: Metric) => (
          <article className="content-card metric-card workspace-kpi-card" key={metric.label}>
            <div className="metric-label">{metric.label}</div>
            <div className="metric-value">{metric.value}</div>
            <div className="table-subtle">{metric.detail}</div>
          </article>
        ))}
      </section>

      <section className="workspace-overview-grid workspace-overview-insights">
        <article className="content-card workspace-overview-panel workspace-overview-panel-primary">
          <div className="card-header dashboard-section-header">
            <div>
              <h3 className="card-title">Pipeline health</h3>
              <p className="muted">Make the leak points visible before they become missed follow-ups.</p>
            </div>
            <span className="badge workspace-live-snapshot-badge">Live snapshot</span>
          </div>

          <div className="panel-row workspace-overview-stack">
            {pipeline.map((item: PipelineItem) => (
              <div className="lead-row workspace-overview-summary-row" key={item.name}>
                <div className="lead-topline">
                  <strong>{item.name}</strong>
                  <span className="lead-chip">{item.count}</span>
                </div>
                <div className="table-subtle">{item.summary}</div>
              </div>
            ))}
          </div>
        </article>

        <article className="content-card workspace-overview-panel workspace-overview-panel-secondary">
          <div className="card-header dashboard-section-header">
            <div>
              <h3 className="card-title">Acquisition mix</h3>
              <p className="muted">Useful when deciding which inbound channels deserve the fastest handling.</p>
            </div>
          </div>

          <div className="channel-bars">
            {sourceMix.map((source: SourceMixItem) => (
              <div className="channel-row" key={source.source}>
                <span>{source.source}</span>
                <div className="channel-track">
                  <div className="channel-fill" style={{ width: `${source.share}%` }} />
                </div>
                <strong>{source.share}%</strong>
              </div>
            ))}
          </div>

          <div className="kpi-note">
            <strong>Current operating assumption</strong>
            <p className="muted">
              Start with WhatsApp-first handling, then connect the highest-volume lead and support entry
              points into the same inbox.
            </p>
          </div>
        </article>

        <article className="table-card workspace-overview-sidepanel workspace-overview-teamcard">
          <div className="card-header dashboard-section-header">
            <div>
              <h3 className="card-title">Team board</h3>
              <p className="muted">Track owner load, response health, and visit booking output.</p>
            </div>
          </div>

          <div className="table-head">
            <span>Agent</span>
            <span>Open</span>
            <span>Visits</span>
            <span>Response</span>
          </div>

          {teamBoard.map((agent: TeamBoardRow) => (
            <div className="table-row" key={agent.agent}>
              <span>{agent.agent}</span>
              <strong>{agent.openLeads}</strong>
              <strong>{agent.bookedVisits}</strong>
              <span>{agent.responseTime}</span>
            </div>
          ))}
        </article>
      </section>

      <section className="workspace-overview-grid workspace-overview-operations">
        <article className="table-card workspace-overview-table workspace-overview-table-primary workspace-priority-table">
          <div className="card-header dashboard-section-header">
            <div>
              <h3 className="card-title">Priority conversations</h3>
              <p className="muted">High-value leads and follow-up risks that need team attention now.</p>
            </div>
            <a className="badge" href="/contacts">
              Open contacts
            </a>
          </div>

          <div className="workspace-priority-list">
            {hotLeads.map((lead: HotLead) => (
              <div className="lead-row workspace-priority-row" key={lead.name}>
                <div className="workspace-priority-main">
                  <strong>{lead.name}</strong>
                  <span>{lead.project}</span>
                </div>
                <div className="workspace-priority-tags">
                  <span
                    className={`stage-pill ${
                      lead.stage === "Qualified"
                        ? "qualified"
                        : lead.stage === "Follow-up"
                          ? "follow-up"
                          : ""
                    }`}
                  >
                    {lead.stage}
                  </span>
                  <span className="lead-chip">{lead.priority}</span>
                </div>
                <span className="table-subtle">{lead.nextActionAt}</span>
                <span className="table-subtle">{lead.owner}</span>
                <div className="workspace-priority-action">
                  <a className="button button-secondary" href={`/leads/${lead.id}`}>
                    Open
                  </a>
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="message-card workspace-overview-sidepanel workspace-overview-activitycard">
          <div className="card-header dashboard-section-header">
            <div>
              <h3 className="card-title">Recent activity</h3>
              <p className="muted">Latest inbox touchpoints and system events.</p>
            </div>
            <a className="badge" href="/inbox">
              Open queue
            </a>
          </div>

          <div className="workspace-activity-section">
            <div className="workspace-activity-section-head">
              <strong>Inbox preview</strong>
              <span>{inbox.length} recent</span>
            </div>
            <div className="message-list">
              {inbox.map((message: InboxItem) => (
                <div className="message-row" key={message.name}>
                  <div className="message-topline">
                    <strong>{message.name}</strong>
                    <span className="timeline-time">{message.age}</span>
                  </div>
                  <div>{message.lastMessage}</div>
                  <div className="table-subtle">{message.channel}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="workspace-activity-section">
            <div className="workspace-activity-section-head">
              <strong>System events</strong>
              <span>{timeline.length} updates</span>
            </div>
            <div className="timeline-list">
              {timeline.map((item: TimelineItem) => (
                <div className="timeline-row" key={item.title}>
                  <div className="timeline-topline">
                    <strong>{item.title}</strong>
                    <span className="timeline-time">{item.time}</span>
                  </div>
                  <div className="table-subtle">{item.description}</div>
                </div>
              ))}
            </div>
          </div>
        </article>
      </section>
    </DashboardShell>
  );
}
