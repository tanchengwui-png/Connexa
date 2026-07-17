import { DashboardShell } from "@/components/dashboard-shell";
import { MorePageIntro } from "@/components/more-page-intro";
import { AutomationRulesManager } from "@/components/automation-rules-manager";
import { getAutomationRulesData } from "@/lib/automation-rules";
import { getMediaLibraryData } from "@/lib/media-library";
import { getWorkspaceWhatsAppChannelStatus } from "@/lib/whatsapp-channel";

export default async function AutomationRulesPage() {
  const automationData = await getAutomationRulesData();
  const { workspaceId, rules, settings, jobs, summary, workflows, agents } = automationData;
  const [mediaLibrary, whatsAppChannel] = await Promise.all([
    getMediaLibraryData(),
    getWorkspaceWhatsAppChannelStatus(workspaceId)
  ]);

  return (
    <DashboardShell currentPath="/automation-rules">
      <div className="more-page-stack">
        <MorePageIntro
          badge="Automation rules"
          title="Start with simple automation the team can see and trust."
          description="Build a controlled WhatsApp automation layer with workflow automation, welcome replies, away logic, message rules, human takeover pause, and queued follow-ups."
        />

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
            <div className="metric-label">Message rules</div>
            <div className="metric-value">{summary.keywordRules}</div>
            <div className="table-subtle">Rules that react to inbound customer text</div>
          </article>
        </section>

        <AutomationRulesManager
          agents={agents}
          jobs={jobs}
          mediaAssets={mediaLibrary.assets}
          mediaLimits={mediaLibrary.limits}
          rules={rules}
          settings={settings}
          liveKeywordTesting={{
            connectionStatus: whatsAppChannel?.connectionStatus ?? "DISCONNECTED",
            displayName: whatsAppChannel?.displayName ?? null,
            phoneNumber: whatsAppChannel?.phoneNumber ?? null
          }}
          workflows={workflows}
          workspaceId={workspaceId}
        />
      </div>
    </DashboardShell>
  );
}
