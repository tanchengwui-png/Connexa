import { notFound } from "next/navigation";
import { CampaignsWorkspace } from "@/components/campaigns-workspace";
import { DashboardShell } from "@/components/dashboard-shell";
import { getCampaignDraftById, getCampaignEditorData } from "@/lib/campaigns";

type EditCampaignPageProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function EditCampaignPage({ params }: EditCampaignPageProps) {
  const { id } = await params;
  const [{ contacts, agents, quickReplies, mediaAssets, drafts, runs }, draft] = await Promise.all([
    getCampaignEditorData(),
    getCampaignDraftById(id)
  ]);

  if (!draft) {
    notFound();
  }

  return (
    <DashboardShell currentPath="/campaigns">
      <CampaignsWorkspace
        agents={agents}
        contacts={contacts}
        initialDraft={draft}
        initialDrafts={drafts}
        initialRuns={runs}
        mediaAssets={mediaAssets}
        mode="edit"
        quickReplies={quickReplies}
        redirectOnSaveTo="/campaigns"
        showHistory={false}
      />
    </DashboardShell>
  );
}
