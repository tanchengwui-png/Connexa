import { CampaignsWorkspace } from "@/components/campaigns-workspace";
import { DashboardShell } from "@/components/dashboard-shell";
import { getCampaignsData } from "@/lib/campaigns";

export default async function CampaignsPage() {
  const { contacts, agents, quickReplies, mediaAssets, drafts, runs } = await getCampaignsData();

  return (
    <DashboardShell currentPath="/campaigns">
      <section className="hero campaigns-hero">
        <div>
          <span className="badge">Campaigns</span>
          <h2>Create WhatsApp campaigns without guessing the next step.</h2>
          <p className="muted">
            Start with one campaign, choose the audience, write the message, then review before sending or scheduling.
          </p>
        </div>
      </section>
      <CampaignsWorkspace
        agents={agents}
        contacts={contacts}
        initialDrafts={drafts}
        initialRuns={runs}
        mediaAssets={mediaAssets}
        quickReplies={quickReplies}
      />
    </DashboardShell>
  );
}
