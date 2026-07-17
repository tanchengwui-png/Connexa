const DISCONNECTED_RUNTIME_STATUSES = new Set(["DISCONNECTED", "AUTH_FAILED"]);
const CONNECTED_RUNTIME_STATUSES = new Set(["READY", "SYNCING_HISTORY", "CONNECTED"]);
const PREPARING_RUNTIME_STATUSES = new Set(["INITIALIZING", "AUTHENTICATED", "QR_READY"]);

export function isWhatsAppDisconnectedRuntimeStatus(runtimeStatus: string | null | undefined) {
  return DISCONNECTED_RUNTIME_STATUSES.has(runtimeStatus ?? "");
}

export function isWhatsAppConnectedRuntimeStatus(runtimeStatus: string | null | undefined) {
  return CONNECTED_RUNTIME_STATUSES.has(runtimeStatus ?? "");
}

export function isWhatsAppPreparingRuntimeStatus(runtimeStatus: string | null | undefined) {
  return PREPARING_RUNTIME_STATUSES.has(runtimeStatus ?? "");
}
