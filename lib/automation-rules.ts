import {
  AutomationJobStatus,
  AutomationMatchType,
  AutomationTriggerType
} from "@prisma/client";
import { requireCurrentWorkspaceId } from "@/lib/auth/current-user";
import { prisma as db } from "@/lib/prisma";

const triggerLabels: Record<AutomationTriggerType, string> = {
  WELCOME_MESSAGE: "Welcome message",
  KEYWORD_MATCH: "Keyword rule",
  FOLLOW_UP: "Follow-up rule"
};

const matchLabels: Record<AutomationMatchType, string> = {
  EXACT: "Exact",
  CONTAINS: "Contains",
  REGEX: "Regex"
};

const DEFAULT_BUSINESS_HOURS = [
  { day: 1, enabled: true, start: "09:00", end: "18:00", label: "Mon" },
  { day: 2, enabled: true, start: "09:00", end: "18:00", label: "Tue" },
  { day: 3, enabled: true, start: "09:00", end: "18:00", label: "Wed" },
  { day: 4, enabled: true, start: "09:00", end: "18:00", label: "Thu" },
  { day: 5, enabled: true, start: "09:00", end: "18:00", label: "Fri" },
  { day: 6, enabled: false, start: "09:00", end: "13:00", label: "Sat" },
  { day: 0, enabled: false, start: "00:00", end: "00:00", label: "Sun" }
];

