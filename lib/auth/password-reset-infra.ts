import { getResolvedPlatformEmailConfig } from "@/lib/platform-config";

export const PASSWORD_RESET_EMAIL_UNAVAILABLE_MESSAGE =
  "Password reset email is unavailable because email reset-link infrastructure is not configured.";

export function getPasswordResetBaseUrl() {
  const value = process.env.APP_URL?.trim() || process.env.NEXT_PUBLIC_APP_URL?.trim() || "";
  return value || null;
}

export async function getPasswordResetEmailAvailability() {
  const emailConfig = await getResolvedPlatformEmailConfig();
  const baseUrl = getPasswordResetBaseUrl();
  const enabled = Boolean(
    emailConfig.smtpHost &&
      emailConfig.smtpUser &&
      emailConfig.smtpPass &&
      emailConfig.smtpFrom &&
      baseUrl
  );

  return {
    enabled,
    helperText: enabled ? null : PASSWORD_RESET_EMAIL_UNAVAILABLE_MESSAGE
  };
}
