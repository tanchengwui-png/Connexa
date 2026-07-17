import {
  ensurePlatformConfigStore,
  findPlatformConfig,
  upsertPlatformConfig,
  upsertPlatformMetaConfig
} from "@/lib/db-auth";
import {
  DEFAULT_SESSION_TIMEOUT_MINUTES,
  REMEMBER_ME_SESSION_TIMEOUT_MINUTES,
  normalizeSessionTimeoutMinutes
} from "@/lib/session-timeout";

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
  metaAppId?: string;
  metaAppSecret?: string;
  metaConfigId?: string;
  metaGraphVersion?: string;
  metaRedirectUri?: string;
  metaWebhookVerifyToken?: string;
  automationWorkflowIdleHours: number;
  automationWorkflowExpireHours: number;
  freeTrialDurationDays: number;
  expiredAccountCleanupDays: number;
  sessionTimeoutMinutes: number;
  rememberMeTimeoutMinutes: number;
};

const DEFAULT_AUTOMATION_WORKFLOW_IDLE_HOURS = 24;
const DEFAULT_AUTOMATION_WORKFLOW_EXPIRE_HOURS = 72;
const DEFAULT_FREE_TRIAL_DURATION_DAYS = 14;
const DEFAULT_EXPIRED_ACCOUNT_CLEANUP_DAYS = 60;

function getMetaGraphVersionFromEnv() {
  return process.env.META_GRAPH_API_VERSION ?? process.env.META_GRAPH_VERSION ?? "v23.0";
}

function getMetaWebhookVerifyTokenFromEnv() {
  return process.env.META_VERIFY_TOKEN ?? process.env.META_WEBHOOK_VERIFY_TOKEN ?? "";
}

export async function getPlatformConfig() {
  await ensurePlatformConfigStore();
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
    metaAppId: config?.metaAppId ?? process.env.META_APP_ID ?? "",
    metaConfigId: config?.metaConfigId ?? process.env.META_CONFIG_ID ?? "",
    metaGraphVersion: config?.metaGraphVersion ?? getMetaGraphVersionFromEnv(),
    metaRedirectUri: config?.metaRedirectUri ?? process.env.META_REDIRECT_URI ?? "",
    metaAppSecretConfigured: Boolean(config?.metaAppSecret ?? process.env.META_APP_SECRET),
    metaWebhookVerifyTokenConfigured: Boolean(config?.metaWebhookVerifyToken ?? getMetaWebhookVerifyTokenFromEnv()),
    metaEmbeddedSignupConfigured: Boolean(
      (config?.metaAppId ?? process.env.META_APP_ID) &&
        (config?.metaAppSecret ?? process.env.META_APP_SECRET) &&
        (config?.metaConfigId ?? process.env.META_CONFIG_ID) &&
        (config?.metaRedirectUri ?? process.env.META_REDIRECT_URI) &&
        (config?.metaWebhookVerifyToken ?? getMetaWebhookVerifyTokenFromEnv())
    ),
    automationWorkflowIdleHours:
      config?.automationWorkflowIdleHours ?? DEFAULT_AUTOMATION_WORKFLOW_IDLE_HOURS,
    automationWorkflowExpireHours:
      config?.automationWorkflowExpireHours ?? DEFAULT_AUTOMATION_WORKFLOW_EXPIRE_HOURS,
    freeTrialDurationDays:
      config?.freeTrialDurationDays ?? DEFAULT_FREE_TRIAL_DURATION_DAYS,
    expiredAccountCleanupDays:
      config?.expiredAccountCleanupDays ?? DEFAULT_EXPIRED_ACCOUNT_CLEANUP_DAYS,
    sessionTimeoutMinutes: normalizeSessionTimeoutMinutes(config?.sessionTimeoutMinutes),
    rememberMeTimeoutMinutes: normalizeSessionTimeoutMinutes(
      config?.rememberMeTimeoutMinutes,
      REMEMBER_ME_SESSION_TIMEOUT_MINUTES
    ),
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
  const metaAppId = input.metaAppId?.trim() ?? "";
  const metaAppSecret = input.metaAppSecret?.trim() ?? "";
  const metaConfigId = input.metaConfigId?.trim() ?? "";
  const metaGraphVersion = input.metaGraphVersion?.trim() || "v23.0";
  const metaRedirectUri = input.metaRedirectUri?.trim() ?? "";
  const metaWebhookVerifyToken = input.metaWebhookVerifyToken?.trim() ?? "";

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
  const freeTrialDurationDays = clampDays(input.freeTrialDurationDays, DEFAULT_FREE_TRIAL_DURATION_DAYS, 1, 365);
  const expiredAccountCleanupDays = clampDays(
    input.expiredAccountCleanupDays,
    DEFAULT_EXPIRED_ACCOUNT_CLEANUP_DAYS,
    1,
    3650
  );
  const sessionTimeoutMinutes = input.sessionTimeoutMinutes;
  const rememberMeTimeoutMinutes = input.rememberMeTimeoutMinutes;

  if (!Number.isFinite(sessionTimeoutMinutes) || sessionTimeoutMinutes <= 0) {
    throw new Error("Session timeout must be a positive number.");
  }

  if (!Number.isFinite(rememberMeTimeoutMinutes) || rememberMeTimeoutMinutes <= 0) {
    throw new Error("Remember me timeout must be a positive number.");
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
    metaAppId: metaAppId || existing?.metaAppId || null,
    metaAppSecret: metaAppSecret || existing?.metaAppSecret || null,
    metaConfigId: metaConfigId || existing?.metaConfigId || null,
    metaGraphVersion,
    metaRedirectUri: metaRedirectUri || existing?.metaRedirectUri || null,
    metaWebhookVerifyToken: metaWebhookVerifyToken || existing?.metaWebhookVerifyToken || null,
    automationWorkflowIdleHours,
    automationWorkflowExpireHours,
    freeTrialDurationDays,
    expiredAccountCleanupDays,
    sessionTimeoutMinutes: Math.floor(sessionTimeoutMinutes),
    rememberMeTimeoutMinutes: Math.floor(rememberMeTimeoutMinutes)
  });
}