export async function getAutomationRulesData() {
  const workspaceId = await requireCurrentWorkspaceId();
  const [workspace, settings, jobs, workflows] = await Promise.all([
    db.workspace.findUnique({
      where: { id: workspaceId },
      include: {
        automationRules: {
          orderBy: [{ priority: "asc" }, { createdAt: "asc" }]
        }
      }
    }),
    db.workspaceAutomationSettings.findUnique({
      where: { workspaceId }
    }),
    db.automationJob.findMany({
      where: {
        workspaceId,
        status: {
          in: [AutomationJobStatus.PENDING, AutomationJobStatus.BLOCKED, AutomationJobStatus.FAILED]
        }
      },
      include: {
        conversation: {
          include: {
            contact: true
          }
        },
        rule: true
      },
      orderBy: [{ runAt: "asc" }],
      take: 20
    }),
    listAutomationWorkflows(workspaceId)
  ]);

  if (!workspace) {
    throw new Error("No workspace found. Run the database seed first.");
  }

  return {
    summary: {
      total: workspace.automationRules.length,
      enabled: workspace.automationRules.filter((rule) => rule.enabled).length,
      keywordRules: workspace.automationRules.filter((rule) => rule.triggerType === AutomationTriggerType.KEYWORD_MATCH).length,
      queuedJobs: jobs.filter((job) => job.status === AutomationJobStatus.PENDING).length
    },
    settings: {
      timezone: settings?.timezone ?? "Asia/Kuala_Lumpur",
      businessHoursEnabled: settings?.businessHoursEnabled ?? false,
      businessHours: parseBusinessHours(settings?.businessHoursJson),
      awayReplyEnabled: settings?.awayReplyEnabled ?? false,
      awayReplyBody:
        settings?.awayReplyBody ??
        "Thanks for your message. We are currently offline and will reply during business hours.",
      awayReplyCooldownMinutes: settings?.awayReplyCooldownMinutes ?? 720,
      humanTakeoverPauseMinutes: settings?.humanTakeoverPauseMinutes ?? 240,
      regexEnabled: settings?.regexEnabled ?? false,
      decisionFlowEnabled: settings?.decisionFlowEnabled ?? false,
      decisionFlowQuestion:
        settings?.decisionFlowQuestion ?? "Are you interested in this offer? Reply yes or no.",
      decisionFlowYesKeywords: settings?.decisionFlowYesKeywords ?? "yes, y, interested, ok, sure",
      decisionFlowNoKeywords: settings?.decisionFlowNoKeywords ?? "no, n, not interested, later",
      decisionFlowYesReply:
        settings?.decisionFlowYesReply ?? "Great. We’ll continue with the next step shortly.",
      decisionFlowNoReply:
        settings?.decisionFlowNoReply ?? "Understood. We’ll pause here. Message us anytime if you change your mind.",
      decisionFlowFallbackReply:
        settings?.decisionFlowFallbackReply ?? "Please reply yes or no so we can route you correctly.",
      decisionFlowYesTags: parseStringArray(settings?.decisionFlowYesTags ?? null),
      decisionFlowNoTags: parseStringArray(settings?.decisionFlowNoTags ?? null),
      workflowFlowEnabled: settings?.workflowFlowEnabled ?? false,
      activeWorkflowId: settings?.activeWorkflowId ?? workflows[0]?.id ?? null,
      propertyFlowEnabled: settings?.propertyFlowEnabled ?? false,
      propertyFlowPromptPurpose:
        settings?.propertyFlowPromptPurpose ??
        "Hi. Thanks for contacting us. Are you looking to buy, rent, or sell a property?",
      propertyFlowPromptArea:
        settings?.propertyFlowPromptArea ?? "Thanks. Which area are you interested in?",
      propertyFlowPromptBudget:
        settings?.propertyFlowPromptBudget ?? "Got it. What is your target budget?",
      propertyFlowCompleteReply:
        settings?.propertyFlowCompleteReply ??
        "Thanks. I’ve captured your property requirements and the team will follow up shortly."
    },
    rules: workspace.automationRules.map((rule) => ({
      id: rule.id,
      name: rule.name,
      triggerType: rule.triggerType,
      triggerLabel: triggerLabels[rule.triggerType],
      matchType: rule.matchType,
      matchLabel: matchLabels[rule.matchType],
      keyword: rule.keyword,
      replyBody: rule.replyBody,
      addTags: parseStringArray(rule.addTags),
      priority: rule.priority,
      cooldownMinutes: rule.cooldownMinutes,
      stopAfterMatch: rule.stopAfterMatch,
      businessHoursOnly: rule.businessHoursOnly,
      followUpDelayMinutes: rule.followUpDelayMinutes,
      followUpReplyBody: rule.followUpReplyBody,
      enabled: rule.enabled
    })),
    jobs: jobs.map((job) => ({
      id: job.id,
      status: job.status,
      runAtIso: job.runAt.toISOString(),
      runAtLabel: formatJobTime(job.runAt),
      conversationId: job.conversationId,
      contactName: job.conversation.contact.displayName,
      ruleName: job.rule?.name ?? "Automation job",
      lastError: job.lastError,
      bodyPreview: parseJobPayload(job.payloadJson).body ?? ""
    })),
    workflows: workflows.map((workflow) => ({
      id: workflow.id,
      name: workflow.name,
      definitionJson: workflow.definitionJson,
      isActive: (settings?.activeWorkflowId ?? workflows[0]?.id ?? null) === workflow.id,
      updatedAtIso: workflow.updatedAt.toISOString()
    }))
  };
}

export async function createAutomationRule(input: AutomationRuleInput) {
  const workspaceId = await requireCurrentWorkspaceId();
  const payload = normalizeRuleInput(input);
  return db.automationRule.create({
    data: {
      workspaceId,
      ...payload
    }
  });
}

