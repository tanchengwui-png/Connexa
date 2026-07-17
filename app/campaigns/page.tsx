import { CampaignList } from "@/components/campaign-list";
import { DashboardShell } from "@/components/dashboard-shell";
import { getCampaignDraftListData } from "@/lib/campaigns";

export default async function CampaignsPage() {
  const { drafts } = await getCampaignDraftListData();

  return (
    <DashboardShell currentPath="/campaigns">
      <div className="more-page-stack">
        <section className="auth-page-hero auth-page-hero-compact">
          <div className="auth-page-hero-copy">
            <span className="auth-page-kicker">Broadcast workflow</span>
            <h2>Campaigns</h2>
            <p>Start from the campaign list, create a new draft in its own editor, and return here after each save.</p>
            <div className="auth-page-hero-metrics">
              <span className="auth-page-hero-stat">
                <strong>{drafts.length}</strong>
                <small>saved campaigns</small>
              </span>
            </div>
          </div>
        </section>
        <CampaignList drafts={drafts} />
      </div>
    </DashboardShell>
  );
}
