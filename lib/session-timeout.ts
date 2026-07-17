export const DEFAULT_SESSION_TIMEOUT_MINUTES = 60;
export const REMEMBER_ME_SESSION_TIMEOUT_MINUTES = 60 * 24 * 30;

export type SessionTimeoutUnit = "minutes" | "hours" | "days";

export function normalizeSessionTimeoutMinutes(
  value: number | null | undefined,
  fallback = DEFAULT_SESSION_TIMEOUT_MINUTES
) {
  if (!Number.isFinite(value) || !value || value <= 0) {
    return fallback;
  }

  return Math.max(1, Math.floor(value));
}

export function resolveSessionLifetimeMinutes(options: {
  remember: boolean;
  sessionTimeoutMinutes: number | null | undefined;
}) {
  // Preserve the existing extended remember-me behavior while making standard sessions configurable.
  if (options.remember) {
    return REMEMBER_ME_SESSION_TIMEOUT_MINUTES;
  }

  return normalizeSessionTimeoutMinutes(options.sessionTimeoutMinutes);
}

export function buildSessionExpiryDate(options: {
  now?: Date;
  remember: boolean;
  sessionTimeoutMinutes: number | null | undefined;
}) {
  const now = options.now ?? new Date();
  const lifetimeMinutes = resolveSessionLifetimeMinutes(options);
  return new Date(now.getTime() + lifetimeMinutes * 60 * 1000);
}

export function splitSessionTimeoutForDisplay(
  minutes: number | null | undefined
): { value: number; unit: SessionTimeoutUnit } {
  const normalizedMinutes = normalizeSessionTimeoutMinutes(minutes);

  if (normalizedMinutes % (60 * 24) === 0) {
    return {
      value: normalizedMinutes / (60 * 24),
      unit: "days"
    };
  }

  if (normalizedMinutes % 60 === 0) {
    return {
      value: normalizedMinutes / 60,
      unit: "hours"
    };
  }

  return {
    value: normalizedMinutes,
    unit: "minutes"
  };
}

export function convertSessionTimeoutToMinutes(value: number, unit: SessionTimeoutUnit) {
  const normalizedValue = Math.max(1, Math.floor(value));

  if (unit === "days") {
    return normalizedValue * 60 * 24;
  }

  return unit === "hours" ? normalizedValue * 60 : normalizedValue;
}

export function getSessionExpiryMessage(reason?: string | string[] | null) {
  const normalizedReason = Array.isArray(reason) ? reason[0] : reason;

  if (normalizedReason === "session-expired") {
    return "Your session has expired. Please log in again.";
  }

  return null;
}