export async function updateAutomationRule(id: string, updates: Partial<AutomationRuleInput> & { enabled?: boolean }) {
  const workspaceId = await requireCurrentWorkspaceId();
  const rule = await db.automationRule.findFirst({
    where: { id, workspaceId }
  });

  if (!rule) {
    throw new Error("Automation rule not found.");
  }

  const payload = normalizeRuleInput(
    {
      name: updates.name ?? rule.name,
      triggerType: updates.triggerType ?? rule.triggerType,
      matchType: updates.matchType ?? rule.matchType,
      keyword: updates.keyword ?? rule.keyword ?? "",
      replyBody: updates.replyBody ?? rule.replyBody,
      addTags: updates.addTags ?? parseStringArray(rule.addTags),
      priority: updates.priority ?? rule.priority,
      cooldownMinutes: updates.cooldownMinutes ?? rule.cooldownMinutes,
      stopAfterMatch: updates.stopAfterMatch ?? rule.stopAfterMatch,
      businessHoursOnly: updates.businessHoursOnly ?? rule.businessHoursOnly,
      followUpDelayMinutes: updates.followUpDelayMinutes ?? rule.followUpDelayMinutes,
      followUpReplyBody: updates.followUpReplyBody ?? rule.followUpReplyBody,
      enabled: updates.enabled ?? rule.enabled
    },
    updates.enabled ?? rule.enabled
  );

  return db.automationRule.update({
    where: { id: rule.id },
    data: payload
  });
}

export async function deleteAutomationRule(id: string) {
  const workspaceId = await requireCurrentWorkspaceId();
  const rule = await db.automationRule.findFirst({
    where: { id, workspaceId },
    select: { id: true }
  });

  if (!rule) {
    throw new Error("Automation rule not found.");
  }

  return db.automationRule.delete({
    where: { id: rule.id }
  });
}

export async function updateAutomationSettings(input: AutomationSettingsInput) {
  const workspaceId = await requireCurrentWorkspaceId();
  return db.workspaceAutomationSettings.upsert({
    where: { workspaceId },
    create: {
      workspaceId,
      timezone: input.timezone.trim(),
      businessHoursEnabled: input.businessHoursEnabled,
      businessHoursJson: JSON.stringify(input.businessHours),
      awayReplyEnabled: input.awayReplyEnabled,
      awayReplyBody: normalizeOptionalString(input.awayReplyBody),
      awayReplyCooldownMinutes: input.awayReplyCooldownMinutes,
      humanTakeoverPauseMinutes: input.humanTakeoverPauseMinutes,
      regexEnabled: input.regexEnabled,
      decisionFlowEnabled: input.decisionFlowEnabled,
      decisionFlowQuestion: normalizeOptionalString(input.decisionFlowQuestion),
      decisionFlowYesKeywords: normalizeOptionalString(input.decisionFlowYesKeywords),
      decisionFlowNoKeywords: normalizeOptionalString(input.decisionFlowNoKeywords),
      decisionFlowYesReply: normalizeOptionalString(input.decisionFlowYesReply),
      decisionFlowNoReply: normalizeOptionalString(input.decisionFlowNoReply),
      decisionFlowFallbackReply: normalizeOptionalString(input.decisionFlowFallbackReply),
      decisionFlowYesTags: normalizeOptionalCsv(input.decisionFlowYesTags),
      decisionFlowNoTags: normalizeOptionalCsv(input.decisionFlowNoTags),
      workflowFlowEnabled: input.workflowFlowEnabled,
      activeWorkflowId: input.activeWorkflowId,
      propertyFlowEnabled: input.propertyFlowEnabled,
      propertyFlowPromptPurpose: normalizeOptionalString(input.propertyFlowPromptPurpose),
      propertyFlowPromptArea: normalizeOptionalString(input.propertyFlowPromptArea),
      propertyFlowPromptBudget: normalizeOptionalString(input.propertyFlowPromptBudget),
      propertyFlowCompleteReply: normalizeOptionalString(input.propertyFlowCompleteReply)
    },
    update: {
      timezone: input.timezone.trim(),
      businessHoursEnabled: input.businessHoursEnabled,
      businessHoursJson: JSON.stringify(input.businessHours),
      awayReplyEnabled: input.awayReplyEnabled,
      awayReplyBody: normalizeOptionalString(input.awayReplyBody),
      awayReplyCooldownMinutes: input.awayReplyCooldownMinutes,
      humanTakeoverPauseMinutes: input.humanTakeoverPauseMinutes,
      regexEnabled: input.regexEnabled,
      decisionFlowEnabled: input.decisionFlowEnabled,
      decisionFlowQuestion: normalizeOptionalString(input.decisionFlowQuestion),
      decisionFlowYesKeywords: normalizeOptionalString(input.decisionFlowYesKeywords),
      decisionFlowNoKeywords: normalizeOptionalString(input.decisionFlowNoKeywords),
      decisionFlowYesReply: normalizeOptionalString(input.decisionFlowYesReply),
      decisionFlowNoReply: normalizeOptionalString(input.decisionFlowNoReply),
      decisionFlowFallbackReply: normalizeOptionalString(input.decisionFlowFallbackReply),
      decisionFlowYesTags: normalizeOptionalCsv(input.decisionFlowYesTags),
      decisionFlowNoTags: normalizeOptionalCsv(input.decisionFlowNoTags),
      workflowFlowEnabled: input.workflowFlowEnabled,
      activeWorkflowId: input.activeWorkflowId,
      propertyFlowEnabled: input.propertyFlowEnabled,
      propertyFlowPromptPurpose: normalizeOptionalString(input.propertyFlowPromptPurpose),
      propertyFlowPromptArea: normalizeOptionalString(input.propertyFlowPromptArea),
      propertyFlowPromptBudget: normalizeOptionalString(input.propertyFlowPromptBudget),
      propertyFlowCompleteReply: normalizeOptionalString(input.propertyFlowCompleteReply)
    }
  });
}

