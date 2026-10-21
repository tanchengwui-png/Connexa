export type WhatsAppCloudFeatureFlags = {
  cloudEnabled: boolean;
  coexistenceEnabled: boolean;
  billingEnabled: boolean;
  allowedWorkspaceIds: ReadonlySet<string>;
};

function enabled(value: string | undefined) {
  return /^(1|true|yes|on)$/i.test(value?.trim() ?? "");
}

function workspaceIds(value: string | undefined) {
  return new Set(
    (value ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
  );
}

export function getWhatsAppCloudFeatureFlags(
  environment: NodeJS.ProcessEnv = process.env
): WhatsAppCloudFeatureFlags {
  return {
    cloudEnabled: enabled(environment.WHATSAPP_CLOUD_ENABLED),
    coexistenceEnabled: enabled(environment.WHATSAPP_COEXISTENCE_ENABLED),
    billingEnabled: enabled(environment.WHATSAPP_CLOUD_BILLING_ENABLED),
    allowedWorkspaceIds: workspaceIds(environment.WHATSAPP_CLOUD_ALLOWED_WORKSPACE_IDS)
  };
}

export function isWhatsAppCloudEnabledForWorkspace(
  workspaceId: string,
  flags: WhatsAppCloudFeatureFlags = getWhatsAppCloudFeatureFlags()
) {
  if (!flags.cloudEnabled) {
    return false;
  }

  // Cloud is a cohort-only feature until the production rollout has its own
  // reviewed global activation control. An empty allowlist must fail closed so
  // toggling the master flag cannot accidentally enable every tenant.
  return flags.allowedWorkspaceIds.has(workspaceId);
}

export function assertWhatsAppCloudEnabled(workspaceId: string) {
  if (!isWhatsAppCloudEnabledForWorkspace(workspaceId)) {
    throw new Error("WHATSAPP_CLOUD_DISABLED");
  }
}

export function assertWhatsAppCoexistenceEnabled(workspaceId: string) {
  const flags = getWhatsAppCloudFeatureFlags();
  assertWhatsAppCloudEnabled(workspaceId);
  if (!flags.coexistenceEnabled) {
    throw new Error("WHATSAPP_COEXISTENCE_DISABLED");
  }
}
