import { DashboardShell } from "@/components/dashboard-shell";
import { LeadsWorkspace } from "@/components/leads-workspace";
import { getDashboardData } from "@/lib/dashboard";
import { getLeadsWorkspaceData } from "@/lib/leads";

export default async function LeadsPage() {
  const [{ metrics }, { agents, leads }] = await Promise.all([getDashboardData(), getLeadsWorkspaceData()]);

  return (
    <DashboardShell currentPath="/leads">
      <section className="hero">
        <div>
          <span className="badge">Lead pipeline</span>
          <h2>Run lead follow-up from one operational workspace.</h2>
          <p className="muted">
            Contacts tell you who the person is. Leads track the actual opportunity: owner, stage,
            source, priority, value, next action, and custom fields.
          </p>
        </div>
      </section>

      <section className="metrics-grid">
        {metrics.map((metric) => (
          <article className="content-card metric-card contacts-metric-card" key={metric.label}>
            <div className="metric-label">{metric.label}</div>
            <div className="metric-value">{metric.value}</div>
            <div className="table-subtle">{metric.detail}</div>
          </article>
        ))}
      </section>

      <LeadsWorkspace agents={agents} leads={leads} />
    </DashboardShell>
  );
}
