import { AccountSettingsDashboard } from "@/components/account-settings-dashboard";
import { DashboardShell } from "@/components/dashboard-shell";
import { requireManager } from "@/lib/auth/current-user";
import { getCurrentSubscriptionOverview } from "@/lib/billing-management";
import { findWorkspaceById } from "@/lib/db-auth";
import { getWorkspacePackageUsageOverview } from "@/lib/package-feature-limits";
import { getDefaultWorkspacePackageBillingPeriod } from "@/lib/workspace-package-management";
import { getWorkspacePackageUpgradeOptions, listWorkspacePackageUpgradeInvoices } from "@/lib/workspace-package-upgrades";
import { getWorkspaceWhatsAppHealthForPage } from "@/lib/whatsapp-health";
import { getWorkspacePlanSettings } from "@/lib/workspace-plan";

const DISPLAY_TIME_ZONE = "Asia/Kuala_Lumpur";

function formatDate(value: Date | string | null | undefined) {
  if (!value) return "Not available";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "Not available";
  return new Intl.DateTimeFormat("en-MY", { dateStyle: "medium", timeStyle: "short", timeZone: DISPLAY_TIME_ZONE }).format(date);
}

function maskPhone(phone: string | null | undefined) {
  const digits = phone?.replace(/\D/g, "") ?? "";
  return digits.length >= 4 ? `••••••${digits.slice(-4)}` : "Not connected";
}

function workspaceStatus(input: { isConnectionStalled: boolean; isInboxReady: boolean; runtimeStatus: string }) {
  if (input.isInboxReady) return "Operational";
  if (input.isConnectionStalled) return "Attention needed";
  return input.runtimeStatus === "DISCONNECTED" ? "Not connected" : "Stabilizing";
}

function inboxStatus(input: { isInboxReady: boolean; isHistoryStuck: boolean; isHistoryStabilizing: boolean; isLiveOnlyMode: boolean }) {
  if (input.isInboxReady) return "Ready for inbox use";
  if (input.isLiveOnlyMode) return "Live messaging ready";
  if (input.isHistoryStuck) return "History import needs review";
  return input.isHistoryStabilizing ? "Synchronizing history" : "Not ready yet";
}

export default async function AccountSettingsPage({
  searchParams
}: {
  searchParams?: Promise<{ packageUpgrade?: string; planSelection?: string }>;
}) {
  const manager = await requireManager();
  const workspace = await findWorkspaceById(manager.workspaceId);
  if (!workspace) throw new Error("Workspace not found.");

  const [health, usage, packageUpgradeOptions, packageUpgradeInvoices, subscription, params] = await Promise.all([
    getWorkspaceWhatsAppHealthForPage({ workspaceId: manager.workspaceId, agentId: manager.id }),
    getWorkspacePackageUsageOverview(manager.workspaceId),
    getWorkspacePackageUpgradeOptions(workspace.plan),
    listWorkspacePackageUpgradeInvoices(workspace.id),
    getCurrentSubscriptionOverview(manager.workspaceId),
    searchParams ?? Promise.resolve<{ packageUpgrade?: string; planSelection?: string }>({})
  ]);
  const isSubscriptionExpired = Boolean(subscription?.isExpired);
  const planSettings = getWorkspacePlanSettings(workspace.plan);
  const activeNumbers = health.channel?.phoneNumber ? 1 : 0;
  const numberUsageLabel = planSettings.numberLimit === null ? `${activeNumbers} active numbers` : `${activeNumbers} of ${planSettings.numberLimit} numbers in use`;
  const packageUpgradeStatus = params.packageUpgrade === "success" || params.packageUpgrade === "failed" || params.packageUpgrade === "pending" ? params.packageUpgrade : null;
  const packageOptions = packageUpgradeOptions.filter((option) => option.key !== "enterprise").map((option) => ({ ...option, operationType: "UPGRADE" as const }));
  const workerStatus = health.workerStatus.heartbeat?.isOnline ? "Online" : "Offline or no heartbeat";

  return <DashboardShell currentPath="/account-settings"><AccountSettingsDashboard
    workspaceName={workspace.name}
    isSubscriptionExpired={isSubscriptionExpired}
    subscriptionExpiresAtLabel={subscription?.expiryDate ? formatDate(subscription.expiryDate) : null}
    renewHref="/account-settings/billing/plans?source=expired"
    isSetupComplete={Boolean(health.channel?.phoneNumber && health.isInboxReady)}
    workspaceStatus={isSubscriptionExpired ? "Access limited" : workspaceStatus(health)}
    planLabel={planSettings.label}
    numberUsageLabel={numberUsageLabel}
    maskedPhone={maskPhone(health.channel?.phoneNumber)}
    whatsappStatus={health.channel?.phoneNumber && health.runtimeStatus !== "DISCONNECTED" ? "Connected" : "Not connected"}
    inboxReadiness={isSubscriptionExpired ? "Unavailable until renewal" : inboxStatus(health)}
    workerStatus={workerStatus}
    runtimeStatus={health.runtimeStatus}
    lastSyncLabel={formatDate(health.channel?.lastSeenAt ?? health.channel?.updatedAt)}
    profileName={health.channel?.displayName ?? "Not available"}
    sessionOwner={health.channel?.connectedByAgentName ?? manager.name}
    latestSyncIssue={health.lastSyncError ?? "No recent issue recorded"}
    verificationState={health.verificationState === "two_way_live" ? "Inbound and outbound verified" : health.verificationState === "inbound_live" ? "Inbound verified" : health.verificationState === "outbound_live" ? "Outbound verified" : "No live traffic verified yet"}
    importedSummary={`${health.importedConversationCount} conversations · ${health.importedMessageCount} messages`}
    initialBillingPeriod={getDefaultWorkspacePackageBillingPeriod({ pendingPlanChanges: packageUpgradeInvoices })}
    packageOptions={packageOptions}
    packageInvoices={packageUpgradeInvoices}
    packageUpgradeStatus={packageUpgradeStatus}
    usage={[
      { label: "Outbound messages", current: usage.currentOutboundMessages, limit: usage.maxOutboundMessages },
      { label: "Active contacts", current: usage.currentActiveContacts, limit: usage.maxActiveContacts },
      { label: "Active automations", current: usage.currentActiveAutomations, limit: usage.maxActiveAutomations },
      { label: "WhatsApp campaigns", current: usage.currentWhatsAppCampaigns, limit: usage.maxWhatsAppCampaigns }
    ]}
  /></DashboardShell>;
}
