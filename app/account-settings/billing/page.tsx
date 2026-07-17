import { AccountBillingManager } from "@/components/account-billing-manager";
import { DashboardShell } from "@/components/dashboard-shell";
import { WorkspacePackageUpgradeCard } from "@/components/workspace-package-upgrade-card";
import { requireCurrentAgent } from "@/lib/auth/current-user";
import {
  getBillingPageDataForPage,
  getSubscriberBillingOverviewForPage
} from "@/lib/billing-management";
import { getWorkspacePackageUsageOverview } from "@/lib/package-feature-limits";
import { getDefaultWorkspacePackageBillingPeriod } from "@/lib/workspace-package-management";
import {
  getWorkspacePackageDowngradeOptions,
  getWorkspacePackageUpgradeOptions,
  listWorkspacePackageUpgradeInvoices
} from "@/lib/workspace-package-upgrades";
import { getWorkspacePlanSettings } from "@/lib/workspace-plan";
import { getResolvedPublicPackageDefinition } from "@/lib/platform-packages";

export default async function AccountBillingPage({
  searchParams
}: {
  searchParams?: Promise<{ packageUpgrade?: string; planSelection?: string; invoicePayment?: string }>;
}) {
  const manager = await requireCurrentAgent();
  const canManage = manager.role === "MANAGER";
  const [billing, overview, usage, upgradeInvoices, params] = await Promise.all([
    getBillingPageDataForPage(manager.workspaceId, manager.name, manager.email),
    getSubscriberBillingOverviewForPage(manager.workspaceId),
    getWorkspacePackageUsageOverview(manager.workspaceId),
    listWorkspacePackageUpgradeInvoices(manager.workspaceId),
    searchParams ??
      Promise.resolve<{
        packageUpgrade?: string;
        planSelection?: string;
        invoicePayment?: string;
      }>({})
  ]);
  const subscription = billing.subscription;
  const higherPackageOptions = (await getWorkspacePackageUpgradeOptions(subscription?.packageCode))
    .filter((option) => option.key !== "enterprise");
  const downgradeOptions = (await getWorkspacePackageDowngradeOptions(subscription?.packageCode))
    .filter((option) => option.key !== "enterprise");
  const currentPackage = subscription
    ? await getResolvedPublicPackageDefinition(subscription.packageCode as "starter" | "professional" | "growth" | "enterprise")
    : null;
  const upgradeOptions =
    currentPackage && (subscription?.status === "TRIAL" || subscription?.status === "EXPIRED")
      ? [{
          key: subscription.packageCode as "starter" | "professional" | "growth" | "enterprise",
          name: currentPackage.name,
          operationType: "RENEWAL" as const,
          summary: subscription.status === "TRIAL" ? "Convert your free trial to this paid package." : "Renew this package.",
          highlights: currentPackage.highlights,
          priceAmount: currentPackage.priceAmount,
          monthlyPriceAmount: currentPackage.monthlyPriceAmount,
          yearlyDiscountPercentage: currentPackage.yearlyDiscountPercentage,
          currency: currentPackage.currency,
          billingPeriod: currentPackage.billingPeriod,
          pricing: currentPackage.pricing,
          selfServe: currentPackage.priceAmount !== null
        }, ...higherPackageOptions.map((option) => ({ ...option, operationType: "UPGRADE" as const }))]
      : higherPackageOptions.map((option) => ({ ...option, operationType: "UPGRADE" as const }));
  const planChangeOptions = [
    ...upgradeOptions,
    ...downgradeOptions.map((option) => ({ ...option, operationType: "DOWNGRADE" as const }))
  ];
  const planSettings = getWorkspacePlanSettings(subscription?.packageCode);
  const packageUpgradeStatus =
    params.packageUpgrade === "success" || params.packageUpgrade === "failed" || params.packageUpgrade === "pending"
      ? params.packageUpgrade
      : null;
  const packageManagementNotice =
    params.planSelection === "upgrade"
      ? "Choose a higher package below to upgrade this workspace."
      : null;
  const invoicePaymentMessage =
    params.invoicePayment === "success"
      ? "Invoice payment completed."
      : params.invoicePayment === "pending"
        ? "Invoice payment is still pending."
        : params.invoicePayment === "failed"
          ? "Invoice payment could not be completed."
          : null;
  const cleanupWarning =
    subscription?.isExpired && billing.cleanupAt
      ? `Your subscription is expired. Your account and data will be permanently removed after ${billing.cleanupDays} days unless you renew your subscription. Scheduled removal: ${billing.cleanupAt.toLocaleDateString("en-MY")}.`
      : null;
  const initialBillingPeriod = getDefaultWorkspacePackageBillingPeriod({
    currentBillingPeriod: subscription?.billingPeriod,
    pendingPlanChanges: upgradeInvoices
  });

  return (
    <DashboardShell currentPath="/account-settings/billing">
      <div className="subscriber-billing-shell">
        <AccountBillingManager
          canManage={canManage}
          cleanupWarning={cleanupWarning}
          initialOverview={overview}
          limits={[
            { label: "Maximum Channels", value: planSettings.numberLimit === null ? "Unlimited" : String(planSettings.numberLimit) },
            { label: "Maximum Users", value: planSettings.memberLimit === null ? "Unlimited" : String(planSettings.memberLimit) },
            { label: "Maximum Message Flows", value: usage.maxActiveAutomations === null ? "Unlimited" : String(usage.maxActiveAutomations) },
            { label: "Message Quota", value: usage.maxOutboundMessages === null ? "Unlimited" : String(usage.maxOutboundMessages) }
          ]}
          profile={billing.profile}
          initialMessage={invoicePaymentMessage}
          subscription={subscription ? {
            id: subscription.id,
            packageName: subscription.packageName,
            status: subscription.status,
            startedAtIso: subscription.startedAt.toISOString(),
            endsAtIso: (subscription.status === "TRIAL" ? subscription.trialEndsAt : subscription.endedAt)?.toISOString() ?? null,
            nextBillingAtIso: subscription.nextBillingAt?.toISOString() ?? null,
            autoRenew: subscription.autoRenew
          } : null}
        />

        {canManage ? (
          <section className="content-card settings-dark-panel subscriber-settings-card subscriber-settings-section package-management-section" id="package-management">
            <WorkspacePackageUpgradeCard
              currentPackageLabel={subscription?.packageName ?? usage.packageLabel}
              currentPackageEndsAtIso={(subscription?.trialEndsAt ?? subscription?.nextBillingAt ?? subscription?.endedAt)?.toISOString() ?? null}
              currentPackageStatus={subscription?.status ?? null}
              entryNotice={packageManagementNotice}
              feedbackStatus={packageUpgradeStatus}
              initialBillingPeriod={initialBillingPeriod}
              initialInvoices={upgradeInvoices}
              options={planChangeOptions}
            />
          </section>
        ) : null}
      </div>
    </DashboardShell>
  );
}
