import { PlatformAdminShell } from "@/components/platform-admin-shell";
import { PlatformWhatsAppSessionResetButton } from "@/components/platform-whatsapp-session-reset-button";
import { getPlatformAdminNavItems } from "@/lib/platform-admin-nav";
import { requireCurrentPlatformAdmin } from "@/lib/platform-auth/current-user";
import { getPlatformWhatsAppHealthOverview } from "@/lib/platform-whatsapp-health";

export const dynamic = "force-dynamic";

const DISPLAY_TIME_ZONE = "Asia/Kuala_Lumpur";
type PlatformWhatsAppOverviewRow = Awaited<ReturnType<typeof getPlatformWhatsAppHealthOverview>>["rows"][number];

function formatDateTime(value: string | null) {
  if (!value) {
    return "Not recorded";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Not recorded";
  }

  return new Intl.DateTimeFormat("en-MY", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: DISPLAY_TIME_ZONE
  }).format(date);
}

function formatDuration(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return "Not recorded";
  }

  if (value < 1000) {
    return `${value} ms`;
  }

  return `${(value / 1000).toFixed(1)} s`;
}

function getWorkspaceStateLabel(input: {
  runtimeStatus: string;
  supervisor?: {
    requiresManualAttention?: boolean;
  } | null;
  isConnectionStalled: boolean;
  isLiveOnlyMode: boolean;
  isHistoryStuck: boolean;
  isHistoryStabilizing: boolean;
  isInboxReady: boolean;
}) {
  if (input.supervisor?.requiresManualAttention) {
    return "Needs manual attention";
  }

  if (input.isConnectionStalled) {
    return "Reconnect stalled";
  }

  if (input.isLiveOnlyMode) {
    return "Live only";
  }

  if (input.isHistoryStuck) {
    return "Import stuck";
  }

  if (input.isHistoryStabilizing) {
    return "Stabilizing";
  }

  if (input.isInboxReady) {
    return "Ready";
  }

  if (input.runtimeStatus === "AUTH_FAILED" || input.runtimeStatus === "QR_READY") {
    return "Needs relink";
  }

  if (input.runtimeStatus === "ERROR") {
    return "Runtime error";
  }

  return input.runtimeStatus === "DISCONNECTED" ? "Disconnected" : input.runtimeStatus;
}

function getWorkerStatusLabel(row: PlatformWhatsAppOverviewRow) {
  if (row.workerStatus.heartbeat?.isOnline) {
    return `Online (${row.workerStatus.heartbeat.workerLabel ?? "worker"})`;
  }

  if (row.runtimeStatus === "QR_READY" || row.runtimeStatus === "AUTH_FAILED") {
    return row.workerStatus.pending > 0 ? "Relink required before queued sends" : "Waiting for WhatsApp relink";
  }

  if (row.workerStatus.pending > 0) {
    return "Offline with queued jobs";
  }

  return "Offline or no heartbeat";
}

function getVerificationLabel(state: string) {
  if (state === "two_way_live") {
    return "Inbound and outbound verified";
  }

  if (state === "inbound_live") {
    return "Inbound only";
  }

  if (state === "outbound_live") {
    return "Outbound only";
  }

  return "Not verified yet";
}

function getPhoneStatusLabel(status: string) {
  if (status === "READY") {
    return "Ready";
  }

  if (status === "CONNECTED") {
    return "Connected";
  }

  if (status === "SYNCING_HISTORY") {
    return "Syncing history";
  }

  if (status === "QR_READY") {
    return "Needs QR scan";
  }

  if (status === "AUTH_FAILED") {
    return "Auth failed";
  }

  if (status === "INITIALIZING") {
    return "Starting";
  }

  return status;
}

function getPhoneStatusTone(status: string) {
  if (status === "READY" || status === "CONNECTED") {
    return "status-ready";
  }

  if (status === "AUTHENTICATED") {
    return "status-authenticated";
  }

  if (status === "SYNCING_HISTORY") {
    return "status-syncing-history";
  }

  if (status === "AUTH_FAILED" || status === "ERROR") {
    return "status-error";
  }

  if (status === "QR_READY") {
    return "status-qr-ready";
  }

  if (status === "INITIALIZING") {
    return "status-initializing";
  }

  if (status === "DISCONNECTED") {
    return "status-disconnected";
  }

  return "status-unknown";
}

function getRuntimeStatusTone(status: string) {
  if (status === "READY" || status === "CONNECTED") {
    return "status-ready";
  }

  if (status === "AUTHENTICATED") {
    return "status-authenticated";
  }

  if (status === "SYNCING_HISTORY") {
    return "status-syncing-history";
  }

  if (status === "AUTH_FAILED" || status === "ERROR") {
    return "status-error";
  }

  if (status === "QR_READY") {
    return "status-qr-ready";
  }

  if (status === "INITIALIZING") {
    return "status-initializing";
  }

  if (status === "DISCONNECTED") {
    return "status-disconnected";
  }

  return "status-unknown";
}

