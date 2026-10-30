import { AccountBillingManager } from "@/components/account-billing-manager";
import { DashboardShell } from "@/components/dashboard-shell";
import { requireCurrentAgent } from "@/lib/auth/current-user";
import {
  getBillingPageDataForPage,
  getSubscriberBillingOverviewForPage
} from "@/lib/billing-management";
import { getWorkspacePackageUsageOverview } from "@/lib/package-feature-limits";
import { getWorkspacePlanSettings } from "@/lib/workspace-plan";

export default async function AccountBillingPage({
  searchParams
}: {
  searchParams?: Promise<{ invoicePayment?: string }>;
}) {
  const manager = await requireCurrentAgent();
  const canManage = manager.role === "MANAGER";
  const [billing, overview, usage, params] = await Promise.all([
    getBillingPageDataForPage(manager.workspaceId, manager.name, manager.email),
    getSubscriberBillingOverviewForPage(manager.workspaceId),
    getWorkspacePackageUsageOverview(manager.workspaceId),
    searchParams ??
      Promise.resolve<{ invoicePayment?: string }>({})
  ]);
  const subscription = billing.subscription;
  const planSettings = getWorkspacePlanSettings(subscription?.packageCode);
  const invoicePaymentMessage =
    params.invoicePayment === "success"
      ? "Invoice payment completed."
      : params.invoicePayment === "pending"
        ? "Invoice payment is still pending."
        : params.invoicePayment === "failed"
          ? "Invoice payment could not be completed."
          : null;
  const cleanupWarning = subscription?.isExpired ? "expired" : null;

  return (
    <DashboardShell currentPath="/account-settings/billing">
      <div className="subscriber-billing-shell">
        <AccountBillingManager
          canManage={canManage}
          cleanupWarning={cleanupWarning}
          isSubscriptionExpired={Boolean(subscription?.isExpired)}
          initialOverview={overview}
          limits={[
            { label: "Maximum Channels", value: planSettings.numberLimit === null ? "Unlimited" : String(planSettings.numberLimit) },
            { label: "Maximum Users", value: planSettings.memberLimit === null ? "Unlimited" : String(planSettings.memberLimit) },
            { label: "Maximum Message Flows", value: usage.maxActiveAutomations === null ? "Unlimited" : String(usage.maxActiveAutomations) },
            { label: "Message Quota", value: usage.maxOutboundMessages === null ? "Unlimited" : String(usage.maxOutboundMessages) }
          ]}
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

      </div>
    </DashboardShell>
  );
}