export type AutomationRuleInput = {
  name: string;
  triggerType: AutomationTriggerType;
  matchType: AutomationMatchType;
  keyword?: string;
  replyBody: string;
  addTags?: string[];
  priority: number;
  cooldownMinutes: number;
  stopAfterMatch?: boolean;
  businessHoursOnly?: boolean;
  followUpDelayMinutes?: number | null;
  followUpReplyBody?: string | null;
  enabled?: boolean;
};

export type AutomationSettingsInput = {
  timezone: string;
  businessHoursEnabled: boolean;
  businessHours: Array<{ day: number; enabled: boolean; start: string; end: string; label?: string }>;
  awayReplyEnabled: boolean;
  awayReplyBody: string;
  awayReplyCooldownMinutes: number;
  humanTakeoverPauseMinutes: number;
  regexEnabled: boolean;
  decisionFlowEnabled: boolean;
  decisionFlowQuestion: string;
  decisionFlowYesKeywords: string;
  decisionFlowNoKeywords: string;
  decisionFlowYesReply: string;
  decisionFlowNoReply: string;
  decisionFlowFallbackReply: string;
  decisionFlowYesTags: string[];
  decisionFlowNoTags: string[];
  workflowFlowEnabled: boolean;
  activeWorkflowId: string | null;
  propertyFlowEnabled: boolean;
  propertyFlowPromptPurpose: string;
  propertyFlowPromptArea: string;
  propertyFlowPromptBudget: string;
  propertyFlowCompleteReply: string;
};

function normalizeRuleInput(input: AutomationRuleInput, forcedEnabled?: boolean) {
  const name = input.name.trim();
  const replyBody = input.replyBody.trim();
  const keyword = input.keyword?.trim() || null;
  const followUpReplyBody = input.followUpReplyBody?.trim() || null;
  const addTags = Array.from(new Set((input.addTags ?? []).map((tag) => tag.trim()).filter(Boolean)));

  if (!name) {
    throw new Error("Rule name is required.");
  }

  if (input.triggerType === AutomationTriggerType.KEYWORD_MATCH && !keyword) {
    throw new Error("Keyword is required for keyword rules.");
  }

  if (input.matchType === AutomationMatchType.REGEX && !keyword) {
    throw new Error("Regex pattern is required.");
  }

  if (!replyBody) {
    throw new Error("Reply body is required.");
  }

  const priority = clampInteger(input.priority, 1, 999, 100);
  const cooldownMinutes = clampInteger(input.cooldownMinutes, 0, 10080, 360);
  const followUpDelayMinutes =
    input.followUpDelayMinutes && input.followUpDelayMinutes > 0
      ? clampInteger(input.followUpDelayMinutes, 5, 43200, input.followUpDelayMinutes)
      : null;

  return {
    name,
    triggerType: input.triggerType,
    matchType: input.matchType,
    keyword,
    replyBody,
    addTags: addTags.length ? JSON.stringify(addTags) : null,
    priority,
    cooldownMinutes,
    stopAfterMatch: Boolean(input.stopAfterMatch),
    businessHoursOnly: Boolean(input.businessHoursOnly),
    followUpDelayMinutes,
    followUpReplyBody,
    enabled: forcedEnabled ?? input.enabled ?? true
  };
}

