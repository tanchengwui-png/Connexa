import Link from "next/link";
import { DashboardShell } from "@/components/dashboard-shell";
import { ChevronLeftIcon } from "@/components/inbox/icons";
import { WorkspacePackageUpgradeCard } from "@/components/workspace-package-upgrade-card";
import { requireCurrentAgent } from "@/lib/auth/current-user";
import { getBillingPageDataForPage } from "@/lib/billing-management";
import { getDefaultWorkspacePackageBillingPeriod } from "@/lib/workspace-package-management";
import { getWorkspacePackageDowngradeOptions, getWorkspacePackageUpgradeOptions, listWorkspacePackageUpgradeInvoices } from "@/lib/workspace-package-upgrades";
import { getResolvedPublicPackageDefinition } from "@/lib/platform-packages";

export default async function BillingPlansPage() {
  const manager = await requireCurrentAgent();
  if (manager.role !== "MANAGER") {
    return <DashboardShell currentPath="/account-settings/billing"><div className="subscriber-billing-shell"><p className="form-error">Only workspace managers can choose a subscription package.</p></div></DashboardShell>;
  }

  const [billing, invoices] = await Promise.all([
    getBillingPageDataForPage(manager.workspaceId, manager.name, manager.email),
    listWorkspacePackageUpgradeInvoices(manager.workspaceId)
  ]);
  const subscription = billing.subscription;
  const currentPackage = subscription
    ? await getResolvedPublicPackageDefinition(subscription.packageCode as "starter" | "professional" | "growth" | "enterprise")
    : null;
  const upgradeOptions = (subscription?.status === "TRIAL" || subscription?.status === "EXPIRED") && currentPackage
    ? [{
        key: subscription.packageCode as "starter" | "professional" | "growth" | "enterprise",
        name: currentPackage.name,
        operationType: "RENEWAL" as const,
        summary: "Continue with this previous package.",
        highlights: currentPackage.highlights,
        priceAmount: currentPackage.priceAmount,
        monthlyPriceAmount: currentPackage.monthlyPriceAmount,
        yearlyDiscountPercentage: currentPackage.yearlyDiscountPercentage,
        currency: currentPackage.currency,
        billingPeriod: currentPackage.billingPeriod,
        pricing: currentPackage.pricing,
        selfServe: currentPackage.priceAmount !== null
      }, ...(await getWorkspacePackageUpgradeOptions(subscription?.packageCode)).filter((option) => option.key !== "enterprise").map((option) => ({ ...option, operationType: "UPGRADE" as const }))]
    : (await getWorkspacePackageUpgradeOptions(subscription?.packageCode)).filter((option) => option.key !== "enterprise").map((option) => ({ ...option, operationType: "UPGRADE" as const }));
  const options = [...upgradeOptions, ...(await getWorkspacePackageDowngradeOptions(subscription?.packageCode)).filter((option) => option.key !== "enterprise").map((option) => ({ ...option, operationType: "DOWNGRADE" as const }))];

  return <DashboardShell currentPath="/account-settings/billing">
    <div className="subscriber-billing-shell">
      <header className="subscriber-billing-header"><div className="subscriber-billing-header-content"><span>Subscriber billing</span><h1>Choose a plan to continue</h1><p>Select the package and billing interval that best fit your workspace.</p><Link className="button button-secondary subscriber-billing-back-link" href="/account-settings/billing"><ChevronLeftIcon />Back to billing</Link></div></header>
      <section className="content-card settings-dark-panel subscriber-settings-card subscriber-settings-section package-management-section">
        <WorkspacePackageUpgradeCard
          currentPackageLabel={subscription?.packageName ?? "Previous package"}
          currentPackageEndsAtIso={(subscription?.trialEndsAt ?? subscription?.nextBillingAt ?? subscription?.endedAt)?.toISOString() ?? null}
          currentPackageStatus={subscription?.status ?? null}
          initialBillingPeriod={getDefaultWorkspacePackageBillingPeriod({ currentBillingPeriod: subscription?.billingPeriod, pendingPlanChanges: invoices })}
          initialInvoices={invoices}
          options={options}
        />
      </section>
    </div>
  </DashboardShell>;
}
