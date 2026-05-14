import { findPlatformConfig, upsertPlatformConfig } from "@/lib/db-auth";

export type PlatformConfigInput = {
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPass?: string;
  smtpFrom: string;
  supportEmail: string;
  emailBrandName: string;
  emailBrandTagline: string;
  billplzApiKey?: string;
  billplzXSignatureKey?: string;
  billplzCollectionId?: string;
  billplzSandbox: boolean;
  automationWorkflowIdleHours: number;
  automationWorkflowExpireHours: number;
};

const DEFAULT_AUTOMATION_WORKFLOW_IDLE_HOURS = 24;
const DEFAULT_AUTOMATION_WORKFLOW_EXPIRE_HOURS = 72;

export async function getPlatformConfig() {
  return findPlatformConfig();
}

export async function getPlatformConfigForAdmin() {
  const config = await getPlatformConfig();

  return {
    smtpHost: config?.smtpHost ?? process.env.SMTP_HOST ?? "",
    smtpPort: config?.smtpPort ?? Number(process.env.SMTP_PORT ?? "587"),
    smtpSecure: config?.smtpSecure ?? process.env.SMTP_SECURE === "true",
    smtpUser: config?.smtpUser ?? process.env.SMTP_USER ?? "",
    smtpFrom: config?.smtpFrom ?? process.env.SMTP_FROM ?? "",
    supportEmail: config?.supportEmail ?? process.env.SUPPORT_EMAIL ?? process.env.SMTP_FROM ?? "",
    emailBrandName: config?.emailBrandName ?? process.env.EMAIL_BRAND_NAME ?? "Connexa",
    emailBrandTagline:
      config?.emailBrandTagline ??
      process.env.EMAIL_BRAND_TAGLINE ??
      "Shared workspace communication for modern teams.",
    billplzApiKey: "",
    billplzXSignatureKey: "",
    billplzCollectionId: config?.billplzCollectionId ?? process.env.BILLPLZ_COLLECTION_ID ?? "",
    billplzSandbox: config?.billplzSandbox ?? process.env.BILLPLZ_SANDBOX === "true",
    automationWorkflowIdleHours:
      config?.automationWorkflowIdleHours ?? DEFAULT_AUTOMATION_WORKFLOW_IDLE_HOURS,
    automationWorkflowExpireHours:
      config?.automationWorkflowExpireHours ?? DEFAULT_AUTOMATION_WORKFLOW_EXPIRE_HOURS,
    billplzApiKeyConfigured: Boolean(config?.billplzApiKey ?? process.env.BILLPLZ_API_KEY),
    billplzXSignatureKeyConfigured: Boolean(
      config?.billplzXSignatureKey ?? process.env.BILLPLZ_X_SIGNATURE_KEY
    ),
    billplzConfigured: Boolean(
      (config?.billplzApiKey ?? process.env.BILLPLZ_API_KEY) &&
        (config?.billplzCollectionId ?? process.env.BILLPLZ_COLLECTION_ID)
    ),
    smtpPassConfigured: Boolean(config?.smtpPass ?? process.env.SMTP_PASS)
  };
}

