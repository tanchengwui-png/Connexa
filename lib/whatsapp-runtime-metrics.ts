export type WhatsAppWorkspaceRuntimeMetricSnapshot = {
  workspaceId: string;
  sessionClientId: string | null;
  runtimeStatus: string | null;
  lastRuntimeStartAt: string | null;
  lastReadyAt: string | null;
  lastReadyDurationMs: number | null;
  lastSendCompletedAt: string | null;
  lastSendDurationMs: number | null;
  lastColdStartReadyDurationMs: number | null;
  coldStarts24h: number;
};

type WhatsAppWorkspaceRuntimeMetricState = {
  sessionClientId: string | null;
  runtimeStatus: string | null;
  lastRuntimeStartAt: number | null;
  lastReadyAt: number | null;
  lastReadyDurationMs: number | null;
  lastSendCompletedAt: number | null;
  lastSendDurationMs: number | null;
  lastColdStartReadyDurationMs: number | null;
  coldStartReadyAtTimestamps: number[];
};

type WhatsAppSenderRuntimeMetricsState = {
  runtimeCreatedAtTimestamps: number[];
  restoreReadyDurationsMs: number[];
  coldStartReadyDurationsMs: number[];
  sendDurationsMs: number[];
  coldStartSendDurationsMs: number[];
  workspaceStates: Map<string, WhatsAppWorkspaceRuntimeMetricState>;
};

export type WhatsAppSenderNodeMetricsSnapshot = {
  process: {
    startedAt: string;
    uptimeSec: number;
    rssMb: number;
    heapUsedMb: number;
    heapTotalMb: number;
    externalMb: number;
  };
  runtimes: {
    totalTracked: number;
    activeWarm: number;
    connected: number;
    initializing: number;
    syncingHistory: number;
    qrReady: number;
    authenticated: number;
    supervisorPaused: number;
    runtimeCreates24h: number;
  };
  latencies: {
    restoreReadyAvgMs: number | null;
    restoreReadyP95Ms: number | null;
    coldStartReadyAvgMs: number | null;
    coldStartReadyP95Ms: number | null;
    sendAvgMs: number | null;
    sendP95Ms: number | null;
    coldStartSendAvgMs: number | null;
    coldStartSendP95Ms: number | null;
  };
  workspaces: WhatsAppWorkspaceRuntimeMetricSnapshot[];
};

declare global {
  // eslint-disable-next-line no-var
  var whatsAppSenderRuntimeMetrics: WhatsAppSenderRuntimeMetricsState | undefined;
}

const WINDOW_MS = 24 * 60 * 60 * 1000;

const metricsState =
  global.whatsAppSenderRuntimeMetrics ?? {
    runtimeCreatedAtTimestamps: [],
    restoreReadyDurationsMs: [],
    coldStartReadyDurationsMs: [],
    sendDurationsMs: [],
    coldStartSendDurationsMs: [],
    workspaceStates: new Map<string, WhatsAppWorkspaceRuntimeMetricState>()
  };

if (!global.whatsAppSenderRuntimeMetrics) {
  global.whatsAppSenderRuntimeMetrics = metricsState;
}

const processStartedAt = Date.now();

function pruneTimestamps(values: number[], now = Date.now()) {
  return values.filter((value) => now - value < WINDOW_MS);
}

function pruneDurations(values: number[]) {
  return values.slice(-200);
}

function getOrCreateWorkspaceState(workspaceId: string) {
  const existing = metricsState.workspaceStates.get(workspaceId);
  if (existing) {
    return existing;
  }

  const created: WhatsAppWorkspaceRuntimeMetricState = {
    sessionClientId: null,
    runtimeStatus: null,
    lastRuntimeStartAt: null,
    lastReadyAt: null,
    lastReadyDurationMs: null,
    lastSendCompletedAt: null,
    lastSendDurationMs: null,
    lastColdStartReadyDurationMs: null,
    coldStartReadyAtTimestamps: []
  };
  metricsState.workspaceStates.set(workspaceId, created);
  return created;
}

