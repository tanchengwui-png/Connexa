import { CampaignsWorkspace } from "@/components/campaigns-workspace";
import { DashboardShell } from "@/components/dashboard-shell";
import { getCampaignEditorData } from "@/lib/campaigns";

export default async function NewCampaignPage() {
  const { contacts, agents, quickReplies, mediaAssets, drafts, runs } = await getCampaignEditorData();

  return (
    <DashboardShell currentPath="/campaigns">
      <CampaignsWorkspace
        agents={agents}
        contacts={contacts}
        initialDrafts={drafts}
        initialRuns={runs}
        mediaAssets={mediaAssets}
        mode="create"
        quickReplies={quickReplies}
        redirectOnSaveTo="/campaigns"
        showHistory={false}
      />
    </DashboardShell>
  );
}
