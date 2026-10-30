const TRANSIENT_AUTHENTICATION_FAILURE_MARKERS = [
  "timeout",
  "timed out",
  "navigation",
  "protocol error",
  "execution context",
  "target closed",
  "session closed",
  "browser",
  "network",
  "connection closed"
] as const;

export type WhatsAppAuthenticationFailureKind = "temporary-runtime" | "invalid-session";

export function classifyWhatsAppAuthenticationFailure(
  message: unknown
): WhatsAppAuthenticationFailureKind {
  const normalized = String(message ?? "").toLowerCase();
  return TRANSIENT_AUTHENTICATION_FAILURE_MARKERS.some((marker) => normalized.includes(marker))
    ? "temporary-runtime"
    : "invalid-session";
}