function clampInteger(value: number, min: number, max: number, fallback: number) {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.round(value)));
}

function normalizeOptionalString(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeOptionalCsv(values?: string[] | null) {
  const normalized = Array.from(new Set((values ?? []).map((value) => value.trim()).filter(Boolean)));
  return normalized.length ? normalized.join(", ") : null;
}

function buildEmptyWorkflowDefinitionJson() {
  return JSON.stringify(
    {
      startStepId: "workflow-end",
      steps: [
        {
          id: "workflow-end",
          type: "end",
          title: "End",
          reply: ""
        }
      ]
    },
    null,
    2
  );
}

function buildDefaultWorkflowDefinitionJson() {
  return JSON.stringify(
    {
      startStepId: "interest-check",
      steps: [
        {
          id: "interest-check",
          type: "question",
          title: "Interest Check",
          prompt: "Are you interested in this offer? Reply yes or no.",
          branches: [
            {
              id: "yes-branch",
              label: "Yes",
              keywords: ["yes", "y", "interested", "ok", "sure"],
              reply: "Great. Which area are you interested in?",
              nextStepId: "area-question",
              tags: ["interested"]
            },
            {
              id: "no-branch",
              label: "No",
              keywords: ["no", "n", "later", "not interested"],
              reply: "Understood. We’ll pause here. Message us anytime if you change your mind.",
              nextStepId: "end-cold",
              tags: ["not-interested"]
            }
          ],
          fallbackReply: "Please reply yes or no so we can route you correctly.",
          fallbackNextStepId: null
        },
        {
          id: "area-question",
          type: "question",
          title: "Area Question",
          prompt: "Which area are you interested in?",
          branches: [
            {
              id: "area-any",
              label: "Any answer",
              keywords: ["*"],
              reply: "Thanks. Our team will follow up with matching options shortly.",
              nextStepId: "end-qualified",
              tags: ["area-captured"]
            }
          ],
          fallbackReply: null,
          fallbackNextStepId: "end-qualified"
        },
        {
          id: "end-qualified",
          type: "end",
          title: "Qualified End",
          reply: "",
          tags: ["qualified"]
        },
        {
          id: "end-cold",
          type: "end",
          title: "Cold End",
          reply: "",
          tags: []
        }
      ]
    },
    null,
    2
  );
}

export async function createAutomationWorkflow(input: { name: string }) {
  const workspaceId = await requireCurrentWorkspaceId();
  const existing = await listAutomationWorkflows(workspaceId);
  const name = input.name.trim() || `Workflow ${existing.length + 1}`;
  const workflow = await db.automationWorkflow.create({
    data: {
      workspaceId,
      name,
      definitionJson: buildEmptyWorkflowDefinitionJson()
    }
  });

  if (!existing.length) {
    await db.workspaceAutomationSettings.upsert({
      where: { workspaceId },
      create: {
        workspaceId,
        timezone: "Asia/Kuala_Lumpur",
        workflowFlowEnabled: true,
        activeWorkflowId: workflow.id
      },
      update: {
        workflowFlowEnabled: true,
        activeWorkflowId: workflow.id
      }
    });
  }

  return workflow;
}

export async function updateAutomationWorkflow(id: string, input: { name?: string; definitionJson?: string; isActive?: boolean }) {
  const workspaceId = await requireCurrentWorkspaceId();
  const workflow = await db.automationWorkflow.findFirst({
    where: { id, workspaceId }
  });

  if (!workflow) {
    throw new Error("Workflow not found.");
  }

  const data: { name?: string; definitionJson?: string } = {};
  if (typeof input.name === "string") {
    const nextName = input.name.trim();
    if (!nextName) {
      throw new Error("Workflow name is required.");
    }
    data.name = nextName;
  }
  if (typeof input.definitionJson === "string") {
    data.definitionJson = normalizeWorkflowDefinitionJson(input.definitionJson);
  }

  const updated = await db.automationWorkflow.update({
    where: { id: workflow.id },
    data
  });

  if (input.isActive) {
    await db.workspaceAutomationSettings.upsert({
      where: { workspaceId },
      create: {
        workspaceId,
        timezone: "Asia/Kuala_Lumpur",
        workflowFlowEnabled: true,
        activeWorkflowId: workflow.id
      },
      update: {
        workflowFlowEnabled: true,
        activeWorkflowId: workflow.id
      }
    });
  }

  return updated;
}

export async function deleteAutomationWorkflow(id: string) {
  const workspaceId = await requireCurrentWorkspaceId();
  const workflow = await db.automationWorkflow.findFirst({
    where: { id, workspaceId }
  });
  if (!workflow) {
    throw new Error("Workflow not found.");
  }

  const remaining = await db.automationWorkflow.findMany({
    where: { workspaceId, id: { not: workflow.id } },
    orderBy: [{ updatedAt: "desc" }]
  });

  await db.automationWorkflow.delete({
    where: { id: workflow.id }
  });

  if (!remaining.length) {
    await db.workspaceAutomationSettings.upsert({
      where: { workspaceId },
      create: {
        workspaceId,
        timezone: "Asia/Kuala_Lumpur",
        activeWorkflowId: null
      },
      update: {
        activeWorkflowId: null
      }
    });
    return null;
  }

  const settings = await db.workspaceAutomationSettings.findUnique({
    where: { workspaceId }
  });
  if (settings?.activeWorkflowId === workflow.id) {
    await db.workspaceAutomationSettings.update({
      where: { workspaceId },
      data: {
        activeWorkflowId: remaining[0].id
      }
    });
  }

  return remaining[0];
}

async function listAutomationWorkflows(workspaceId: string) {
  return db.automationWorkflow.findMany({
    where: { workspaceId },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }]
  });
}

