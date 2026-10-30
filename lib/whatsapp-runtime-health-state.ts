export type WhatsAppRuntimeDesiredState = "RUNNING" | "STOPPED";
export type WhatsAppRuntimeHealthStatus =
  | "UNKNOWN"
  | "HEALTHY"
  | "RECOVERING"
  | "REAUTH_REQUIRED"
  | "STOPPED";

export type WhatsAppUserConnectionState =
  | "connected"
  | "recovering"
  | "reconnection_required"
  | "disconnected"
  | "unknown";

export const WHATSAPP_HEALTHY_STATES = new Set(["CONNECTED"]);
export const WHATSAPP_REAUTH_STATES = new Set(["UNPAIRED", "UNPAIRED_IDLE"]);

export function calculateWhatsAppRecoveryDelayMs(
  attempt: number,
  baseMs = 5_000,
  maxMs = 5 * 60_000,
  jitterRatio = 0,
  random = Math.random
) {
  const cappedDelay = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
  const boundedJitter = Math.min(0.5, Math.max(0, jitterRatio));
  const jitterMultiplier = 1 - boundedJitter + random() * boundedJitter * 2;
  return Math.max(baseMs, Math.min(maxMs, Math.round(cappedDelay * jitterMultiplier)));
}

export function classifyWhatsAppWebState(value: unknown):
  | "healthy"
  | "transient"
  | "reauth-required" {
  const state = String(value ?? "").trim().toUpperCase();
  if (WHATSAPP_HEALTHY_STATES.has(state)) return "healthy";
  if (WHATSAPP_REAUTH_STATES.has(state)) return "reauth-required";
  return "transient";
}

export function resolveWhatsAppUserConnectionState(input: {
  senderReachable: boolean;
  runtimePresent: boolean;
  runtimeStatus?: string | null;
  healthStatus?: string | null;
  lastHealthyAt?: Date | string | null;
  now?: number;
  healthyMaxAgeMs?: number;
}): WhatsAppUserConnectionState {
  if (!input.senderReachable) return "unknown";
  if (input.healthStatus === "REAUTH_REQUIRED") return "reconnection_required";

  const healthyAt = input.lastHealthyAt ? new Date(input.lastHealthyAt).getTime() : Number.NaN;
  const healthyMaxAgeMs = input.healthyMaxAgeMs ?? 150_000;
  const recentlyVerified =
    Number.isFinite(healthyAt) && (input.now ?? Date.now()) - healthyAt <= healthyMaxAgeMs;

  if (
    input.runtimePresent &&
    input.healthStatus === "HEALTHY" &&
    recentlyVerified &&
    ["CONNECTED", "READY", "SYNCING_HISTORY"].includes(input.runtimeStatus ?? "")
  ) {
    return "connected";
  }

  if (input.healthStatus === "STOPPED") return "disconnected";
  if (input.healthStatus === "RECOVERING" || input.runtimePresent) return "recovering";
  return "unknown";
}
