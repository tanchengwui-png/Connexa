import { requireCurrentWorkspaceId } from "@/lib/auth/current-user";
import { AutomationJobStatus, AutomationMatchType, AutomationTriggerType } from "@/lib/db-types";
import {
  decodeRuleMatcher,
  formatRuleMatcherValue,
  getRuleOperatorLabel,
  RULE_LANGUAGE_OPTIONS,
  RULE_MATCH_OPERATOR_OPTIONS
} from "@/lib/automation-rule-operators";
import { toClientMediaUrl } from "@/lib/media-library-urls";
import { assertWorkspaceHasActiveAutomationCapacity } from "@/lib/package-feature-limits";
import { prisma as db } from "@/lib/prisma";
import {
  normalizeWorkflowContentAttributeKey,
  validateWorkflowContentAttributeLiteral
} from "@/lib/workflow-content-attributes";

const triggerLabels: Record<AutomationTriggerType, string> = {
  WELCOME_MESSAGE: "Welcome message",
  KEYWORD_MATCH: "Message rule",
  FOLLOW_UP: "Follow-up rule"
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

const WORKFLOW_END_ID = "workflow-end";

export async function getAutomationRulesData() {
  const workspaceId = await requireCurrentWorkspaceId();
  const [workspace, settings, jobs, workflows, agents] = await Promise.all([
    db.workspace.findUnique({
      where: { id: workspaceId },
      include: {
        automationRules: {
          include: {
            replyMediaAsset: true,
            followUpMediaAsset: true
          },
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
    listAutomationWorkflows(workspaceId),
    db.agent.findMany({
      where: { workspaceId },
      orderBy: [{ name: "asc" }],
      select: {
        id: true,
        name: true,
        role: true
      }
    })
  ]);

  if (!workspace) {
    throw new Error("No workspace found. Run the database seed first.");
  }

  type WorkflowRecord = (typeof workflows)[number];
  type AutomationRuleRecord = (typeof workspace.automationRules)[number];
  type AutomationJobRecord = (typeof jobs)[number];
  type WorkspaceMediaAsset = NonNullable<Awaited<ReturnType<typeof db.workspaceMediaAsset.findMany>>>[number];
  const activeWorkflowIds = getStoredActiveWorkflowIds(
    settings?.activeWorkflowId ?? null,
    workflows.map((workflow: WorkflowRecord) => workflow.id)
  );

  const mediaAssetIds = Array.from(
    new Set(
      workspace.automationRules.flatMap((rule: AutomationRuleRecord) => [
        ...parseMediaAssetIds(rule.replyMediaAssetIdsJson, rule.replyMediaAssetId),
        ...parseMediaAssetIds(rule.followUpMediaAssetIdsJson, rule.followUpMediaAssetId)
      ])
    )
  );
  const mediaAssetMap =
    mediaAssetIds.length > 0
      ? new Map(
          (
            await db.workspaceMediaAsset.findMany({
              where: {
                workspaceId,
                id: { in: mediaAssetIds }
              }
            })
          ).map((asset: WorkspaceMediaAsset) => [asset.id, asset] as const)
        )
      : new Map();

  return {
    workspaceId,
    summary: {
      total: workspace.automationRules.length,
      enabled: workspace.automationRules.filter((rule: AutomationRuleRecord) => rule.enabled).length,
      keywordRules: workspace.automationRules.filter(
        (rule: AutomationRuleRecord) => rule.triggerType === AutomationTriggerType.KEYWORD_MATCH
      ).length,
      queuedJobs: jobs.filter((job: AutomationJobRecord) => job.status === AutomationJobStatus.PENDING).length
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
      activeWorkflowIds,
      activeWorkflowId: activeWorkflowIds[0] ?? null,
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
    rules: workspace.automationRules.map((rule: AutomationRuleRecord) => {
      const decodedMatcher = decodeRuleMatcher(rule.matchType, rule.keyword);

      return {
        id: rule.id,
        name: rule.name,
        triggerType: rule.triggerType,
        triggerLabel: triggerLabels[rule.triggerType as AutomationTriggerType],
        matchType: rule.matchType,
        matchOperator: decodedMatcher.operator,
        matchLabel: getRuleOperatorLabel(decodedMatcher.operator),
        keyword: formatRuleMatcherValue(rule.matchType, rule.keyword),
        replyBody: rule.replyBody,
        replyMediaAssetIds: parseMediaAssetIds(rule.replyMediaAssetIdsJson, rule.replyMediaAssetId),
        replyMediaAssets: parseMediaAssetIds(rule.replyMediaAssetIdsJson, rule.replyMediaAssetId)
          .map((assetId: string) => mediaAssetMap.get(assetId))
          .filter((asset): asset is WorkspaceMediaAsset => Boolean(asset))
          .map((asset: WorkspaceMediaAsset) => ({
            id: asset.id,
            title: asset.title,
            kind: asset.kind,
            mimeType: asset.mimeType,
            url: toClientMediaUrl(asset.publicUrl)
          })),
        replyMediaAssetId: rule.replyMediaAssetId,
        replyMediaAssetTitle: rule.replyMediaAsset?.title ?? null,
        replyMediaAssetKind: rule.replyMediaAsset?.kind ?? null,
        replyMediaAssetUrl: rule.replyMediaAsset ? toClientMediaUrl(rule.replyMediaAsset.publicUrl) : null,
        workflowId: rule.workflowId,
        workflowName: workflows.find((workflow: WorkflowRecord) => workflow.id === rule.workflowId)?.name ?? null,
        addTags: parseStringArray(rule.addTags),
        priority: rule.priority,
        cooldownMinutes: rule.cooldownMinutes,
        stopAfterMatch: rule.stopAfterMatch,
        businessHoursOnly: rule.businessHoursOnly,
        followUpDelayMinutes: rule.followUpDelayMinutes,
        followUpReplyBody: rule.followUpReplyBody,
        followUpMediaAssetIds: parseMediaAssetIds(rule.followUpMediaAssetIdsJson, rule.followUpMediaAssetId),
        followUpMediaAssets: parseMediaAssetIds(rule.followUpMediaAssetIdsJson, rule.followUpMediaAssetId)
          .map((assetId: string) => mediaAssetMap.get(assetId))
          .filter((asset): asset is WorkspaceMediaAsset => Boolean(asset))
          .map((asset: WorkspaceMediaAsset) => ({
            id: asset.id,
            title: asset.title,
            kind: asset.kind,
            mimeType: asset.mimeType,
            url: toClientMediaUrl(asset.publicUrl)
          })),
        followUpMediaAssetId: rule.followUpMediaAssetId,
        followUpMediaAssetTitle: rule.followUpMediaAsset?.title ?? null,
        followUpMediaAssetKind: rule.followUpMediaAsset?.kind ?? null,
        followUpMediaAssetUrl: rule.followUpMediaAsset ? toClientMediaUrl(rule.followUpMediaAsset.publicUrl) : null,
        enabled: rule.enabled
      };
    }),
    jobs: jobs.map((job: AutomationJobRecord) => ({
      id: job.id,
      status: job.status,
      runAtIso: job.runAt.toISOString(),
      runAtLabel: formatJobTime(job.runAt),
      conversationId: job.conversationId,
      contactName: job.conversation.contact.displayName,
      ruleName: job.rule?.name ?? "Automation job",
      lastError: job.lastError,
      bodyPreview: formatAutomationJobPreview(parseJobPayload(job.payloadJson))
    })),
    agents: agents.map((agent: (typeof agents)[number]) => ({
      id: agent.id,
      name: agent.name,
      role: agent.role
    })),
    workflows: workflows.map((workflow: WorkflowRecord) => ({
      id: workflow.id,
      name: workflow.name,
      definitionJson: workflow.definitionJson,
      isActive: activeWorkflowIds.includes(workflow.id),
      updatedAtIso: workflow.updatedAt.toISOString()
    }))
  };
}

export async function createAutomationRule(input: AutomationRuleInput) {
  const workspaceId = await requireCurrentWorkspaceId();
  const payload = normalizeRuleInput(input);

  await assertSingleWelcomeMessageRule(workspaceId, payload.triggerType);
  await assertUniqueMessageRuleCondition(workspaceId, payload.triggerType, payload.matchType, payload.keyword);

  if (payload.enabled) {
    await assertWorkspaceHasActiveAutomationCapacity(workspaceId);
  }

  const workflowId = await resolveWorkflowId(workspaceId, input.workflowId);
  const replyMediaAssetId = await resolveMediaAssetId(workspaceId, input.replyMediaAssetId);
  const followUpMediaAssetId = await resolveMediaAssetId(workspaceId, input.followUpMediaAssetId);
  const replyMediaAssetIds = await resolveMediaAssetIds(workspaceId, input.replyMediaAssetIds);
  const followUpMediaAssetIds = await resolveMediaAssetIds(workspaceId, input.followUpMediaAssetIds);
  const {
    replyMediaAssetIds: _replyMediaAssetIds,
    followUpMediaAssetIds: _followUpMediaAssetIds,
    ...prismaPayload
  } = payload;

  return db.automationRule.create({
    data: {
      ...prismaPayload,
      workspaceId,
      workflowId,
      replyMediaAssetId,
      replyMediaAssetIdsJson: replyMediaAssetIds.length ? JSON.stringify(replyMediaAssetIds) : null,
      followUpMediaAssetId,
      followUpMediaAssetIdsJson: followUpMediaAssetIds.length ? JSON.stringify(followUpMediaAssetIds) : null
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

  const workflowId = await resolveWorkflowId(workspaceId, updates.workflowId ?? rule.workflowId);
  const replyMediaAssetId = await resolveMediaAssetId(workspaceId, updates.replyMediaAssetId ?? rule.replyMediaAssetId);
  const followUpMediaAssetId = await resolveMediaAssetId(
    workspaceId,
    updates.followUpMediaAssetId ?? rule.followUpMediaAssetId
  );
  const replyMediaAssetIds = await resolveMediaAssetIds(
    workspaceId,
    updates.replyMediaAssetIds ?? parseMediaAssetIds(rule.replyMediaAssetIdsJson, rule.replyMediaAssetId)
  );
  const followUpMediaAssetIds = await resolveMediaAssetIds(
    workspaceId,
    updates.followUpMediaAssetIds ?? parseMediaAssetIds(rule.followUpMediaAssetIdsJson, rule.followUpMediaAssetId)
  );
  const payload = normalizeRuleInput(
    {
      name: updates.name ?? rule.name,
      triggerType: updates.triggerType ?? rule.triggerType,
      matchType: updates.matchType ?? rule.matchType,
      keyword: updates.keyword ?? rule.keyword ?? "",
      replyBody: updates.replyBody ?? rule.replyBody,
      replyMediaAssetIds,
      replyMediaAssetId,
      workflowId,
      addTags: updates.addTags ?? parseStringArray(rule.addTags),
      priority: updates.priority ?? rule.priority,
      cooldownMinutes: updates.cooldownMinutes ?? rule.cooldownMinutes,
      stopAfterMatch: updates.stopAfterMatch ?? rule.stopAfterMatch,
      businessHoursOnly: updates.businessHoursOnly ?? rule.businessHoursOnly,
      followUpDelayMinutes: updates.followUpDelayMinutes ?? rule.followUpDelayMinutes,
      followUpReplyBody: updates.followUpReplyBody ?? rule.followUpReplyBody,
      followUpMediaAssetIds,
      followUpMediaAssetId,
      enabled: updates.enabled ?? rule.enabled
    },
    updates.enabled ?? rule.enabled
  );

  await assertSingleWelcomeMessageRule(workspaceId, payload.triggerType, rule.id);
  await assertUniqueMessageRuleCondition(
    workspaceId,
    payload.triggerType,
    payload.matchType,
    payload.keyword,
    rule.id
  );

  if (!rule.enabled && payload.enabled) {
    await assertWorkspaceHasActiveAutomationCapacity(workspaceId);
  }

  const {
    replyMediaAssetIds: _replyMediaAssetIds,
    followUpMediaAssetIds: _followUpMediaAssetIds,
    ...prismaPayload
  } = payload;

  return db.automationRule.update({
    where: { id: rule.id },
    data: {
      ...prismaPayload,
      workflowId,
      replyMediaAssetId,
      replyMediaAssetIdsJson: replyMediaAssetIds.length ? JSON.stringify(replyMediaAssetIds) : null,
      followUpMediaAssetId,
      followUpMediaAssetIdsJson: followUpMediaAssetIds.length ? JSON.stringify(followUpMediaAssetIds) : null
    }
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
  const activeWorkflowIds = await resolveActiveWorkflowIds(workspaceId, input.activeWorkflowIds, input.activeWorkflowId);
  const storedActiveWorkflowId = serializeStoredActiveWorkflowIds(activeWorkflowIds);
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
      activeWorkflowId: storedActiveWorkflowId,
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
      activeWorkflowId: storedActiveWorkflowId,
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
  replyMediaAssetIds?: string[];
  replyMediaAssetId?: string | null;
  workflowId?: string | null;
  addTags?: string[];
  priority: number;
  cooldownMinutes: number;
  stopAfterMatch?: boolean;
  businessHoursOnly?: boolean;
  followUpDelayMinutes?: number | null;
  followUpReplyBody?: string | null;
  followUpMediaAssetIds?: string[];
  followUpMediaAssetId?: string | null;
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
  activeWorkflowIds?: string[];
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
  const replyMediaAssetIds = sanitizeMediaAssetIds(input.replyMediaAssetIds);
  const replyMediaAssetId = input.replyMediaAssetId?.trim() || null;
  const workflowId = input.workflowId?.trim() || null;
  const followUpReplyBody = input.followUpReplyBody?.trim() || null;
  const followUpMediaAssetIds = sanitizeMediaAssetIds(input.followUpMediaAssetIds);
  const followUpMediaAssetId = input.followUpMediaAssetId?.trim() || null;
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

  if (input.triggerType === AutomationTriggerType.KEYWORD_MATCH && keyword) {
    const decodedMatcher = decodeRuleMatcher(input.matchType, keyword);
    const selectedOperator = RULE_MATCH_OPERATOR_OPTIONS.find((option) => option.value === decodedMatcher.operator);

    if (selectedOperator?.needsValue && !decodedMatcher.value.trim()) {
      throw new Error(`${selectedOperator.label} needs a value.`);
    }

    if (
      decodedMatcher.operator === "MESSAGE_LANGUAGE_IS" &&
      !RULE_LANGUAGE_OPTIONS.some((language) => language.value === decodedMatcher.value.trim().toLowerCase())
    ) {
      throw new Error("Language must be English, Malay, or Chinese.");
    }
  }

  if (!replyBody && !workflowId && !replyMediaAssetId && !replyMediaAssetIds.length) {
    throw new Error("Reply body, media, or workflow is required.");
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
    replyMediaAssetIds,
    replyMediaAssetId,
    addTags: addTags.length ? JSON.stringify(addTags) : null,
    priority,
    cooldownMinutes,
    stopAfterMatch: Boolean(input.stopAfterMatch),
    businessHoursOnly: Boolean(input.businessHoursOnly),
    followUpDelayMinutes,
    followUpReplyBody,
    followUpMediaAssetIds,
    followUpMediaAssetId,
    enabled: forcedEnabled ?? input.enabled ?? false
  };
}

async function assertSingleWelcomeMessageRule(
  workspaceId: string,
  triggerType: AutomationTriggerType,
  excludeRuleId?: string
) {
  if (triggerType !== AutomationTriggerType.WELCOME_MESSAGE) {
    return;
  }

  const existingWelcomeRule = await db.automationRule.findFirst({
    where: {
      workspaceId,
      triggerType: AutomationTriggerType.WELCOME_MESSAGE,
      ...(excludeRuleId ? { id: { not: excludeRuleId } } : {})
    },
    select: {
      id: true
    }
  });

  if (existingWelcomeRule) {
    throw new Error("Only one welcome message rule can be created per workspace.");
  }
}

async function assertUniqueMessageRuleCondition(
  workspaceId: string,
  triggerType: AutomationTriggerType,
  matchType: AutomationMatchType,
  keyword: string | null,
  excludeRuleId?: string
) {
  if (triggerType !== AutomationTriggerType.KEYWORD_MATCH || !keyword) {
    return;
  }

  const existingMessageRule = await db.automationRule.findFirst({
    where: {
      workspaceId,
      triggerType: AutomationTriggerType.KEYWORD_MATCH,
      matchType,
      keyword,
      ...(excludeRuleId ? { id: { not: excludeRuleId } } : {})
    },
    select: {
      id: true
    }
  });

  if (existingMessageRule) {
    throw new Error("This message rule condition and value already exist in this workspace.");
  }
}

function getStoredActiveWorkflowIds(value: string | null | undefined, validWorkflowIds?: string[]) {
  const normalized = value?.trim();
  if (!normalized) {
    return [] as string[];
  }

  let workflowIds: string[] = [];

  if (normalized.startsWith("[")) {
    try {
      const parsed = JSON.parse(normalized) as unknown;
      if (Array.isArray(parsed)) {
        workflowIds = parsed
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter(Boolean);
      }
    } catch {
      workflowIds = [];
    }
  } else {
    workflowIds = [normalized];
  }

  const uniqueWorkflowIds = Array.from(new Set(workflowIds));
  if (!validWorkflowIds) {
    return uniqueWorkflowIds;
  }

  const validWorkflowIdSet = new Set(validWorkflowIds);
  return uniqueWorkflowIds.filter((workflowId: string) => validWorkflowIdSet.has(workflowId));
}

function serializeStoredActiveWorkflowIds(workflowIds: string[]) {
  const normalized = Array.from(
    new Set(workflowIds.map((workflowId: string) => workflowId.trim()).filter(Boolean))
  );
  if (!normalized.length) {
    return null;
  }

  return normalized.length === 1 ? normalized[0] : JSON.stringify(normalized);
}

async function resolveActiveWorkflowIds(
  workspaceId: string,
  inputWorkflowIds?: string[] | null,
  fallbackWorkflowId?: string | null
) {
  const workflows = await listAutomationWorkflows(workspaceId);
  const validWorkflowIds = workflows.map((workflow: (typeof workflows)[number]) => workflow.id);
  const requestedWorkflowIds =
    inputWorkflowIds && inputWorkflowIds.length
      ? inputWorkflowIds
      : fallbackWorkflowId
        ? [fallbackWorkflowId]
        : [];

  return getStoredActiveWorkflowIds(serializeStoredActiveWorkflowIds(requestedWorkflowIds), validWorkflowIds);
}

async function resolveWorkflowId(workspaceId: string, workflowId?: string | null) {
  const normalizedWorkflowId = workflowId?.trim() || null;
  if (!normalizedWorkflowId) {
    return null;
  }

  const workflow = await db.automationWorkflow.findFirst({
    where: {
      id: normalizedWorkflowId,
      workspaceId
    },
    select: {
      id: true
    }
  });

  if (!workflow) {
    throw new Error("Selected workflow was not found.");
  }

  return workflow.id;
}

async function resolveMediaAssetId(workspaceId: string, mediaAssetId?: string | null) {
  const normalizedMediaAssetId = mediaAssetId?.trim() || null;
  if (!normalizedMediaAssetId) {
    return null;
  }

  const asset = await db.workspaceMediaAsset.findFirst({
    where: {
      id: normalizedMediaAssetId,
      workspaceId
    },
    select: {
      id: true
    }
  });

  if (!asset) {
    throw new Error("Selected media asset was not found.");
  }

  return asset.id;
}

async function resolveMediaAssetIds(workspaceId: string, mediaAssetIds?: string[] | null) {
  const normalizedIds = sanitizeMediaAssetIds(mediaAssetIds);
  if (!normalizedIds.length) {
    return [];
  }

  const assets = await db.workspaceMediaAsset.findMany({
    where: {
      workspaceId,
      id: { in: normalizedIds }
    },
    select: {
      id: true
    }
  });

  if (assets.length !== normalizedIds.length) {
    throw new Error("One or more selected media assets were not found.");
  }

  const assetIds = new Set(assets.map((asset: (typeof assets)[number]) => asset.id));
  return normalizedIds.filter((assetId: string) => assetIds.has(assetId));
}

function sanitizeMediaAssetIds(mediaAssetIds?: string[] | null) {
  return Array.from(
    new Set((mediaAssetIds ?? []).map((assetId: string) => assetId.trim()).filter(Boolean))
  );
}

function parseMediaAssetIds(value: string | null | undefined, fallbackId?: string | null) {
  const fallback = fallbackId?.trim() ? [fallbackId.trim()] : [];

  if (!value?.trim()) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return fallback;
    }

    const normalized = parsed
      .filter((item): item is string => typeof item === "string")
      .map((item: string) => item.trim())
      .filter(Boolean);
    return normalized.length ? Array.from(new Set(normalized)) : fallback;
  } catch {
    return fallback;
  }
}

function normalizeWorkflowReplyMediaItems(mediaItems: unknown, fallbackMediaAssetIds?: unknown) {
  if (Array.isArray(mediaItems)) {
    return mediaItems
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
      .map((item: Record<string, unknown>) => ({
        mediaAssetId: typeof item.mediaAssetId === "string" ? item.mediaAssetId.trim() : "",
        message: typeof item.message === "string" ? item.message.trim() : ""
      }))
      .filter((item: { mediaAssetId: string; message: string }) => item.mediaAssetId);
  }

  return sanitizeMediaAssetIds(
    Array.isArray(fallbackMediaAssetIds)
      ? fallbackMediaAssetIds.filter((item): item is string => typeof item === "string")
      : []
  ).map((mediaAssetId) => ({
    mediaAssetId,
    message: ""
  }));
}

function getWorkflowActivationValidationError(value: string) {
  const workflow = parseWorkflowDefinition(value);
  if (!workflow) {
    return "Workflow definition is invalid.";
  }

  const saveValidationError = getWorkflowSaveValidationError(value);
  if (saveValidationError) {
    return saveValidationError;
  }

  const { stepMap, reachableStepIds, reachesEndStep, canReachEndStepIds } = analyzeWorkflowGraph(workflow);
  if (!reachesEndStep) {
    return "The active workflow must reach at least one end step from the start path.";
  }

  for (const step of workflow.steps) {
    if (step.id === WORKFLOW_END_ID && !reachableStepIds.has(step.id)) {
      continue;
    }

    if (step.type === "end") {
      continue;
    }

    if (!canReachEndStepIds.has(step.id)) {
      return `Step "${step.title || step.id}" does not lead to an end step.`;
    }
  }

  for (const step of workflow.steps) {
    if (step.type === "go_to" && reachableStepIds.has(step.id)) {
      const targetStepId = step.targetStepId?.trim();
      if (targetStepId && stepMap.has(targetStepId) && !canReachEndStepIds.has(targetStepId)) {
        return `Go to step "${step.title || step.id}" creates a loop or dead-end path without an exit.`;
      }
    }
  }

  return null;
}

function getWorkflowSaveValidationError(value: string) {
  const workflow = parseWorkflowDefinition(value);
  if (!workflow) {
    return "Workflow definition is invalid.";
  }

  const stepMap = new Map<string, WorkflowDefinitionStep>();
  for (const step of workflow.steps) {
    if (!step.id) {
      return "Each workflow step must have an id before saving.";
    }

    if (stepMap.has(step.id)) {
      return `Workflow step "${step.id}" is duplicated.`;
    }

    stepMap.set(step.id, step);
  }

  if (!workflow.startStepId || !stepMap.has(workflow.startStepId)) {
    return "Choose a valid start step before saving the workflow.";
  }

  if (workflow.startStepId === WORKFLOW_END_ID) {
    return "Add at least one workflow step between Start and End before saving.";
  }

  if (!workflow.steps.some((step) => step.type !== "end")) {
    return "Add at least one workflow step between Start and End before saving.";
  }

  for (const step of workflow.steps) {
    for (const targetId of getWorkflowStepTargets(step)) {
      if (!stepMap.has(targetId)) {
        return `Step "${step.title || step.id}" points to a missing next step.`;
      }
    }
  }

  const { reachableStepIds } = analyzeWorkflowGraph(workflow);

  for (const step of workflow.steps) {
    if (step.id === WORKFLOW_END_ID && !reachableStepIds.has(step.id)) {
      continue;
    }

    if (!reachableStepIds.has(step.id)) {
      return `Step "${step.title || step.id}" is not connected to the start path.`;
    }

    if (step.type === "end") {
      continue;
    }

    const label = step.title || step.id;

    if ((step.type === "question" || step.type === "choice" || step.type === "ask") && !step.prompt?.trim()) {
      return `Question step "${label}" needs a prompt before saving.`;
    }

    if (
      (step.type === "question" || step.type === "choice" || step.type === "ask") &&
      step.onTimeoutStepId?.trim() &&
      (!(typeof step.expiresAfterMinutes === "number") || step.expiresAfterMinutes <= 0)
    ) {
      return `Question step "${label}" needs a timeout greater than 0 minutes before using a timeout route.`;
    }

    if ((step.type === "question" || step.type === "choice") && (!step.branches || !step.branches.length)) {
      return `Question step "${label}" needs at least one branch before saving.`;
    }

    if (step.type === "question" || step.type === "choice") {
      for (const branch of step.branches ?? []) {
        const hasKeywords = (branch.keywords ?? []).some((keyword) => keyword.trim());
        if (!hasKeywords) {
          return `Branch "${branch.label || branch.id || "Untitled branch"}" in "${label}" needs at least one keyword.`;
        }

        const nextStepId = branch.nextStepId?.trim() || WORKFLOW_END_ID;
        if (nextStepId !== WORKFLOW_END_ID && !stepMap.has(nextStepId)) {
          return `Branch "${branch.label || branch.id || "Untitled branch"}" in "${label}" points to a missing next step.`;
        }
      }
    }

    if (step.type === "delay" && (!(typeof step.delayMinutes === "number") || step.delayMinutes <= 0)) {
      return `Delay step "${label}" needs a delay greater than 0 minutes.`;
    }

    if (step.type === "go_to") {
      const targetStepId = step.targetStepId?.trim();
      if (!targetStepId) {
        return `Go to step "${label}" needs a target step before saving.`;
      }

      if (!stepMap.has(targetStepId)) {
        return `Go to step "${label}" points to a missing target step.`;
      }
    }

    if (step.type === "reply") {
      const reply = step.reply?.trim() ?? "";
      const mediaItems = normalizeWorkflowReplyMediaItems(step.mediaItems, step.mediaAssetIds);
      if (!reply && !mediaItems.length) {
        return `Reply step "${label}" requires reply text or at least one media item.`;
      }
    }

    if (step.type === "update") {
      const assignmentMode = normalizeWorkflowAssignmentMode(step.assignmentMode);
      const assignOwnerId = normalizeOptionalString(step.assignOwnerId);
      const notifyAgentIds = normalizeWorkflowRoundRobinAgentIds(step.notifyAgentIds);
      const roundRobinAgentIds = normalizeWorkflowRoundRobinAgentIds(step.roundRobinAgentIds);
      const leadAttributeKey = normalizeOptionalString(step.leadAttributeKey);
      const leadAttributeValueSource = step.leadAttributeValueSource === "savedValue" ? "savedValue" : "literal";

      if (assignmentMode === "fixed" && !assignOwnerId) {
        return `Update step "${label}" needs an assigned agent before saving.`;
      }

      if (assignmentMode === "round_robin" && roundRobinAgentIds.length < 2) {
        return `Update step "${label}" needs at least two agents for round robin.`;
      }

      if ((step.notifyAssignedOwner || notifyAgentIds.length) && !normalizeOptionalString(step.notifyMessage)) {
        return `Update step "${label}" needs a notification message.`;
      }

      if (leadAttributeKey) {
        if (leadAttributeKey === "custom" && !normalizeOptionalString(step.leadCustomAttributeKey)) {
          return `Update step "${label}" needs a custom field key.`;
        }

        if (leadAttributeValueSource === "savedValue" && !normalizeOptionalString(step.leadAttributeValueKey)) {
          return `Update step "${label}" needs a saved answer key.`;
        }

        if (leadAttributeValueSource === "literal" && !normalizeOptionalString(step.leadAttributeValue)) {
          return `Update step "${label}" needs a content field value.`;
        }

        if (leadAttributeValueSource === "literal") {
          const validationError = validateWorkflowContentAttributeLiteral({
            attributeKey: leadAttributeKey,
            value: step.leadAttributeValue,
            customAttributeKey: step.leadCustomAttributeKey
          });
          if (validationError) {
            return `Update step "${label}" ${validationError}`;
          }
        }
      }

      continue;
    }

    if (step.type === "action") {
      const notifyAgentIds = normalizeWorkflowRoundRobinAgentIds(step.notifyAgentIds);
      if ((step.notifyAssignedOwner || notifyAgentIds.length) && !normalizeOptionalString(step.notifyMessage)) {
        return `Action step "${label}" needs a notification message.`;
      }
    }
  }

  return null;
}

function analyzeWorkflowGraph(workflow: WorkflowDefinition) {
  const stepMap = new Map<string, WorkflowDefinitionStep>();
  for (const step of workflow.steps) {
    stepMap.set(step.id, step);
  }

  const adjacency = new Map<string, string[]>();
  const reverseAdjacency = new Map<string, string[]>();

  for (const step of workflow.steps) {
    const targets = getWorkflowStepTargets(step).filter((targetId) => stepMap.has(targetId));
    adjacency.set(step.id, targets);
    for (const targetId of targets) {
      const reverseTargets = reverseAdjacency.get(targetId) ?? [];
      reverseTargets.push(step.id);
      reverseAdjacency.set(targetId, reverseTargets);
    }
  }

  const reachableStepIds = new Set<string>();
  const queue = [workflow.startStepId];
  let reachesEndStep = false;

  while (queue.length) {
    const stepId = queue.shift();
    if (!stepId || reachableStepIds.has(stepId) || !stepMap.has(stepId)) {
      continue;
    }

    reachableStepIds.add(stepId);
    const step = stepMap.get(stepId);
    if (!step) {
      continue;
    }

    if (step.type === "end") {
      reachesEndStep = true;
    }

    for (const targetId of adjacency.get(step.id) ?? []) {
      queue.push(targetId);
    }
  }

  const canReachEndStepIds = new Set<string>();
  const endQueue = workflow.steps.filter((step) => step.type === "end").map((step) => step.id);
  while (endQueue.length) {
    const stepId = endQueue.shift();
    if (!stepId || canReachEndStepIds.has(stepId)) {
      continue;
    }

    canReachEndStepIds.add(stepId);
    for (const sourceId of reverseAdjacency.get(stepId) ?? []) {
      endQueue.push(sourceId);
    }
  }

  return {
    stepMap,
    reachableStepIds,
    reachesEndStep,
    canReachEndStepIds
  };
}

type WorkflowDefinition = {
  startStepId: string;
  steps: WorkflowDefinitionStep[];
};

type WorkflowDefinitionStep = {
  id: string;
  type: string;
  title?: string;
  prompt?: string | null;
  expiresAfterMinutes?: number | null;
  onTimeoutStepId?: string | null;
  nextStepId?: string | null;
  targetStepId?: string | null;
  fallbackNextStepId?: string | null;
  reply?: string | null;
  delayMinutes?: number | null;
  assignmentMode?: string | null;
  assignOwnerId?: string | null;
  notifyAssignedOwner?: boolean;
  notifyAgentIds?: string[];
  notifyMessage?: string | null;
  roundRobinAgentIds?: string[];
  overwriteExistingOwner?: boolean;
  leadAttributeKey?: string | null;
  leadAttributeValue?: string | null;
  leadAttributeValueSource?: string | null;
  leadAttributeValueKey?: string | null;
  leadCustomAttributeKey?: string | null;
  mediaItems?: unknown;
  mediaAssetIds?: unknown;
  branches?: Array<{
    id?: string;
    label?: string;
    keywords?: string[];
    nextStepId?: string | null;
  }>;
};

function parseWorkflowDefinition(value: string): WorkflowDefinition | null {
  try {
    const parsed = JSON.parse(value) as WorkflowDefinition;
    if (!parsed || typeof parsed !== "object" || typeof parsed.startStepId !== "string" || !Array.isArray(parsed.steps)) {
      return null;
    }

    return {
      startStepId: parsed.startStepId.trim(),
      steps: parsed.steps
        .filter(
          (step): step is WorkflowDefinitionStep =>
            Boolean(step) && typeof step === "object" && typeof (step as { id?: unknown }).id === "string"
        )
        .map((step) => ({
          ...step,
          id: step.id.trim()
        }))
        .filter((step) => step.id)
    };
  } catch {
    return null;
  }
}

function getWorkflowStepTargets(step: WorkflowDefinitionStep) {
  const targets = new Set<string>();

  for (const target of [step.nextStepId, step.targetStepId, step.fallbackNextStepId, step.onTimeoutStepId]) {
    const normalizedTarget = target?.trim();
    if (normalizedTarget) {
      targets.add(normalizedTarget);
    }
  }

  for (const branch of step.branches ?? []) {
    const normalizedTarget = branch.nextStepId?.trim();
    if (normalizedTarget) {
      targets.add(normalizedTarget);
    }
  }

  return Array.from(targets);
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

function normalizeWorkflowAssignmentMode(value: unknown): "none" | "fixed" | "round_robin" {
  return value === "round_robin" ? "round_robin" : value === "fixed" ? "fixed" : "none";
}

function normalizeWorkflowRoundRobinAgentIds(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(value.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean))
  );
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
        activeWorkflowId: serializeStoredActiveWorkflowIds([workflow.id])
      },
      update: {
        workflowFlowEnabled: true,
        activeWorkflowId: serializeStoredActiveWorkflowIds([workflow.id])
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
    data.definitionJson = await normalizeWorkflowDefinitionJson(workspaceId, input.definitionJson);
  }

  const updated = await db.automationWorkflow.update({
    where: { id: workflow.id },
    data
  });

  if (typeof input.isActive === "boolean") {
    if (input.isActive) {
      const activationValidationError = getWorkflowActivationValidationError(updated.definitionJson);
      if (activationValidationError) {
        throw new Error(activationValidationError);
      }
    }

    const settings = await db.workspaceAutomationSettings.findUnique({
      where: { workspaceId }
    });
    const currentActiveWorkflowIds = getStoredActiveWorkflowIds(settings?.activeWorkflowId ?? null);
    const nextActiveWorkflowIds = input.isActive
      ? Array.from(new Set([...currentActiveWorkflowIds, workflow.id]))
      : currentActiveWorkflowIds.filter((workflowId) => workflowId !== workflow.id);

    await db.workspaceAutomationSettings.upsert({
      where: { workspaceId },
      create: {
        workspaceId,
        timezone: "Asia/Kuala_Lumpur",
        workflowFlowEnabled: input.isActive,
        activeWorkflowId: serializeStoredActiveWorkflowIds(nextActiveWorkflowIds)
      },
      update: {
        workflowFlowEnabled: input.isActive ? true : settings?.workflowFlowEnabled ?? false,
        activeWorkflowId: serializeStoredActiveWorkflowIds(nextActiveWorkflowIds)
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

  const linkedRules = await db.automationRule.findMany({
    where: {
      workspaceId,
      workflowId: workflow.id
    },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
    select: {
      name: true
    }
  });
  if (linkedRules.length > 0) {
    const ruleNames: string[] = linkedRules
      .map((rule: (typeof linkedRules)[number]) => rule.name.trim() || "Unnamed rule");
    const message =
      ruleNames.length === 1
        ? `Cannot delete workflow. It is used by rule "${ruleNames[0]}".`
        : `Cannot delete workflow. It is used by rules: ${ruleNames.map((name: string) => `"${name}"`).join(", ")}.`;
    throw new Error(message);
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
  const nextActiveWorkflowIds = getStoredActiveWorkflowIds(
    settings?.activeWorkflowId ?? null,
    remaining.map((item: (typeof remaining)[number]) => item.id)
  ).filter((workflowId: string) => workflowId !== workflow.id);
  if (serializeStoredActiveWorkflowIds(nextActiveWorkflowIds) !== (settings?.activeWorkflowId ?? null)) {
    await db.workspaceAutomationSettings.update({
      where: { workspaceId },
      data: {
        activeWorkflowId: serializeStoredActiveWorkflowIds(nextActiveWorkflowIds)
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

async function normalizeWorkflowDefinitionJson(workspaceId: string, value?: string | null) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return buildEmptyWorkflowDefinitionJson();
  }

  try {
    const parsed = JSON.parse(trimmed) as {
      startStepId?: unknown;
      steps?: unknown;
    };

    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.steps) || typeof parsed.startStepId !== "string") {
      throw new Error("Workflow definition must include a start step and steps.");
    }

    const replyStepMediaIds = new Set<string>();
    const workflowAgentIds = new Set<string>();
    for (const step of parsed.steps) {
      if (!step || typeof step !== "object") {
        continue;
      }

      const replyStep = step as {
        id?: unknown;
        title?: unknown;
        type?: unknown;
        reply?: unknown;
        emoji?: unknown;
        mediaAssetIds?: unknown;
        mediaItems?: unknown;
      };

      if (replyStep.type !== "reply") {
        continue;
      }

      const label =
        (typeof replyStep.title === "string" && replyStep.title.trim()) ||
        (typeof replyStep.id === "string" && replyStep.id.trim()) ||
        "reply";
      const emoji = typeof replyStep.emoji === "string" ? replyStep.emoji.trim() : "";
      const reply = typeof replyStep.reply === "string" ? replyStep.reply.trim() : "";
      const mediaItems = normalizeWorkflowReplyMediaItems(replyStep.mediaItems, replyStep.mediaAssetIds);
      const mediaAssetIds = mediaItems.map((item) => item.mediaAssetId);

      if (!reply && !mediaItems.length) {
        throw new Error(`Reply step "${label}" requires reply text or at least one media item.`);
      }

      replyStep.emoji = emoji || null;
      replyStep.mediaAssetIds = mediaAssetIds;
      replyStep.mediaItems = mediaItems;
      mediaAssetIds.forEach((mediaAssetId) => replyStepMediaIds.add(mediaAssetId));
    }

    for (const step of parsed.steps) {
      if (!step || typeof step !== "object") {
        continue;
      }

      const workflowStep = step as {
        type?: unknown;
        assignOwnerId?: unknown;
        notifyAssignedOwner?: unknown;
        notifyAgentIds?: unknown;
        notifyMessage?: unknown;
        assignmentMode?: unknown;
        roundRobinAgentIds?: unknown;
        overwriteExistingOwner?: unknown;
        leadAttributeKey?: unknown;
      };

      if (workflowStep.type !== "update" && workflowStep.type !== "action") {
        continue;
      }

      const notifyAgentIds = normalizeWorkflowRoundRobinAgentIds(workflowStep.notifyAgentIds);
      workflowStep.notifyAssignedOwner = Boolean(workflowStep.notifyAssignedOwner);
      workflowStep.notifyAgentIds = notifyAgentIds;
      workflowStep.notifyMessage =
        typeof workflowStep.notifyMessage === "string" ? workflowStep.notifyMessage.trim() || null : null;
      notifyAgentIds.forEach((agentId) => workflowAgentIds.add(agentId));

      const assignOwnerId = typeof workflowStep.assignOwnerId === "string" ? workflowStep.assignOwnerId.trim() : "";
      workflowStep.assignOwnerId = assignOwnerId || null;

      if (workflowStep.type === "action") {
        if (assignOwnerId) {
          workflowAgentIds.add(assignOwnerId);
        }
        continue;
      }

      const assignmentMode = normalizeWorkflowAssignmentMode(workflowStep.assignmentMode ?? (assignOwnerId ? "fixed" : "none"));
      const roundRobinAgentIds = normalizeWorkflowRoundRobinAgentIds(workflowStep.roundRobinAgentIds);

      workflowStep.assignmentMode = assignmentMode;
      workflowStep.roundRobinAgentIds = roundRobinAgentIds;
      workflowStep.overwriteExistingOwner = Boolean(workflowStep.overwriteExistingOwner);
      workflowStep.leadAttributeKey = normalizeWorkflowContentAttributeKey(workflowStep.leadAttributeKey);

      if (assignOwnerId) {
        workflowAgentIds.add(assignOwnerId);
      }
      roundRobinAgentIds.forEach((agentId) => workflowAgentIds.add(agentId));
    }

    if (replyStepMediaIds.size) {
      const existingMediaAssetIds = new Set(
        (
          await db.workspaceMediaAsset.findMany({
            where: {
              workspaceId,
              id: {
                in: Array.from(replyStepMediaIds)
              }
            },
            select: {
              id: true
            }
          })
        ).map((asset: { id: string }) => asset.id)
      );

      const missingMediaAssetId = Array.from(replyStepMediaIds).find((mediaAssetId) => !existingMediaAssetIds.has(mediaAssetId));
      if (missingMediaAssetId) {
        throw new Error(`Workflow reply media was not found: ${missingMediaAssetId}`);
      }
    }

    if (workflowAgentIds.size) {
      const existingAgentIds = new Set(
        (
          await db.agent.findMany({
            where: {
              workspaceId,
              id: {
                in: Array.from(workflowAgentIds)
              }
            },
            select: {
              id: true
            }
          })
        ).map((agent: { id: string }) => agent.id)
      );

      const missingAgentId = Array.from(workflowAgentIds).find((agentId) => !existingAgentIds.has(agentId));
      if (missingAgentId) {
        throw new Error(`Workflow notification or assignment agent was not found: ${missingAgentId}`);
      }
    }

    const normalizedJson = JSON.stringify(parsed, null, 2);
    const saveValidationError = getWorkflowSaveValidationError(normalizedJson);
    if (saveValidationError) {
      throw new Error(saveValidationError);
    }

    return normalizedJson;
  } catch (error) {
    if (error instanceof Error && !(error instanceof SyntaxError)) {
      throw error;
    }

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
    return JSON.parse(value) as { body?: string; attachmentName?: string };
  } catch {
    return {};
  }
}

function formatAutomationJobPreview(payload: { body?: string; attachmentName?: string }) {
  const body = payload.body?.trim();
  if (body) {
    return body;
  }

  if (payload.attachmentName?.trim()) {
    return `Media: ${payload.attachmentName.trim()}`;
  }

  return "";
}

function formatJobTime(date: Date) {
  return new Intl.DateTimeFormat("en-MY", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Kuala_Lumpur"
  }).format(date);
}
