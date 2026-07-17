import { AccountSecurityCard } from "@/components/account-security-card";
import { DashboardShell } from "@/components/dashboard-shell";
import { WorkspacePackageUpgradeCard } from "@/components/workspace-package-upgrade-card";
import { requireManager } from "@/lib/auth/current-user";
import { findWorkspaceById } from "@/lib/db-auth";
import { getWorkspacePackageUsageOverview } from "@/lib/package-feature-limits";
import { getDefaultWorkspacePackageBillingPeriod } from "@/lib/workspace-package-management";
import { getWorkspacePackageUpgradeOptions, listWorkspacePackageUpgradeInvoices } from "@/lib/workspace-package-upgrades";
import type { WorkspaceWhatsAppChannelStatus } from "@/lib/whatsapp-channel";
import { getWorkspaceWhatsAppHealthForPage, type WorkspaceWhatsAppHealth } from "@/lib/whatsapp-health";
import { getWorkspacePlanSettings } from "@/lib/workspace-plan";

const DISPLAY_TIME_ZONE = "Asia/Kuala_Lumpur";

function getNumberConnectionLabel(status?: string | null) {
  if (!status) {
    return "Not connected";
  }

  if (status === "READY") {
    return "Connected and ready";
  }

  if (status === "CONNECTED" || status === "SYNCING_HISTORY") {
    return "Finalizing setup";
  }

  if (status === "QR_READY" || status === "AUTHENTICATED" || status === "INITIALIZING") {
    return "Connection in progress";
  }

  if (status === "AUTH_FAILED") {
    return "Reconnect required";
  }

  return status === "DISCONNECTED" ? "Not connected" : status;
}

function formatConnectedAt(value: Date | string | null | undefined) {
  if (!value) {
    return "Not connected";
  }

  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Not connected";
  }

  return new Intl.DateTimeFormat("en-MY", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: DISPLAY_TIME_ZONE
  }).format(date);
}

function getVerificationLabel(state: string) {
  if (state === "two_way_live") {
    return "Inbound and outbound verified";
  }

  if (state === "inbound_live") {
    return "Inbound verified only";
  }

  if (state === "outbound_live") {
    return "Outbound verified only";
  }

  return "No live traffic verified yet";
}

function getInboxReadinessLabel(health: WorkspaceWhatsAppHealth) {
  if (health.isConnectionStalled) {
    return "Connection stalled";
  }

  if (health.isLiveOnlyMode) {
    return "Live only mode";
  }

  if (health.isInboxReady) {
    return "Ready for inbox use";
  }

  if (health.isHistoryStuck) {
    return "History import stalled";
  }

  if (health.isHistoryStabilizing) {
    return "History still stabilizing";
  }

  return "Not ready yet";
}

function getWorkspaceStatusLabel(health: WorkspaceWhatsAppHealth) {
  if (health.isConnectionStalled) {
    return "Attention needed";
  }

  if (health.isInboxReady) {
    return "Operational";
  }

  if (health.runtimeStatus === "CONNECTED" || health.runtimeStatus === "SYNCING_HISTORY") {
    return "Stabilizing";
  }

  if (health.runtimeStatus === "AUTH_FAILED") {
    return "Reconnect required";
  }

  return health.runtimeStatus === "DISCONNECTED" ? "Not connected" : "Attention needed";
}

function getWorkerStatusLabel(health: WorkspaceWhatsAppHealth) {
  if (health.workerStatus.heartbeat?.isOnline) {
    return `Online (${health.workerStatus.heartbeat.workerLabel ?? "worker"})`;
  }

  if (health.runtimeStatus === "QR_READY" || health.runtimeStatus === "AUTH_FAILED") {
    return "Waiting for WhatsApp relink";
  }

  return "Offline or no heartbeat";
}

function formatUsageValue(current: number, max: number | null) {
  return max === null ? `${current} / Unlimited` : `${current} / ${max}`;
}

function formatRemainingValue(remaining: number | null, label: string) {
  return remaining === null ? `No package cap for ${label}.` : `${remaining} remaining ${label}.`;
}

