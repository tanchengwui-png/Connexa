import { notFound } from "next/navigation";
import { CampaignRunDetail } from "@/components/campaign-run-detail";
import { DashboardShell } from "@/components/dashboard-shell";
import { getCampaignRunDetail } from "@/lib/campaigns";

type CampaignRunPageProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function CampaignRunPage({ params }: CampaignRunPageProps) {
  const { id } = await params;
  const run = await getCampaignRunDetail(id);

  if (!run) {
    notFound();
  }

  return (
    <DashboardShell currentPath="/campaigns">
      <CampaignRunDetail run={run} />
    </DashboardShell>
  );
}
