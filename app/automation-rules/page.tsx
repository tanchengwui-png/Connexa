import { DashboardShell } from "@/components/dashboard-shell";
import { AutomationRulesManager } from "@/components/automation-rules-manager";
import { getAutomationRulesData } from "@/lib/automation-rules";

export default async function AutomationRulesPage() {
  const { rules, settings, jobs, summary, workflows } = await getAutomationRulesData();

  return (
    <DashboardShell currentPath="/automation-rules">
      <section className="hero">
        <div>
          <span className="badge">Automation rules</span>
          <h2>Start with simple automation the team can see and trust.</h2>
          <p className="muted">
            Build a controlled WhatsApp automation layer with workflow automation, welcome replies,
            away logic, keyword rules, human takeover pause, and queued follow-ups.
          </p>
        </div>
      </section>

      <section className="metrics-grid">
        <article className="content-card metric-card">
          <div className="metric-label">Total rules</div>
          <div className="metric-value">{summary.total}</div>
          <div className="table-subtle">Automation rules configured in the workspace</div>
        </article>
        <article className="content-card metric-card">
          <div className="metric-label">Enabled</div>
          <div className="metric-value">{summary.enabled}</div>
          <div className="table-subtle">Rules currently active</div>
        </article>
        <article className="content-card metric-card">
          <div className="metric-label">Keyword rules</div>
          <div className="metric-value">{summary.keywordRules}</div>
          <div className="table-subtle">Rules that react to inbound customer text</div>
        </article>
        <article className="content-card metric-card">
          <div className="metric-label">Queued follow-ups</div>
          <div className="metric-value">{summary.queuedJobs}</div>
          <div className="table-subtle">Jobs waiting for future send windows</div>
        </article>
      </section>

      <AutomationRulesManager jobs={jobs} rules={rules} settings={settings} workflows={workflows} />
    </DashboardShell>
  );
}
