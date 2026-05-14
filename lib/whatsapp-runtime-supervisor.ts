type RuntimeSupervisorEntry = {
  autoRecoveryAttempts: number[];
  authFailures: number[];
  manualAttentionSince: number | null;
  manualAttentionReason: string | null;
  lastReadyAt: number | null;
  lastDisconnectAt: number | null;
};

export type WhatsAppRuntimeSupervisorStatus = {
  requiresManualAttention: boolean;
  stateLabel: string;
  manualAttentionSince: string | null;
  manualAttentionReason: string | null;
  recentAutoRecoveryCount: number;
  recentAuthFailureCount: number;
  lastReadyAt: string | null;
  lastDisconnectAt: string | null;
};

declare global {
  // eslint-disable-next-line no-var
  var whatsAppRuntimeSupervisor: Map<string, RuntimeSupervisorEntry> | undefined;
}

const supervisorStates =
  global.whatsAppRuntimeSupervisor ?? new Map<string, RuntimeSupervisorEntry>();

const WHATSAPP_AUTO_RECOVERY_WINDOW_MS = Math.max(
  60_000,
  Number.parseInt(process.env.WHATSAPP_AUTO_RECOVERY_WINDOW_MS ?? "900000", 10) || 900000
);

const WHATSAPP_MAX_AUTO_RECOVERIES = Math.max(
  1,
  Number.parseInt(process.env.WHATSAPP_MAX_AUTO_RECOVERIES ?? "3", 10) || 3
);

if (!global.whatsAppRuntimeSupervisor) {
  global.whatsAppRuntimeSupervisor = supervisorStates;
}

function getOrCreateSupervisorEntry(workspaceId: string) {
  const existing = supervisorStates.get(workspaceId);
  if (existing) {
    return existing;
  }

  const created: RuntimeSupervisorEntry = {
    autoRecoveryAttempts: [],
    authFailures: [],
    manualAttentionSince: null,
    manualAttentionReason: null,
    lastReadyAt: null,
    lastDisconnectAt: null
  };
  supervisorStates.set(workspaceId, created);
  return created;
}

function pruneTimestamps(timestamps: number[], now: number) {
  return timestamps.filter((timestamp) => now - timestamp < WHATSAPP_AUTO_RECOVERY_WINDOW_MS);
}

function toIsoString(timestamp: number | null) {
  return timestamp ? new Date(timestamp).toISOString() : null;
}

function buildStatus(entry: RuntimeSupervisorEntry): WhatsAppRuntimeSupervisorStatus {
  const now = Date.now();
  entry.autoRecoveryAttempts = pruneTimestamps(entry.autoRecoveryAttempts, now);
  entry.authFailures = pruneTimestamps(entry.authFailures, now);

  return {
    requiresManualAttention: Boolean(entry.manualAttentionSince && entry.manualAttentionReason),
    stateLabel: entry.manualAttentionSince
      ? "Manual attention required"
      : entry.autoRecoveryAttempts.length > 0
        ? "Recovering automatically"
        : "Healthy",
    manualAttentionSince: toIsoString(entry.manualAttentionSince),
    manualAttentionReason: entry.manualAttentionReason,
    recentAutoRecoveryCount: entry.autoRecoveryAttempts.length,
    recentAuthFailureCount: entry.authFailures.length,
    lastReadyAt: toIsoString(entry.lastReadyAt),
    lastDisconnectAt: toIsoString(entry.lastDisconnectAt)
  };
}

function buildAutoRecoveryPauseReason(attemptCount: number) {
  const minutes = Math.max(1, Math.round(WHATSAPP_AUTO_RECOVERY_WINDOW_MS / 60000));
  return `Automatic recovery paused after ${attemptCount} attempts within ${minutes} minutes. Use the platform reset session action or relink the QR session.`;
}

export function registerAutomaticRecoveryAttempt(input: {
  workspaceId: string;
  reason?: string | null;
}) {
  const now = Date.now();
  const entry = getOrCreateSupervisorEntry(input.workspaceId);
  entry.autoRecoveryAttempts = pruneTimestamps(entry.autoRecoveryAttempts, now);

  if (entry.manualAttentionSince && entry.manualAttentionReason) {
    return {
      allowed: false,
      status: buildStatus(entry)
    };
  }

  entry.autoRecoveryAttempts.push(now);

  if (entry.autoRecoveryAttempts.length > WHATSAPP_MAX_AUTO_RECOVERIES) {
    entry.manualAttentionSince = now;
    entry.manualAttentionReason =
      input.reason?.trim() || buildAutoRecoveryPauseReason(entry.autoRecoveryAttempts.length);

    return {
      allowed: false,
      status: buildStatus(entry)
    };
  }

  return {
    allowed: true,
    status: buildStatus(entry)
  };
}

export function recordRuntimeAuthFailure(workspaceId: string, message?: string | null) {
  const now = Date.now();
  const entry = getOrCreateSupervisorEntry(workspaceId);
  entry.authFailures = pruneTimestamps(entry.authFailures, now);
  entry.authFailures.push(now);
  entry.manualAttentionSince = now;
  entry.manualAttentionReason =
    message?.trim() || "WhatsApp session authentication failed. A fresh QR relink is required.";

  return buildStatus(entry);
}

export function recordRuntimeDisconnected(workspaceId: string) {
  const entry = getOrCreateSupervisorEntry(workspaceId);
  entry.lastDisconnectAt = Date.now();
  return buildStatus(entry);
}

export function recordRuntimeReady(workspaceId: string) {
  const entry = getOrCreateSupervisorEntry(workspaceId);
  entry.autoRecoveryAttempts = [];
  entry.authFailures = [];
  entry.manualAttentionSince = null;
  entry.manualAttentionReason = null;
  entry.lastReadyAt = Date.now();
  return buildStatus(entry);
}

export function clearRuntimeSupervisorState(workspaceId: string) {
  supervisorStates.delete(workspaceId);
}

export function getRuntimeSupervisorStatus(workspaceId: string) {
  const entry = supervisorStates.get(workspaceId);
  if (!entry) {
    return {
      requiresManualAttention: false,
      stateLabel: "Healthy",
      manualAttentionSince: null,
      manualAttentionReason: null,
      recentAutoRecoveryCount: 0,
      recentAuthFailureCount: 0,
      lastReadyAt: null,
      lastDisconnectAt: null
    } satisfies WhatsAppRuntimeSupervisorStatus;
  }

  return buildStatus(entry);
}

export function getRuntimeSupervisorPausedCount() {
  let count = 0;

  for (const workspaceId of supervisorStates.keys()) {
    if (getRuntimeSupervisorStatus(workspaceId).requiresManualAttention) {
      count += 1;
    }
  }

  return count;
}