export async function getResolvedPlatformMetaConfig() {
  const config = await getPlatformConfig();

  return {
    appId: config?.metaAppId ?? process.env.META_APP_ID ?? "",
    appSecret: config?.metaAppSecret ?? process.env.META_APP_SECRET ?? "",
    configId: config?.metaConfigId ?? process.env.META_CONFIG_ID ?? "",
    graphVersion: config?.metaGraphVersion ?? getMetaGraphVersionFromEnv(),
    redirectUri: config?.metaRedirectUri ?? process.env.META_REDIRECT_URI ?? "",
    webhookVerifyToken: config?.metaWebhookVerifyToken ?? getMetaWebhookVerifyTokenFromEnv()
  };
}

export async function updatePlatformMetaConfig(input: {
  metaAppId?: string;
  metaAppSecret?: string;
  metaConfigId?: string;
  metaGraphVersion?: string;
  metaRedirectUri?: string;
  metaWebhookVerifyToken?: string;
}) {
  const current = await getPlatformConfig();

  return upsertPlatformMetaConfig({
    metaAppId: input.metaAppId?.trim() || current?.metaAppId || null,
    metaAppSecret: input.metaAppSecret?.trim() || current?.metaAppSecret || null,
    metaConfigId: input.metaConfigId?.trim() || current?.metaConfigId || null,
    metaGraphVersion: input.metaGraphVersion?.trim() || current?.metaGraphVersion || "v23.0",
    metaRedirectUri: input.metaRedirectUri?.trim() || current?.metaRedirectUri || null,
    metaWebhookVerifyToken:
      input.metaWebhookVerifyToken?.trim() || current?.metaWebhookVerifyToken || null
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

export async function getPlatformSubscriptionConfig() {
  const config = await getPlatformConfig();

  return {
    freeTrialDurationDays: clampDays(
      config?.freeTrialDurationDays,
      DEFAULT_FREE_TRIAL_DURATION_DAYS,
      1,
      365
    ),
    expiredAccountCleanupDays: clampDays(
      config?.expiredAccountCleanupDays,
      DEFAULT_EXPIRED_ACCOUNT_CLEANUP_DAYS,
      1,
      3650
    )
  };
}

export async function getPlatformSessionConfig() {
  const config = await getPlatformConfig();

  return {
    sessionTimeoutMinutes: normalizeSessionTimeoutMinutes(
      config?.sessionTimeoutMinutes,
      DEFAULT_SESSION_TIMEOUT_MINUTES
    ),
    rememberMeTimeoutMinutes: normalizeSessionTimeoutMinutes(
      config?.rememberMeTimeoutMinutes,
      REMEMBER_ME_SESSION_TIMEOUT_MINUTES
    )
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

function clampDays(
  value: number | null | undefined,
  fallback: number,
  minimum: number,
  maximum: number
) {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(maximum, Math.max(minimum, Math.round(value as number)));
}
