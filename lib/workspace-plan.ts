const WORKSPACE_PLAN_SETTINGS = {
  trial: {
    label: "Trial",
    memberLimit: 5
  },
  starter: {
    label: "Starter",
    memberLimit: 5
  },
  growth: {
    label: "Growth",
    memberLimit: 15
  },
  enterprise: {
    label: "Enterprise",
    memberLimit: null
  }
} as const;

export type WorkspacePlanKey = keyof typeof WORKSPACE_PLAN_SETTINGS;

export function normalizeWorkspacePlan(plan: string | null | undefined): WorkspacePlanKey {
  const normalizedPlan = plan?.trim().toLowerCase();

  if (normalizedPlan && normalizedPlan in WORKSPACE_PLAN_SETTINGS) {
    return normalizedPlan as WorkspacePlanKey;
  }

  return "starter";
}

export function getWorkspacePlanSettings(plan: string | null | undefined) {
  return WORKSPACE_PLAN_SETTINGS[normalizeWorkspacePlan(plan)];
}
