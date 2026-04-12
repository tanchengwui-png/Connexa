import { DashboardShell } from "@/components/dashboard-shell";
import { getDashboardData } from "@/lib/dashboard";

export default async function WorkspacePage() {
  const { metrics, pipeline, sourceMix, hotLeads, inbox, teamBoard, timeline } =
    await getDashboardData();

  return (
    <DashboardShell currentPath="/workspace">
      <section className="hero">
        <div>
          <span className="badge">Workspace Overview</span>
          <h2>Run customer conversations, ownership, and automation from one place.</h2>
          <p className="muted">
            This workspace tracks queue pressure, hot leads, team response health, and the automation
            signals that matter to a WhatsApp-first support and sales operation.
          </p>
        </div>

        <div className="hero-actions">
          <a className="button button-primary" href="/inbox">
            Open inbox
          </a>
          <a className="button button-secondary" href="/automation-rules">
            Review automation
          </a>
        </div>
      </section>

      <section className="metrics-grid">
        {metrics.map((metric) => (
          <article className="content-card metric-card" key={metric.label}>
            <div className="metric-label">{metric.label}</div>
            <div className="metric-value">{metric.value}</div>
            <div className="table-subtle">{metric.detail}</div>
          </article>
        ))}
      </section>

      <section className="insight-grid">
        <article className="content-card">
          <div className="card-header">
            <div>
              <h3 className="card-title">Queue pressure</h3>
              <p className="muted">Make the leak points visible before they become missed conversations.</p>
            </div>
            <span className="badge">Live snapshot</span>
          </div>

          <div className="panel-row">
            {pipeline.map((item) => (
              <div className="lead-row" key={item.name}>
                <div className="lead-topline">
                  <strong>{item.name}</strong>
                  <span className="lead-chip">{item.count}</span>
                </div>
                <div className="table-subtle">{item.summary}</div>
              </div>
            ))}
          </div>
        </article>

        <article className="content-card">
          <div className="card-header">
            <div>
              <h3 className="card-title">Acquisition mix</h3>
              <p className="muted">Useful when deciding which inbound channels deserve the fastest handling.</p>
            </div>
          </div>

          <div className="channel-bars">
            {sourceMix.map((source) => (
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
      </section>

      <section className="lower-grid">
        <article className="table-card">
          <div className="card-header">
            <div>
              <h3 className="card-title">Priority conversations</h3>
              <p className="muted">High-value leads and follow-up risks that need team attention now.</p>
            </div>
            <a className="badge" href="/contacts">
              Open contacts
            </a>
          </div>

          <div className="lead-list">
            {hotLeads.map((lead) => (
              <div className="lead-row" key={lead.name}>
                <div className="lead-topline">
                  <strong>{lead.name}</strong>
                  <div className="inbox-list-tags">
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
                </div>
                <div>{lead.project}</div>
                <div className="table-subtle">
                  {lead.preferredArea} - {lead.financingStatus}
                </div>
                <div className="table-subtle">Next action: {lead.nextActionAt}</div>
                <div className="table-subtle">{lead.signal}</div>
                <div className="table-subtle">Owner: {lead.owner}</div>
                <div className="table-subtle">
                  <a className="button button-secondary" href={`/leads/${lead.id}`}>
                    Open record
                  </a>
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="message-card">
          <div className="card-header">
            <div>
              <h3 className="card-title">Inbox preview</h3>
              <p className="muted">Recent customer touchpoints flowing into the shared queue.</p>
            </div>
            <a className="badge" href="/inbox">
              Open queue
            </a>
          </div>

          <div className="message-list">
            {inbox.map((message) => (
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
        </article>
      </section>

      <section className="lower-grid">
        <article className="table-card">
          <div className="card-header">
            <div>
              <h3 className="card-title">Team board</h3>
              <p className="muted">Track owner load, response health, and visit booking output.</p>
            </div>
          </div>

          <div className="table-head">
            <span>Agent</span>
            <span>Open leads</span>
            <span>Booked visits</span>
            <span>Response time</span>
          </div>

          {teamBoard.map((agent) => (
            <div className="table-row" key={agent.agent}>
              <span>{agent.agent}</span>
              <strong>{agent.openLeads}</strong>
              <strong>{agent.bookedVisits}</strong>
              <span>{agent.responseTime}</span>
            </div>
          ))}
        </article>

        <article className="timeline-card">
          <div className="card-header">
            <div>
              <h3 className="card-title">Recent system events</h3>
              <p className="muted">Assignment, automation, and reminder events happening across the workspace.</p>
            </div>
          </div>

          <div className="timeline-list">
            {timeline.map((item) => (
              <div className="timeline-row" key={item.title}>
                <div className="timeline-topline">
                  <strong>{item.title}</strong>
                  <span className="timeline-time">{item.time}</span>
                </div>
                <div className="table-subtle">{item.description}</div>
              </div>
            ))}
          </div>
        </article>
      </section>
    </DashboardShell>
  );
}