export async function updatePlatformConfig(input: PlatformConfigInput) {
  const smtpHost = input.smtpHost.trim();
  const smtpUser = input.smtpUser.trim();
  const smtpFrom = input.smtpFrom.trim();
  const supportEmail = input.supportEmail.trim();
  const emailBrandName = input.emailBrandName.trim();
  const emailBrandTagline = input.emailBrandTagline.trim();
  const billplzApiKey = input.billplzApiKey?.trim() ?? "";
  const billplzXSignatureKey = input.billplzXSignatureKey?.trim() ?? "";
  const billplzCollectionId = input.billplzCollectionId?.trim() ?? "";

  if (!smtpHost || !smtpUser || !smtpFrom || !supportEmail || !emailBrandName || !emailBrandTagline) {
    throw new Error("All SMTP settings are required.");
  }

  if (!Number.isFinite(input.smtpPort) || input.smtpPort <= 0) {
    throw new Error("SMTP port must be a valid number.");
  }

  const automationWorkflowIdleHours = clampWorkflowTimeoutHours(
    input.automationWorkflowIdleHours,
    DEFAULT_AUTOMATION_WORKFLOW_IDLE_HOURS
  );
  const automationWorkflowExpireHours = clampWorkflowTimeoutHours(
    input.automationWorkflowExpireHours,
    DEFAULT_AUTOMATION_WORKFLOW_EXPIRE_HOURS
  );

  if (automationWorkflowExpireHours <= automationWorkflowIdleHours) {
    throw new Error("Workflow expire hours must be greater than workflow idle hours.");
  }

  const existing = await getPlatformConfig();

  return upsertPlatformConfig({
    smtpHost,
    smtpPort: input.smtpPort,
    smtpSecure: input.smtpSecure,
    smtpUser,
    smtpPass: input.smtpPass && input.smtpPass.trim() ? input.smtpPass : existing?.smtpPass ?? null,
    smtpFrom,
    supportEmail,
    emailBrandName,
    emailBrandTagline,
    billplzApiKey: billplzApiKey || existing?.billplzApiKey || null,
    billplzXSignatureKey: billplzXSignatureKey || existing?.billplzXSignatureKey || null,
    billplzCollectionId: billplzCollectionId || existing?.billplzCollectionId || null,
    billplzSandbox: input.billplzSandbox,
    automationWorkflowIdleHours,
    automationWorkflowExpireHours
  });
}

export async function getPlatformAutomationWorkflowConfig() {
  const config = await getPlatformConfig();

  const idleAfterHours = clampWorkflowTimeoutHours(
    config?.automationWorkflowIdleHours,
    DEFAULT_AUTOMATION_WORKFLOW_IDLE_HOURS
  );
  const expireAfterHours = Math.max(
    idleAfterHours + 1,
    clampWorkflowTimeoutHours(
      config?.automationWorkflowExpireHours,
      DEFAULT_AUTOMATION_WORKFLOW_EXPIRE_HOURS
    )
  );

  return {
    idleAfterHours,
    expireAfterHours
  };
}

export async function getResolvedPlatformEmailConfig() {
  const config = await getPlatformConfig();

  return {
    smtpHost: config?.smtpHost ?? process.env.SMTP_HOST ?? "",
    smtpPort: config?.smtpPort ?? Number(process.env.SMTP_PORT ?? "587"),
    smtpSecure: config?.smtpSecure ?? process.env.SMTP_SECURE === "true",
    smtpUser: config?.smtpUser ?? process.env.SMTP_USER ?? "",
    smtpPass: config?.smtpPass ?? process.env.SMTP_PASS ?? "",
    smtpFrom: config?.smtpFrom ?? process.env.SMTP_FROM ?? "",
    supportEmail: config?.supportEmail ?? process.env.SUPPORT_EMAIL ?? process.env.SMTP_FROM ?? "",
    emailBrandName: config?.emailBrandName ?? process.env.EMAIL_BRAND_NAME ?? "Connexa",
    emailBrandTagline:
      config?.emailBrandTagline ??
      process.env.EMAIL_BRAND_TAGLINE ??
      "Shared workspace communication for modern teams.",
    billplzApiKey: config?.billplzApiKey ?? process.env.BILLPLZ_API_KEY ?? "",
    billplzXSignatureKey: config?.billplzXSignatureKey ?? process.env.BILLPLZ_X_SIGNATURE_KEY ?? "",
    billplzCollectionId: config?.billplzCollectionId ?? process.env.BILLPLZ_COLLECTION_ID ?? "",
    billplzSandbox: config?.billplzSandbox ?? process.env.BILLPLZ_SANDBOX === "true"
  };
}

function clampWorkflowTimeoutHours(value: number | null | undefined, fallback: number) {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(24 * 30, Math.max(1, Math.round(value as number)));
}
