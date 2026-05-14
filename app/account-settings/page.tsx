import { DashboardShell } from "@/components/dashboard-shell";
import { requireManager } from "@/lib/auth/current-user";
import { findWorkspaceById } from "@/lib/db-auth";
import { getWorkspacePackageUsageOverview } from "@/lib/package-feature-limits";
import type { WorkspaceWhatsAppChannelStatus } from "@/lib/whatsapp-channel";
import { getWorkspaceWhatsAppHealth } from "@/lib/whatsapp-health";
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

function getInboxReadinessLabel(health: Awaited<ReturnType<typeof getWorkspaceWhatsAppHealth>>) {
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

function getWorkspaceStatusLabel(health: Awaited<ReturnType<typeof getWorkspaceWhatsAppHealth>>) {
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

function getWorkerStatusLabel(health: Awaited<ReturnType<typeof getWorkspaceWhatsAppHealth>>) {
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

export default async function AccountSettingsPage() {
  const manager = await requireManager();
  const [workspace, health, packageUsage] = await Promise.all([
    findWorkspaceById(manager.workspaceId),
    getWorkspaceWhatsAppHealth({
      workspaceId: manager.workspaceId,
      agentId: manager.id
    }),
    getWorkspacePackageUsageOverview(manager.workspaceId)
  ]);

  if (!workspace) {
    throw new Error("Workspace not found.");
  }

  const planSettings = getWorkspacePlanSettings(workspace.plan);
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

  return (
    <DashboardShell currentPath="/account-settings">
      <section className="settings-dark-hero">
        <div className="settings-dark-copy">
          <span className="badge connexa-public-badge">Account Setting</span>
          <h1>Manage this workspace&apos;s WhatsApp setup.</h1>
          <p>
            Review the current WhatsApp number, monitor connection status, and prepare for multi-number
            support. Number limits will follow the selected package when that feature is enabled.
          </p>
        </div>
      </section>

      <section className="account-settings-summary-grid">
        <article className="settings-dark-status-card">
          <span>Package</span>
          <strong>{planSettings.label}</strong>
          <p>
            {numberLimit === null
              ? "This package supports unlimited WhatsApp numbers when multi-number support goes live."
              : `This package supports up to ${numberLimit} WhatsApp number${numberLimit === 1 ? "" : "s"}.`}
          </p>
        </article>
        <article className="settings-dark-status-card">
          <span>Numbers in use</span>
          <strong>{numberUsageLabel}</strong>
          <p>
            {numberLimit === null
              ? "Additional numbers can be added without a package cap."
              : remainingNumberSlots === 0
                ? "This workspace is at the current package limit."
                : `${remainingNumberSlots} slot${remainingNumberSlots === 1 ? "" : "s"} remaining under this package.`}
          </p>
        </article>
        <article className="settings-dark-status-card">
          <span>Number limit</span>
          <strong>{numberLimitLabel}</strong>
          <p>Capacity is tied to the selected package rather than a fixed workspace default.</p>
        </article>
        <article className="settings-dark-status-card">
          <span>Workspace status</span>
          <strong>{workspaceStatusLabel}</strong>
          <p>{inboxReadinessLabel}</p>
        </article>
      </section>

      <section className="settings-dark-grid">
        <article className="content-card settings-dark-panel">
          <div className="card-header settings-dark-panel-head">
            <div>
              <h3 className="card-title">Current plan usage</h3>
              <p className="muted">
                Workspace usage is shown against the active {packageUsage.packageLabel} package limits for outbound messages, active contacts, active automations, and WhatsApp campaigns.
              </p>
            </div>
          </div>

          <div className="account-settings-summary-grid">
            <article className="settings-dark-status-card">
              <span>Outbound messages</span>
              <strong>
                {formatUsageValue(packageUsage.currentOutboundMessages, packageUsage.maxOutboundMessages)}
              </strong>
              <p>{formatRemainingValue(packageUsage.remainingOutboundMessages, "outbound messages")}</p>
            </article>
            <article className="settings-dark-status-card">
              <span>Active contacts</span>
              <strong>
                {formatUsageValue(packageUsage.currentActiveContacts, packageUsage.maxActiveContacts)}
              </strong>
              <p>{formatRemainingValue(packageUsage.remainingActiveContacts, "active contacts")}</p>
            </article>
            <article className="settings-dark-status-card">
              <span>Active automations</span>
              <strong>
                {formatUsageValue(packageUsage.currentActiveAutomations, packageUsage.maxActiveAutomations)}
              </strong>
              <p>{formatRemainingValue(packageUsage.remainingActiveAutomations, "active automations")}</p>
            </article>
            <article className="settings-dark-status-card">
              <span>WhatsApp campaigns</span>
              <strong>
                {formatUsageValue(packageUsage.currentWhatsAppCampaigns, packageUsage.maxWhatsAppCampaigns)}
              </strong>
              <p>{formatRemainingValue(packageUsage.remainingWhatsAppCampaigns, "WhatsApp campaigns")}</p>
            </article>
          </div>
        </article>
      </section>

      <section className="settings-dark-grid">
        <article className="content-card settings-dark-panel">
          <div className="card-header settings-dark-panel-head">
            <div>
              <h3 className="card-title">WhatsApp numbers</h3>
              <p className="muted">
                Each number will have its own connection state, inbox readiness, and history status.
                Today this workspace shows the current active line and reserves room for more.
              </p>
            </div>
            <a className="button button-primary" href="/settings/whatsapp">
              {hasConnectedNumber ? "Open WhatsApp setup" : "Add WhatsApp number"}
            </a>
          </div>

          <div className="account-settings-number-list">
            {numberEntries.map((entry) => (
              <article className="account-settings-number-row" key={entry.id}>
                <div className="account-settings-number-main">
                  <div className="account-settings-number-badge">{entry.orderLabel}</div>
                  <div className="account-settings-number-copy">
                    <div className="account-settings-number-head">
                      <strong>{entry.title}</strong>
                      <span
                        className={`account-settings-number-status${entry.isReady ? " ready" : ""}`}
                      >
                        {entry.connectionLabel}
                      </span>
                    </div>
                    <p>{entry.description}</p>
                  </div>
                </div>

                <div className="account-settings-number-meta">
                  <div>
                    <span>Connexa user</span>
                    <strong>{entry.sessionOwner}</strong>
                  </div>
                  <div>
                    <span>Profile name</span>
                    <strong>{entry.profileName}</strong>
                  </div>
                  <div>
                    <span>Last connected</span>
                    <strong>{entry.lastConnected}</strong>
                  </div>
                  <div>
                    <span>Inbox readiness</span>
                    <strong>{entry.inboxReadiness}</strong>
                  </div>
                  <div>
                    <span>Health</span>
                    <strong>{entry.healthSummary}</strong>
                  </div>
                  <div>
                    <span>Connection screen</span>
                    <a href="/settings/whatsapp">Open WhatsApp setup</a>
                  </div>
                </div>
              </article>
            ))}

            <article className="account-settings-number-row account-settings-number-row-placeholder">
              <div className="account-settings-number-main">
                <div className="account-settings-number-badge account-settings-number-badge-muted">+</div>
                <div className="account-settings-number-copy">
                  <div className="account-settings-number-head">
                    <strong>Additional numbers</strong>
                    <span className="account-settings-number-status account-settings-number-status-muted">Package-based</span>
                  </div>
                  <p>
                    More WhatsApp lines will appear here when multi-number support is enabled for the
                    selected workspace package.
                  </p>
                </div>
              </div>

              <div className="account-settings-number-meta">
                <div>
                  <span>Cap policy</span>
                  <strong>{numberLimit === null ? "Unlimited under package" : `${numberLimit} number limit`}</strong>
                </div>
                <div>
                  <span>Expected use</span>
                  <strong>Sales, support, branch lines</strong>
                </div>
                <div>
                  <span>Current state</span>
                  <strong>UI ready, backend cap pending</strong>
                </div>
              </div>
            </article>
          </div>
        </article>

        <article className="content-card settings-dark-panel">
          <div className="card-header settings-dark-panel-head">
            <div>
              <h3 className="card-title">Number health</h3>
              <p className="muted">
                Health is shown for the currently connected number. When multi-number support is enabled,
                each line should have its own health panel or drawer.
              </p>
            </div>
          </div>

          <div className="panel-row">
            <div className="lead-row">
              <strong>Runtime status</strong>
              <div className="table-subtle">
                {health.runtimeStatus}
              </div>
            </div>
            <div className="lead-row">
              <strong>Inbox readiness</strong>
              <div className="table-subtle">
                {inboxReadinessLabel}
              </div>
            </div>
            <div className="lead-row">
              <strong>Imported so far</strong>
              <div className="table-subtle">
                {health.importedConversationCount} conversations, {health.importedMessageCount} messages
              </div>
            </div>
            <div className="lead-row">
              <strong>Outbound worker</strong>
              <div className="table-subtle">
                {getWorkerStatusLabel(health)}
              </div>
            </div>
            <div className="lead-row">
              <strong>Latest sync issue</strong>
              <div className="table-subtle">
                {latestSyncIssue}
              </div>
            </div>
            <div className="lead-row">
              <strong>Health scope</strong>
              <div className="table-subtle">
                This panel reflects the current connected number. Future work should split health by
                line instead of treating the whole workspace as one runtime.
              </div>
            </div>
            <div className="lead-row">
              <strong>Live traffic check</strong>
              <div className="table-subtle">
                {getVerificationLabel(health.verificationState)}
              </div>
            </div>
            <div className="lead-row">
              <strong>Last inbound</strong>
              <div className="table-subtle">
                {formatConnectedAt(health.lastInboundAt)}
              </div>
            </div>
            <div className="lead-row">
              <strong>Last outbound</strong>
              <div className="table-subtle">
                {formatConnectedAt(health.lastOutboundAt)}
              </div>
            </div>
          </div>
        </article>

        <article className="content-card settings-dark-panel">
          <div className="card-header settings-dark-panel-head">
            <div>
              <h3 className="card-title">Package capacity</h3>
              <p className="muted">
                The selected package will control how many WhatsApp numbers this workspace can connect.
              </p>
            </div>
          </div>

          <div className="panel-row">
            <div className="lead-row">
              <strong>Current package</strong>
              <div className="table-subtle">{planSettings.label}</div>
            </div>
            <div className="lead-row">
              <strong>Allowed numbers</strong>
              <div className="table-subtle">{numberLimit === null ? "Unlimited" : `${numberLimit} numbers`}</div>
            </div>
            <div className="lead-row">
              <strong>Connected today</strong>
              <div className="table-subtle">
                {activeNumbersCount} active {activeNumbersCount === 1 ? "number" : "numbers"}
              </div>
            </div>
            <div className="lead-row">
              <strong>Available slots</strong>
              <div className="table-subtle">
                {remainingNumberSlots === null
                  ? "Unlimited"
                  : `${remainingNumberSlots} slot${remainingNumberSlots === 1 ? "" : "s"} remaining`}
              </div>
            </div>
            <div className="lead-row">
              <strong>Expansion model</strong>
              <div className="table-subtle">Add sales, support, or branch lines under the selected package.</div>
            </div>
          </div>
        </article>
      </section>
    </DashboardShell>
  );
}
