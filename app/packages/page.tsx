import { ConnexaLogo } from "@/components/connexa-logo";
import { PackagesPageContent } from "@/components/packages-page-content";
import { getCurrentAgent } from "@/lib/auth/current-user";
import { getCurrentSubscriptionOverview } from "@/lib/billing-management";
import { normalizeWorkspacePackageKey } from "@/lib/billing";

export default async function PackagesPage() {
  const currentAgent = await getCurrentAgent();
  const subscription = currentAgent
    ? await getCurrentSubscriptionOverview(currentAgent.workspaceId)
    : null;
  const currentPlanKey = subscription?.packageCode
    ? normalizeWorkspacePackageKey(subscription.packageCode)
    : null;

  return (
    <main className="connexa-dark-shell connexa-public-shell packages-page-shell">
      <section className="packages-page-header">
        <div className="packages-page-brand-row">
          <ConnexaLogo priority />
        </div>

        <div className="packages-page-copy">
          <span className="packages-page-kicker">Pricing Plans</span>
          <h1>Choose the right plan for your WhatsApp workspace.</h1>
          <p className="muted">
            Compare monthly and yearly one-time package access, then move to checkout only when you
            are ready to activate the workspace owner account.
          </p>
        </div>
      </section>

      <PackagesPageContent currentPlanKey={currentPlanKey} />
    </main>
  );
}
