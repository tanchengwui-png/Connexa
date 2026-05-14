const WORKSPACE_PLAN_SETTINGS = {
  trial: {
    label: "Trial",
    memberLimit: 5,
    numberLimit: 1
  },
  starter: {
    label: "Starter",
    memberLimit: 5,
    numberLimit: 1
  },
  professional: {
    label: "Professional",
    memberLimit: 10,
    numberLimit: 3
  },
  growth: {
    label: "Growth",
    memberLimit: 15,
    numberLimit: 5
  },
  enterprise: {
    label: "Enterprise",
    memberLimit: null,
    numberLimit: null
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