export default async function AccountSettingsPage({
  searchParams
}: {
  searchParams?: Promise<{ packageUpgrade?: string; planSelection?: string }>;
}) {
  const manager = await requireManager();
  const workspace = await findWorkspaceById(manager.workspaceId);

  if (!workspace) {
    throw new Error("Workspace not found.");
  }

  const [health, packageUsage, resolvedSearchParams, packageUpgradeOptions, packageUpgradeInvoices] = await Promise.all([
    getWorkspaceWhatsAppHealthForPage({
      workspaceId: manager.workspaceId,
      agentId: manager.id
    }),
    getWorkspacePackageUsageOverview(manager.workspaceId),
    searchParams ?? Promise.resolve<{ packageUpgrade?: string; planSelection?: string }>({}),
    getWorkspacePackageUpgradeOptions(workspace.plan),
    listWorkspacePackageUpgradeInvoices(workspace.id)
  ]);

  const planSettings = getWorkspacePlanSettings(workspace.plan);
  const visiblePackageUpgradeOptions = packageUpgradeOptions
    .filter((option) => option.key !== "enterprise")
    .map((option) => ({ ...option, operationType: "UPGRADE" as const }));
  const initialPackageBillingPeriod = getDefaultWorkspacePackageBillingPeriod({
    pendingPlanChanges: packageUpgradeInvoices
  });
  const packageUpgradeStatus =
    resolvedSearchParams.packageUpgrade === "success" ||
    resolvedSearchParams.packageUpgrade === "failed" ||
    resolvedSearchParams.packageUpgrade === "pending"
      ? resolvedSearchParams.packageUpgrade
      : null;
  const planSelectionNotice =
    resolvedSearchParams.planSelection === "current"
      ? "This is your current plan."
      : null;
  const channel = health.channel as WorkspaceWhatsAppChannelStatus | null;
  const effectiveConnectionStatus = health.runtimeStatus ?? channel?.connectionStatus ?? "DISCONNECTED";
  const inboxReadinessLabel = getInboxReadinessLabel(health);
  const workspaceStatusLabel = getWorkspaceStatusLabel(health);
  const latestSyncIssue = health.lastSyncError ?? health.workerStatus.latestFailure?.message ?? "No recent issue recorded";
  const sessionOwnerLabel =
    channel?.connectedByAgentId === manager.id
      ? `${manager.name} (${manager.email})`
      : channel?.connectedByAgentName
        ? `${channel.connectedByAgentName} (Connexa user)`
        : "Not recorded";
  const numberEntries = [
    {
      id: channel?.id ?? "primary",
      orderLabel: "01",
      title: channel?.phoneNumber || "No WhatsApp number linked yet",
      connectionLabel: getNumberConnectionLabel(effectiveConnectionStatus),
      isReady: effectiveConnectionStatus === "READY",
      description: channel?.phoneNumber
        ? "This is the current workspace WhatsApp line handling inbound and outbound conversations."
        : "No number has been linked yet. Open the setup flow to connect the first WhatsApp number for this workspace.",
      sessionOwner: sessionOwnerLabel,
      profileName: channel?.displayName ?? "Not connected",
      lastConnected: formatConnectedAt(channel?.connectedAt),
      inboxReadiness: inboxReadinessLabel,
      healthSummary: latestSyncIssue === "No recent issue recorded" ? "No issues" : "Needs review",
      isConnected: Boolean(channel?.phoneNumber)
    }
  ];
  const hasConnectedNumber = numberEntries.some((entry) => entry.isConnected);
  const activeNumbersCount = numberEntries.filter((entry) => entry.isConnected).length;
  const numberLimit = planSettings.numberLimit;
  const remainingNumberSlots = numberLimit === null ? null : Math.max(numberLimit - activeNumbersCount, 0);
  const numberLimitLabel = numberLimit === null ? "Unlimited" : `${numberLimit} numbers`;
  const numberUsageLabel =
    numberLimit === null ? `${activeNumbersCount} active` : `${activeNumbersCount} of ${numberLimit}`;
  const packageStepStatus = "Completed";
  const numberStepStatus = hasConnectedNumber ? "Completed" : "Needs setup";
  const inboxStepStatus = health.isInboxReady ? "Completed" : "Review";
  const usageStepStatus = "Completed";
  const completedSetupSteps = [
    packageStepStatus,
    numberStepStatus,
    inboxStepStatus,
    usageStepStatus
  ].filter((status) => status === "Completed").length;

  return (
    <DashboardShell currentPath="/account-settings">
      <div className="more-page-stack">
        <section className="account-setup-hero">
          <div className="account-setup-hero-copy">
            <span className="account-setup-kicker">Account settings</span>
            <h2>Finish your workspace setup step by step.</h2>
            <p>
              Keep the essentials visible: package, WhatsApp number, inbox readiness, and usage.
              Detailed diagnostics stay available when needed.
            </p>
          </div>

          <div className="account-setup-progress-card">
            <span>Setup progress</span>
            <strong>{completedSetupSteps} of 4 completed</strong>
            <div className="account-setup-progress-track">
              <div style={{ width: `${(completedSetupSteps / 4) * 100}%` }} />
            </div>
            <p>{workspace.name}</p>
            <a className="button button-primary" href="/account-settings/billing">
              Billing &amp; Subscription
            </a>
          </div>
        </section>

        {planSelectionNotice ? <p className="form-success">{planSelectionNotice}</p> : null}

        <AccountSecurityCard />

        <section className="account-setup-layout">
        <div className="account-setup-steps">
          <article className="account-setup-step">
            <div className="account-setup-step-marker">1</div>
            <div className="account-setup-step-body">
              <div className="account-setup-step-head">
                <div>
                  <span className="account-setup-eyebrow">Choose package</span>
                  <h3>{planSettings.label}</h3>
                </div>
                <span className="account-setup-status completed">{packageStepStatus}</span>
              </div>
              <p>
                Your package controls workspace limits and WhatsApp number capacity.
              </p>
              <div className="account-setup-mini-grid">
                <div>
                  <span>Numbers</span>
                  <strong>{numberLimitLabel}</strong>
                </div>
                <div>
                  <span>In use</span>
                  <strong>{numberUsageLabel}</strong>
                </div>
              </div>
              <WorkspacePackageUpgradeCard
                currentPackageLabel={planSettings.label}
                feedbackStatus={packageUpgradeStatus}
                initialBillingPeriod={initialPackageBillingPeriod}
                initialInvoices={packageUpgradeInvoices}
                options={visiblePackageUpgradeOptions}
              />
            </div>
          </article>

          <article className="account-setup-step account-setup-step-primary">
            <div className="account-setup-step-marker">2</div>
            <div className="account-setup-step-body">
              <div className="account-setup-step-head">
                <div>
                  <span className="account-setup-eyebrow">Connect WhatsApp number</span>
                  <h3>{numberEntries[0].title}</h3>
                </div>
                <span className={`account-setup-status${hasConnectedNumber ? " completed" : " needs-setup"}`}>
                  {numberStepStatus}
                </span>
              </div>
              <p>{numberEntries[0].description}</p>
              <div className="account-setup-actions">
                <a className="button button-primary" href="/settings/whatsapp">
                  {hasConnectedNumber ? "Open WhatsApp setup" : "Add WhatsApp number"}
                </a>
                <a className="button button-secondary" href="/inbox">
                  Open inbox
                </a>
              </div>

              <details className="account-setup-details">
                <summary>View number details</summary>
                <div className="account-setup-detail-grid">
                  <div>
                    <span>Connexa user</span>
                    <strong>{numberEntries[0].sessionOwner}</strong>
                  </div>
                  <div>
                    <span>Profile name</span>
                    <strong>{numberEntries[0].profileName}</strong>
                  </div>
                  <div>
                    <span>Last connected</span>
                    <strong>{numberEntries[0].lastConnected}</strong>
                  </div>
                  <div>
                    <span>Health</span>
                    <strong>{numberEntries[0].healthSummary}</strong>
                  </div>
                </div>
              </details>
            </div>
          </article>

          <article className="account-setup-step">
            <div className="account-setup-step-marker">3</div>
            <div className="account-setup-step-body">
              <div className="account-setup-step-head">
                <div>
                  <span className="account-setup-eyebrow">Check inbox readiness</span>
                  <h3>{inboxReadinessLabel}</h3>
                </div>
                <span className={`account-setup-status${health.isInboxReady ? " completed" : " review"}`}>
                  {inboxStepStatus}
                </span>
              </div>
              <p>
                Confirm the connection, worker, and message import health before relying on the inbox.
              </p>
              <div className="account-setup-mini-grid">
                <div>
                  <span>Runtime</span>
                  <strong>{health.runtimeStatus}</strong>
                </div>
                <div>
                  <span>Worker</span>
                  <strong>{getWorkerStatusLabel(health)}</strong>
                </div>
              </div>

              <details className="account-setup-details">
                <summary>View diagnostics</summary>
                <div className="account-setup-detail-grid">
                  <div>
                    <span>Imported</span>
                    <strong>{health.importedConversationCount} conversations, {health.importedMessageCount} messages</strong>
                  </div>
                  <div>
                    <span>Latest sync issue</span>
                    <strong>{latestSyncIssue}</strong>
                  </div>
                  <div>
                    <span>Live traffic</span>
                    <strong>{getVerificationLabel(health.verificationState)}</strong>
                  </div>
                  <div>
                    <span>Last inbound</span>
                    <strong>{formatConnectedAt(health.lastInboundAt)}</strong>
                  </div>
                  <div>
                    <span>Last outbound</span>
                    <strong>{formatConnectedAt(health.lastOutboundAt)}</strong>
                  </div>
                </div>
              </details>
            </div>
          </article>

          <article className="account-setup-step">
            <div className="account-setup-step-marker">4</div>
            <div className="account-setup-step-body">
              <div className="account-setup-step-head">
                <div>
                  <span className="account-setup-eyebrow">Review usage</span>
                  <h3>{packageUsage.packageLabel} usage</h3>
                </div>
                <span className="account-setup-status completed">{usageStepStatus}</span>
              </div>
              <p>
                Track usage against package limits without crowding the main setup flow.
              </p>
              <div className="account-setup-usage-grid">
                <div>
                  <span>Outbound messages</span>
                  <strong>{formatUsageValue(packageUsage.currentOutboundMessages, packageUsage.maxOutboundMessages)}</strong>
                  <p>{formatRemainingValue(packageUsage.remainingOutboundMessages, "outbound messages")}</p>
                </div>
                <div>
                  <span>Active contacts</span>
                  <strong>{formatUsageValue(packageUsage.currentActiveContacts, packageUsage.maxActiveContacts)}</strong>
                  <p>{formatRemainingValue(packageUsage.remainingActiveContacts, "active contacts")}</p>
                </div>
                <div>
                  <span>Active automations</span>
                  <strong>{formatUsageValue(packageUsage.currentActiveAutomations, packageUsage.maxActiveAutomations)}</strong>
                  <p>{formatRemainingValue(packageUsage.remainingActiveAutomations, "active automations")}</p>
                </div>
                <div>
                  <span>WhatsApp campaigns</span>
                  <strong>{formatUsageValue(packageUsage.currentWhatsAppCampaigns, packageUsage.maxWhatsAppCampaigns)}</strong>
                  <p>{formatRemainingValue(packageUsage.remainingWhatsAppCampaigns, "WhatsApp campaigns")}</p>
                </div>
              </div>
            </div>
          </article>
        </div>

        <aside className="account-setup-side">
          <article className="account-setup-side-card">
            <span>Workspace status</span>
            <strong>{workspaceStatusLabel}</strong>
            <p>{inboxReadinessLabel}</p>
          </article>
          <article className="account-setup-side-card">
            <span>Available number slots</span>
            <strong>
              {remainingNumberSlots === null
                ? "Unlimited"
                : `${remainingNumberSlots} slot${remainingNumberSlots === 1 ? "" : "s"}`}
            </strong>
            <p>
              {numberLimit === null
                ? "Additional numbers can be added without a package cap."
                : "Additional numbers depend on the selected package."}
            </p>
          </article>
          <article className="account-setup-side-card muted">
            <span>Additional numbers</span>
            <strong>Package-based</strong>
            <p>More WhatsApp lines will appear here when multi-number support is enabled.</p>
          </article>
        </aside>
        </section>
      </div>
    </DashboardShell>
  );
}