function normalizeWorkflowDefinitionJson(value?: string | null) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return buildEmptyWorkflowDefinitionJson();
  }

  try {
    JSON.parse(trimmed);
    return trimmed;
  } catch {
    throw new Error("Workflow definition must be valid JSON.");
  }
}

function parseStringArray(value: string | null) {
  if (!value) {
    return [] as string[];
  }

  try {
    const payload = JSON.parse(value) as string[];
    return payload.filter((item) => typeof item === "string" && item.trim().length > 0);
  } catch {
    return [];
  }
}

function parseBusinessHours(value?: string | null) {
  if (!value) {
    return DEFAULT_BUSINESS_HOURS;
  }

  try {
    const parsed = JSON.parse(value) as Array<{ day: number; enabled: boolean; start: string; end: string; label?: string }>;
    if (!Array.isArray(parsed) || parsed.length !== 7) {
      return DEFAULT_BUSINESS_HOURS;
    }

    return DEFAULT_BUSINESS_HOURS.map((entry) => {
      const match = parsed.find((item) => item.day === entry.day);
      return match
        ? {
            day: entry.day,
            label: entry.label,
            enabled: Boolean(match.enabled),
            start: typeof match.start === "string" ? match.start : entry.start,
            end: typeof match.end === "string" ? match.end : entry.end
          }
        : entry;
    });
  } catch {
    return DEFAULT_BUSINESS_HOURS;
  }
}

function parseJobPayload(value: string) {
  try {
    return JSON.parse(value) as { body?: string };
  } catch {
    return {};
  }
}

function formatJobTime(date: Date) {
  return new Intl.DateTimeFormat("en-MY", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}