export default async function PlatformWhatsAppPage() {
  const [admin, overview] = await Promise.all([
    requireCurrentPlatformAdmin(),
    getPlatformWhatsAppHealthOverview()
  ]);

  return (
    <main className="connexa-dark-shell connexa-public-shell">
      <PlatformAdminShell
        adminEmail={admin.email}
        currentKey="whatsapp"
        description="Watch QR session health, history import stability, live-only fallbacks, imported counts, and worker state across every workspace from one platform view."
        items={getPlatformAdminNavItems()}
        title="WhatsApp operations need one platform view before launch."
      >
        <div className="platform-admin-toolbar platform-ops-summary">
          <div className="settings-dark-status-card platform-ops-kpi-card">
            <span>Connected workspaces</span>
            <strong>{overview.summary.connectedWorkspaces}</strong>
            <p>{overview.summary.totalWorkspaces} total workspaces tracked.</p>
          </div>
          <div className="settings-dark-status-card platform-ops-kpi-card">
            <span>Inbox ready</span>
            <strong>{overview.summary.readyWorkspaces}</strong>
            <p>Workspaces currently ready without relying on live-only fallback.</p>
          </div>
          <div className="settings-dark-status-card platform-ops-kpi-card">
            <span>Live-only fallbacks</span>
            <strong>{overview.summary.liveOnlyWorkspaces}</strong>
            <p>Historical import deferred, but live messaging should still be usable.</p>
          </div>
          <div className="settings-dark-status-card platform-ops-kpi-card">
            <span>Needs attention</span>
            <strong>{overview.summary.alertWorkspaces}</strong>
            <p>Workspaces with relink, sync, or worker attention signals.</p>
          </div>
          <div className="settings-dark-status-card platform-ops-kpi-card">
            <span>Reconnects · 24h</span>
            <strong>{overview.summary.reconnects24h}</strong>
            <p>Automatic reconnect and stall-recovery actions recorded in the last 24 hours.</p>
          </div>
          <div className="settings-dark-status-card platform-ops-kpi-card">
            <span>QR refreshes · 24h</span>
            <strong>{overview.summary.qrEvents24h}</strong>
            <p>How often sessions required or regenerated a QR in the last 24 hours.</p>
          </div>
          <div className="settings-dark-status-card platform-ops-kpi-card">
            <span>Auth failures · 24h</span>
            <strong>{overview.summary.authFailures24h}</strong>
            <p>Workspaces where WhatsApp reported session authentication failures in the last 24 hours.</p>
          </div>
          <div className="settings-dark-status-card platform-ops-kpi-card">
            <span>Idle evictions · 24h</span>
            <strong>{overview.summary.idleEvictions24h}</strong>
            <p>Browsers cleanly unloaded after inactivity while keeping saved sessions on disk.</p>
          </div>
          <div className="settings-dark-status-card platform-ops-kpi-card">
            <span>Sender RSS</span>
            <strong>{overview.senderMetrics?.process.rssMb ?? "n/a"} MB</strong>
            <p>
              Heap {overview.senderMetrics?.process.heapUsedMb ?? "n/a"} /{" "}
              {overview.senderMetrics?.process.heapTotalMb ?? "n/a"} MB on the current sender node.
            </p>
          </div>
          <div className="settings-dark-status-card platform-ops-kpi-card">
            <span>Warm runtimes</span>
            <strong>{overview.senderMetrics?.runtimes.activeWarm ?? 0}</strong>
            <p>
              Connected {overview.senderMetrics?.runtimes.connected ?? 0} · supervisor paused{" "}
              {overview.senderMetrics?.runtimes.supervisorPaused ?? 0}
            </p>
          </div>
          <div className="settings-dark-status-card platform-ops-kpi-card">
            <span>Cold start ready</span>
            <strong>{formatDuration(overview.senderMetrics?.latencies.coldStartReadyAvgMs ?? null)}</strong>
            <p>
              P95 {formatDuration(overview.senderMetrics?.latencies.coldStartReadyP95Ms ?? null)} from browser
              start to ready.
            </p>
          </div>
          <div className="settings-dark-status-card platform-ops-kpi-card">
            <span>Send latency</span>
            <strong>{formatDuration(overview.senderMetrics?.latencies.sendAvgMs ?? null)}</strong>
            <p>
              Cold-start send P95 {formatDuration(overview.senderMetrics?.latencies.coldStartSendP95Ms ?? null)}.
            </p>
          </div>
        </div>

        <article className="content-card settings-dark-panel">
          <div className="card-header settings-dark-panel-head">
            <div>
              <h3 className="card-title">Imported footprint</h3>
              <p className="muted">
                Historical import is now treated as best-effort. These counts help you see which workspaces already have
                usable history and which ones are running live-first.
              </p>
            </div>
          </div>

          <div className="platform-ops-inline-metrics">
            <div className="lead-row platform-ops-footprint-card">
              <strong>Imported conversations</strong>
              <div className="table-subtle">{overview.summary.totalImportedConversations}</div>
            </div>
            <div className="lead-row platform-ops-footprint-card">
              <strong>Imported messages</strong>
              <div className="table-subtle">{overview.summary.totalImportedMessages}</div>
            </div>
          </div>
        </article>

        <article className="content-card settings-dark-panel">
          <div className="card-header settings-dark-panel-head">
            <div>
              <h3 className="card-title">Workspace WhatsApp health</h3>
              <p className="muted">
                Use this as the launch operations screen: connection state, imported counts, live traffic proof, worker
                heartbeat, and recovery alerts per workspace.
              </p>
            </div>
          </div>

          <div className="platform-ops-list">
            {overview.rows.map((row: PlatformWhatsAppOverviewRow) => (
              <article className="platform-ops-row" key={row.id}>
                <div className="platform-ops-row-head">
                  <div>
                    <h4>{row.name}</h4>
                    <p>
                      {row.slug} · {row.plan}
                    </p>
                  </div>
                  <span className={`account-settings-number-status${row.isInboxReady ? " ready" : ""}`}>
                    {getWorkspaceStateLabel(row)}
                  </span>
                </div>

                <div className="platform-ops-row-grid">
                  <div className="lead-row">
                    <strong>Linked phones</strong>
                    <div className="table-subtle">
                      {row.channels.length ? (
                        <ol className="platform-ops-phone-list">
                          {row.channels.map((channel, index) => (
                            <li className="platform-ops-phone-item" key={channel.id}>
                              <div className="platform-ops-phone-item-head">
                                <strong>{`${index + 1}) ${channel.label}`}</strong>
                                <span className={`platform-ops-status-pill ${getPhoneStatusTone(channel.connectionStatus)}`}>
                                  {getPhoneStatusLabel(channel.connectionStatus)}
                                </span>
                              </div>
                              <div className="platform-ops-phone-item-meta">
                                {channel.phoneNumber && channel.phoneNumber !== channel.label ? (
                                  <span>{channel.phoneNumber}</span>
                                ) : null}
                                <span>{channel.connectionMethod === "api" ? "Cloud API" : "QR session"}</span>
                                <span>{channel.connectedBy ?? "Unknown connector"}</span>
                                <span>{formatDateTime(channel.connectedAt)}</span>
                              </div>
                            </li>
                          ))}
                        </ol>
                      ) : (
                        "No number linked"
                      )}
                    </div>
                  </div>
                  <div className="lead-row">
                    <strong>Login email</strong>
                    <div className="table-subtle">{row.loginEmail ?? "Not recorded"}</div>
                  </div>
                  <div className="lead-row">
                    <strong>Primary number</strong>
                    <div className="table-subtle">{row.phoneNumber ?? "No number linked"}</div>
                  </div>
                  <div className="lead-row">
                    <strong>Connected by</strong>
                    <div className="table-subtle">{row.connectedBy ?? "Not recorded"}</div>
                  </div>
                  <div className="lead-row">
                    <strong>Connected at</strong>
                    <div className="table-subtle">{formatDateTime(row.connectedAt)}</div>
                  </div>
                  <div className="lead-row">
                    <strong>Runtime</strong>
                    <div className={`platform-ops-status-pill ${getRuntimeStatusTone(row.runtimeStatus)}`}>{row.runtimeStatus}</div>
                  </div>
                  <div className="lead-row">
                    <strong>Supervisor</strong>
                    <div className="table-subtle">
                      {row.supervisor?.stateLabel ?? "Healthy"}
                      {row.supervisor?.recentAutoRecoveryCount
                        ? ` · ${row.supervisor.recentAutoRecoveryCount} recoveries in window`
                        : ""}
                    </div>
                  </div>
                  <div className="lead-row">
                    <strong>Imported</strong>
                    <div className="table-subtle">
                      {row.importedConversationCount} conversations · {row.importedMessageCount} messages
                    </div>
                  </div>
                  <div className="lead-row">
                    <strong>Worker</strong>
                    <div className="table-subtle">
                      {getWorkerStatusLabel(row)}
                    </div>
                  </div>
                  <div className="lead-row">
                    <strong>Live traffic</strong>
                    <div className="table-subtle">{getVerificationLabel(row.verificationState)}</div>
                  </div>
                  <div className="lead-row">
                    <strong>Last inbound</strong>
                    <div className="table-subtle">{formatDateTime(row.lastInboundAt)}</div>
                  </div>
                  <div className="lead-row">
                    <strong>Last outbound</strong>
                    <div className="table-subtle">{formatDateTime(row.lastOutboundAt)}</div>
                  </div>
                  <div className="lead-row">
                    <strong>Outbound queue</strong>
                    <div className="table-subtle">
                      {row.workerStatus.pending} pending · {row.workerStatus.failed} failed
                    </div>
                  </div>
                  <div className="lead-row">
                    <strong>Runtime events · 24h</strong>
                    <div className="table-subtle">
                      {row.runtimeMetrics.reconnects24h} reconnects · {row.runtimeMetrics.qrEvents24h} QR ·{" "}
                      {row.runtimeMetrics.authFailures24h} auth failures · {row.runtimeMetrics.idleEvictions24h} idle evictions
                    </div>
                  </div>
                  <div className="lead-row">
                    <strong>Last runtime event</strong>
                    <div className="table-subtle">{formatDateTime(row.runtimeMetrics.lastEventAt)}</div>
                  </div>
                  <div className="lead-row">
                    <strong>Attention since</strong>
                    <div className="table-subtle">{formatDateTime(row.supervisor?.manualAttentionSince ?? null)}</div>
                  </div>
                  <div className="lead-row">
                    <strong>Last ready time</strong>
                    <div className="table-subtle">
                      {row.senderMetrics?.lastReadyDurationMs !== null && row.senderMetrics?.lastReadyDurationMs !== undefined
                        ? `${formatDateTime(row.senderMetrics.lastReadyAt)} · ${formatDuration(row.senderMetrics.lastReadyDurationMs)}`
                        : "Not recorded"}
                    </div>
                  </div>
                  <div className="lead-row">
                    <strong>Last send</strong>
                    <div className="table-subtle">
                      {row.senderMetrics?.lastSendDurationMs !== null && row.senderMetrics?.lastSendDurationMs !== undefined
                        ? `${formatDateTime(row.senderMetrics.lastSendCompletedAt)} · ${formatDuration(row.senderMetrics.lastSendDurationMs)}`
                        : "Not recorded"}
                    </div>
                  </div>
                  <div className="lead-row">
                    <strong>Cold starts · 24h</strong>
                    <div className="table-subtle">
                      {row.senderMetrics?.coldStarts24h ?? 0} · last ready{" "}
                      {formatDuration(row.senderMetrics?.lastColdStartReadyDurationMs ?? null)}
                    </div>
                  </div>
                </div>

                <div className="platform-ops-alerts">
                  {row.alerts.length ? (
                    row.alerts.map((alert: string) => (
                      <span className="platform-ops-alert" key={alert}>
                        {alert}
                      </span>
                    ))
                  ) : (
                    <span className="platform-ops-alert ok">No current alerts</span>
                  )}
                </div>

                {row.runtimeMetrics.latestEvents.length ? (
                  <div className="platform-ops-runtime-log">
                    {row.supervisor?.manualAttentionReason ? (
                      <div className="platform-ops-runtime-log-item">
                        <strong>SUPERVISOR</strong>
                        <span>{formatDateTime(row.supervisor.manualAttentionSince ?? null)}</span>
                        <p>{row.supervisor.manualAttentionReason}</p>
                      </div>
                    ) : null}
                    {row.runtimeMetrics.latestEvents.map((event: { eventType: string; message: string | null; createdAt: string }) => (
                      <div className="platform-ops-runtime-log-item" key={`${event.eventType}-${event.createdAt}`}>
                        <strong>{event.eventType}</strong>
                        <span>{formatDateTime(event.createdAt)}</span>
                        <p>{event.message ?? "No message recorded"}</p>
                      </div>
                    ))}
                  </div>
                ) : row.supervisor?.manualAttentionReason ? (
                  <div className="platform-ops-runtime-log">
                    <div className="platform-ops-runtime-log-item">
                      <strong>SUPERVISOR</strong>
                      <span>{formatDateTime(row.supervisor.manualAttentionSince ?? null)}</span>
                      <p>{row.supervisor.manualAttentionReason}</p>
                    </div>
                  </div>
                ) : null}

                <div className="platform-ops-row-actions">
                  <PlatformWhatsAppSessionResetButton
                    disabled={!row.hasSession}
                    workspaceId={row.id}
                    workspaceName={row.name}
                  />
                </div>
              </article>
            ))}
          </div>
        </article>
      </PlatformAdminShell>
    </main>
  );
}