function average(values: number[]) {
  if (!values.length) {
    return null;
  }

  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function percentile(values: number[], p: number) {
  if (!values.length) {
    return null;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Math.round(sorted[index]);
}

function toIsoString(value: number | null) {
  return value ? new Date(value).toISOString() : null;
}

export function recordRuntimeStartMetric(input: {
  workspaceId: string;
  sessionClientId: string;
  runtimeStatus?: string | null;
}) {
  const now = Date.now();
  metricsState.runtimeCreatedAtTimestamps = pruneTimestamps(metricsState.runtimeCreatedAtTimestamps, now);
  metricsState.runtimeCreatedAtTimestamps.push(now);

  const workspace = getOrCreateWorkspaceState(input.workspaceId);
  workspace.sessionClientId = input.sessionClientId;
  workspace.runtimeStatus = input.runtimeStatus ?? "INITIALIZING";
  workspace.lastRuntimeStartAt = now;
}

export function recordRuntimeStatusMetric(input: {
  workspaceId: string;
  sessionClientId?: string | null;
  runtimeStatus: string;
}) {
  const workspace = getOrCreateWorkspaceState(input.workspaceId);
  workspace.sessionClientId = input.sessionClientId ?? workspace.sessionClientId;
  workspace.runtimeStatus = input.runtimeStatus;
}

export function recordRuntimeReadyMetric(input: {
  workspaceId: string;
  sessionClientId?: string | null;
  wasColdStart: boolean;
}) {
  const now = Date.now();
  const workspace = getOrCreateWorkspaceState(input.workspaceId);
  workspace.sessionClientId = input.sessionClientId ?? workspace.sessionClientId;
  workspace.runtimeStatus = "CONNECTED";
  workspace.lastReadyAt = now;

  if (workspace.lastRuntimeStartAt) {
    const durationMs = Math.max(0, now - workspace.lastRuntimeStartAt);
    workspace.lastReadyDurationMs = durationMs;
    metricsState.restoreReadyDurationsMs = pruneDurations([...metricsState.restoreReadyDurationsMs, durationMs]);

    if (input.wasColdStart) {
      workspace.lastColdStartReadyDurationMs = durationMs;
      workspace.coldStartReadyAtTimestamps = pruneTimestamps(workspace.coldStartReadyAtTimestamps, now);
      workspace.coldStartReadyAtTimestamps.push(now);
      metricsState.coldStartReadyDurationsMs = pruneDurations([
        ...metricsState.coldStartReadyDurationsMs,
        durationMs
      ]);
    }
  }
}

export function recordSendDurationMetric(input: {
  workspaceId: string;
  durationMs: number;
  wasColdStart: boolean;
}) {
  const now = Date.now();
  const workspace = getOrCreateWorkspaceState(input.workspaceId);
  workspace.lastSendCompletedAt = now;
  workspace.lastSendDurationMs = Math.max(0, Math.round(input.durationMs));
  metricsState.sendDurationsMs = pruneDurations([
    ...metricsState.sendDurationsMs,
    workspace.lastSendDurationMs
  ]);

  if (input.wasColdStart) {
    metricsState.coldStartSendDurationsMs = pruneDurations([
      ...metricsState.coldStartSendDurationsMs,
      workspace.lastSendDurationMs
    ]);
  }
}

export function getWhatsAppSenderNodeMetricsSnapshot(input: {
  activeRuntimes: Array<{
    workspaceId: string;
    sessionClientId: string;
    connectionStatus: string;
    isSyncingHistory: boolean;
  }>;
  supervisorPausedCount: number;
}) {
  const now = Date.now();
  metricsState.runtimeCreatedAtTimestamps = pruneTimestamps(metricsState.runtimeCreatedAtTimestamps, now);

  for (const [workspaceId, workspace] of metricsState.workspaceStates.entries()) {
    workspace.coldStartReadyAtTimestamps = pruneTimestamps(workspace.coldStartReadyAtTimestamps, now);

    const activeRuntime = input.activeRuntimes.find((runtime) => runtime.workspaceId === workspaceId);
    if (activeRuntime) {
      workspace.sessionClientId = activeRuntime.sessionClientId;
      workspace.runtimeStatus = activeRuntime.connectionStatus;
    }
  }

  const memoryUsage = process.memoryUsage();

  return {
    process: {
      startedAt: new Date(processStartedAt).toISOString(),
      uptimeSec: Math.round(process.uptime()),
      rssMb: Math.round((memoryUsage.rss / 1024 / 1024) * 10) / 10,
      heapUsedMb: Math.round((memoryUsage.heapUsed / 1024 / 1024) * 10) / 10,
      heapTotalMb: Math.round((memoryUsage.heapTotal / 1024 / 1024) * 10) / 10,
      externalMb: Math.round((memoryUsage.external / 1024 / 1024) * 10) / 10
    },
    runtimes: {
      totalTracked: metricsState.workspaceStates.size,
      activeWarm: input.activeRuntimes.length,
      connected: input.activeRuntimes.filter((runtime) =>
        ["CONNECTED", "READY", "SYNCING_HISTORY"].includes(runtime.connectionStatus)
      ).length,
      initializing: input.activeRuntimes.filter((runtime) => runtime.connectionStatus === "INITIALIZING").length,
      syncingHistory: input.activeRuntimes.filter((runtime) => runtime.isSyncingHistory).length,
      qrReady: input.activeRuntimes.filter((runtime) => runtime.connectionStatus === "QR_READY").length,
      authenticated: input.activeRuntimes.filter((runtime) => runtime.connectionStatus === "AUTHENTICATED").length,
      supervisorPaused: input.supervisorPausedCount,
      runtimeCreates24h: metricsState.runtimeCreatedAtTimestamps.length
    },
    latencies: {
      restoreReadyAvgMs: average(metricsState.restoreReadyDurationsMs),
      restoreReadyP95Ms: percentile(metricsState.restoreReadyDurationsMs, 95),
      coldStartReadyAvgMs: average(metricsState.coldStartReadyDurationsMs),
      coldStartReadyP95Ms: percentile(metricsState.coldStartReadyDurationsMs, 95),
      sendAvgMs: average(metricsState.sendDurationsMs),
      sendP95Ms: percentile(metricsState.sendDurationsMs, 95),
      coldStartSendAvgMs: average(metricsState.coldStartSendDurationsMs),
      coldStartSendP95Ms: percentile(metricsState.coldStartSendDurationsMs, 95)
    },
    workspaces: Array.from(metricsState.workspaceStates.entries()).map(([workspaceId, workspace]) => ({
      workspaceId,
      sessionClientId: workspace.sessionClientId,
      runtimeStatus: workspace.runtimeStatus,
      lastRuntimeStartAt: toIsoString(workspace.lastRuntimeStartAt),
      lastReadyAt: toIsoString(workspace.lastReadyAt),
      lastReadyDurationMs: workspace.lastReadyDurationMs,
      lastSendCompletedAt: toIsoString(workspace.lastSendCompletedAt),
      lastSendDurationMs: workspace.lastSendDurationMs,
      lastColdStartReadyDurationMs: workspace.lastColdStartReadyDurationMs,
      coldStarts24h: workspace.coldStartReadyAtTimestamps.length
    }))
  } satisfies WhatsAppSenderNodeMetricsSnapshot;
}
