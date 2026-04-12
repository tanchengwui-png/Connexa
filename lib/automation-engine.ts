import {
  AutomationMatchType,
  AutomationTriggerType,
  AutomationJobStatus,
  AutomationJobType,
  ConversationStatus,
  LeadPriority,
  LeadSource,
  LeadStage,
  MessageDirection
} from "@prisma/client";
import { enqueueOutboundMessage } from "@/lib/outbound-message-jobs";
import { prisma } from "@/lib/prisma";

const DEFAULT_TIMEZONE = "Asia/Kuala_Lumpur";

export async function processInboundAutomation(input: {
  workspaceId: string;
  conversationId: string;
  inboundText: string;
  sentAt: Date;
  ignorePausedState?: boolean;
}) {
  const conversation = await prisma.conversation.findFirst({
    where: {
      id: input.conversationId,
      workspaceId: input.workspaceId
    },
    include: {
      contact: true
    }
  });

  if (!conversation) {
    return;
  }

  const [settings, rules, state, inboundCount] = await Promise.all([
    getOrCreateAutomationSettings(input.workspaceId),
    prisma.automationRule.findMany({
      where: {
        workspaceId: input.workspaceId,
        enabled: true
      },
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }]
    }),
    prisma.conversationAutomationState.upsert({
      where: {
        conversationId: input.conversationId
      },
      create: {
        workspaceId: input.workspaceId,
        conversationId: input.conversationId
      },
      update: {}
    }),
    prisma.message.count({
      where: {
        conversationId: input.conversationId,
        direction: MessageDirection.INBOUND
      }
    })
  ]);

  if (!input.ignorePausedState && state.automationPausedUntil && state.automationPausedUntil > input.sentAt) {
    return;
  }

  if (settings.workflowFlowEnabled && state.activeFlowKey === "CONVERSATION_WORKFLOW") {
    const progressed = await advanceStructuredWorkflow({
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      contactId: conversation.contactId,
      contactPhone: conversation.contact.phone,
      contactTags: conversation.contact.tags,
      inboundText: input.inboundText,
      sentAt: input.sentAt,
      workflow: parseWorkflowDefinition(settings.workflowDefinitionJson),
      settings
    });

    if (progressed) {
      return;
    }
  }

  if (settings.businessHoursEnabled && settings.awayReplyEnabled && !isWithinBusinessHours(settings, input.sentAt)) {
    const shouldSendAway =
      !state.awayReplySentAt ||
      minutesBetween(state.awayReplySentAt, input.sentAt) >= settings.awayReplyCooldownMinutes;

    if (shouldSendAway && settings.awayReplyBody) {
      await sendAutomatedMessage({
        workspaceId: input.workspaceId,
        conversationId: input.conversationId,
        to: conversation.contact.phone,
        body: settings.awayReplyBody
      });

      await prisma.conversationAutomationState.update({
        where: {
          conversationId: input.conversationId
        },
        data: {
          awayReplySentAt: input.sentAt,
          lastAutoReplyAt: input.sentAt
        }
      });
    }

    return;
  }

  if (settings.workflowFlowEnabled && inboundCount === 1 && !state.activeFlowKey) {
    const started = await startStructuredWorkflow({
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      contactId: conversation.contactId,
      contactPhone: conversation.contact.phone,
      contactTags: conversation.contact.tags,
      sentAt: input.sentAt,
      workflow: parseWorkflowDefinition(settings.workflowDefinitionJson)
    });

    if (started) {
      return;
    }
  }

  const eligibleRules = rules.filter((rule) => {
    if (rule.triggerType === AutomationTriggerType.WELCOME_MESSAGE) {
      return inboundCount === 1;
    }

    return rule.triggerType === AutomationTriggerType.KEYWORD_MATCH;
  });

  for (const rule of eligibleRules) {
    if (rule.businessHoursOnly && !isWithinBusinessHours(settings, input.sentAt)) {
      continue;
    }

    if (!matchesRule(rule.matchType, rule.keyword, input.inboundText, settings.regexEnabled)) {
      continue;
    }

    const execution = await prisma.conversationRuleExecution.findUnique({
      where: {
        conversationId_ruleId: {
          conversationId: input.conversationId,
          ruleId: rule.id
        }
      }
    });

    if (execution && minutesBetween(execution.lastTriggeredAt, input.sentAt) < rule.cooldownMinutes) {
      continue;
    }

    const nextTags = mergeTags(conversation.contact.tags, parseStringArray(rule.addTags));
    if (nextTags.length) {
      await prisma.contact.update({
        where: {
          id: conversation.contactId
        },
        data: {
          tags: nextTags.join(", ")
        }
      });
      conversation.contact.tags = nextTags.join(", ");
    }

    await sendAutomatedMessage({
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      to: conversation.contact.phone,
      body: rule.replyBody
    });

    await prisma.conversationAutomationState.update({
      where: {
        conversationId: input.conversationId
      },
      data: {
        welcomeSentAt:
          rule.triggerType === AutomationTriggerType.WELCOME_MESSAGE && !state.welcomeSentAt ? input.sentAt : state.welcomeSentAt,
        lastAutoReplyAt: input.sentAt,
        lastMatchedRuleId: rule.id
      }
    });

    if (execution) {
      await prisma.conversationRuleExecution.update({
        where: {
          conversationId_ruleId: {
            conversationId: input.conversationId,
            ruleId: rule.id
          }
        },
        data: {
          lastTriggeredAt: input.sentAt,
          triggerCount: {
            increment: 1
          }
        }
      });
    } else {
      await prisma.conversationRuleExecution.create({
        data: {
          workspaceId: input.workspaceId,
          conversationId: input.conversationId,
          ruleId: rule.id,
          lastTriggeredAt: input.sentAt
        }
      });
    }

    if (rule.followUpDelayMinutes && rule.followUpReplyBody?.trim()) {
      await prisma.automationJob.create({
        data: {
          workspaceId: input.workspaceId,
          conversationId: input.conversationId,
          ruleId: rule.id,
          jobType: AutomationJobType.FOLLOW_UP_MESSAGE,
          status: AutomationJobStatus.PENDING,
          runAt: new Date(input.sentAt.getTime() + rule.followUpDelayMinutes * 60 * 1000),
          payloadJson: JSON.stringify({
            body: rule.followUpReplyBody.trim()
          })
        }
      });
    }

    if (rule.stopAfterMatch) {
      break;
    }
  }
}

export async function applyHumanTakeoverPause(input: {
  workspaceId: string;
  conversationId: string;
  pausedAt?: Date;
}) {
  const settings = await getOrCreateAutomationSettings(input.workspaceId);
  const pausedAt = input.pausedAt ?? new Date();
  const pausedUntil = new Date(pausedAt.getTime() + settings.humanTakeoverPauseMinutes * 60 * 1000);

  await prisma.conversationAutomationState.upsert({
    where: {
      conversationId: input.conversationId
    },
    create: {
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      automationPausedUntil: pausedUntil
    },
    update: {
      automationPausedUntil: pausedUntil
    }
  });
}

async function sendAutomatedMessage(input: {
  workspaceId: string;
  conversationId: string;
  to: string;
  body: string;
}) {
  const normalizedBody = input.body.trim();
  if (!normalizedBody) {
    return;
  }

  await enqueueOutboundMessage({
    conversationId: input.conversationId,
    workspaceId: input.workspaceId,
    to: input.to,
    body: normalizedBody,
    source: "automation-engine"
  });
}

async function getOrCreateAutomationSettings(workspaceId: string) {
  const settings =
    (await prisma.workspaceAutomationSettings.findUnique({
      where: {
        workspaceId
      }
    })) ??
    (await prisma.workspaceAutomationSettings.create({
      data: {
        workspaceId,
        timezone: DEFAULT_TIMEZONE,
        awayReplyBody:
          "Thanks for your message. We are currently offline and will reply during business hours.",
        decisionFlowQuestion:
          "Are you interested in this offer? Reply yes or no.",
        decisionFlowYesKeywords: "yes, y, interested, ok, sure",
        decisionFlowNoKeywords: "no, n, later, not interested",
        decisionFlowYesReply:
          "Great. We’ll continue with the next step shortly.",
        decisionFlowNoReply:
          "Understood. We’ll pause here. Message us anytime if you change your mind.",
        decisionFlowFallbackReply:
          "Please reply yes or no so we can route you correctly.",
        propertyFlowPromptPurpose:
          "Hi. Thanks for contacting us. Are you looking to buy, rent, or sell a property?",
        propertyFlowPromptArea: "Thanks. Which area are you interested in?",
        propertyFlowPromptBudget: "Got it. What is your target budget?",
        propertyFlowCompleteReply:
          "Thanks. I’ve captured your property requirements and the team will follow up shortly.",
        businessHoursJson: JSON.stringify([
          { day: 1, enabled: true, start: "09:00", end: "18:00" },
          { day: 2, enabled: true, start: "09:00", end: "18:00" },
          { day: 3, enabled: true, start: "09:00", end: "18:00" },
          { day: 4, enabled: true, start: "09:00", end: "18:00" },
          { day: 5, enabled: true, start: "09:00", end: "18:00" },
          { day: 6, enabled: false, start: "09:00", end: "13:00" },
          { day: 0, enabled: false, start: "00:00", end: "00:00" }
        ])
      }
    }));

  const workflows = await prisma.automationWorkflow.findMany({
    where: { workspaceId },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }]
  });

  const activeWorkflow =
    workflows.find((workflow) => workflow.id === settings.activeWorkflowId) ??
    workflows[0] ??
    null;

  if (settings.activeWorkflowId !== (activeWorkflow?.id ?? null)) {
    await prisma.workspaceAutomationSettings.update({
      where: { workspaceId },
      data: {
        activeWorkflowId: activeWorkflow?.id ?? null
      }
    });
  }

  return {
    ...settings,
    activeWorkflowId: activeWorkflow?.id ?? null,
    workflowDefinitionJson: activeWorkflow?.definitionJson ?? null,
    businessHours: parseBusinessHours(settings.businessHoursJson),
    decisionFlowYesTags: parseCsvList(settings.decisionFlowYesTags),
    decisionFlowNoTags: parseCsvList(settings.decisionFlowNoTags)
  };
}

function matchesRule(
  matchType: AutomationMatchType,
  keyword: string | null,
  inboundText: string,
  regexEnabled: boolean
) {
  if (!keyword) {
    return false;
  }

  const normalizedInbound = normalizeText(inboundText);
  const normalizedKeyword = normalizeText(keyword);

  if (matchType === AutomationMatchType.EXACT) {
    return normalizedInbound === normalizedKeyword;
  }

  if (matchType === AutomationMatchType.REGEX) {
    if (!regexEnabled) {
      return false;
    }

    try {
      return new RegExp(keyword, "i").test(inboundText);
    } catch {
      return false;
    }
  }

  return normalizedInbound.includes(normalizedKeyword);
}

async function advancePropertyFlow(input: {
  workspaceId: string;
  conversationId: string;
  contactId: string;
  contactName: string;
  contactPhone: string;
  inboundText: string;
  settings: Awaited<ReturnType<typeof getOrCreateAutomationSettings>>;
}) {
  const state = await prisma.conversationAutomationState.findUnique({
    where: {
      conversationId: input.conversationId
    }
  });

  if (!state?.activeFlowStep) {
    return false;
  }

  const flowState = parseJsonObject(state.flowStateJson);
  const lead = await ensureAutomationLead({
    workspaceId: input.workspaceId,
    contactId: input.contactId,
    contactName: input.contactName,
    contactPhone: input.contactPhone
  });

  if (state.activeFlowStep === "PURPOSE") {
    const purpose = parsePurpose(input.inboundText);
    if (!purpose) {
      await sendAutomatedMessage({
        workspaceId: input.workspaceId,
        conversationId: input.conversationId,
        to: input.contactPhone,
        body:
          input.settings.propertyFlowPromptPurpose ??
          "Hi. Thanks for contacting us. Are you looking to buy, rent, or sell a property?"
      });
      return true;
    }

    const nextFlowState = { ...flowState, purpose };
    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        project: `${formatPurposeLabel(purpose)} property inquiry`,
        customData: JSON.stringify(nextFlowState),
        lastActivityAt: new Date()
      }
    });

    await prisma.conversationAutomationState.update({
      where: { conversationId: input.conversationId },
      data: {
        activeFlowStep: "AREA",
        flowStateJson: JSON.stringify(nextFlowState)
      }
    });

    await sendAutomatedMessage({
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      to: input.contactPhone,
      body: input.settings.propertyFlowPromptArea
        ?? "Thanks. Which area are you interested in?"
    });
    return true;
  }

  if (state.activeFlowStep === "AREA") {
    const preferredArea = input.inboundText.trim();
    if (!preferredArea) {
      await sendAutomatedMessage({
        workspaceId: input.workspaceId,
        conversationId: input.conversationId,
        to: input.contactPhone,
        body: input.settings.propertyFlowPromptArea
          ?? "Thanks. Which area are you interested in?"
      });
      return true;
    }

    const nextFlowState = { ...flowState, preferredArea };
    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        preferredArea,
        customData: JSON.stringify(nextFlowState),
        lastActivityAt: new Date()
      }
    });

    await prisma.conversationAutomationState.update({
      where: { conversationId: input.conversationId },
      data: {
        activeFlowStep: "BUDGET",
        flowStateJson: JSON.stringify(nextFlowState)
      }
    });

    await sendAutomatedMessage({
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      to: input.contactPhone,
      body: input.settings.propertyFlowPromptBudget
        ?? "Got it. What is your target budget?"
    });
    return true;
  }

  if (state.activeFlowStep === "BUDGET") {
    const budget = parseBudget(input.inboundText);
    if (!budget) {
      await sendAutomatedMessage({
        workspaceId: input.workspaceId,
        conversationId: input.conversationId,
        to: input.contactPhone,
        body: input.settings.propertyFlowPromptBudget
          ?? "Got it. What is your target budget?"
      });
      return true;
    }

    const nextFlowState = { ...flowState, budget };
    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        budget,
        stage: LeadStage.QUALIFIED,
        pipelineStageKey: "qualified",
        customData: JSON.stringify(nextFlowState),
        lastActivityAt: new Date()
      }
    });

    await prisma.conversationAutomationState.update({
      where: { conversationId: input.conversationId },
      data: {
        activeFlowKey: null,
        activeFlowStep: null,
        flowStateJson: JSON.stringify(nextFlowState)
      }
    });

    await sendAutomatedMessage({
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      to: input.contactPhone,
      body: input.settings.propertyFlowCompleteReply
        ?? "Thanks. I've captured your property requirements and the team will follow up shortly."
    });
    return true;
  }

  return false;
}

async function advanceDecisionFlow(input: {
  workspaceId: string;
  conversationId: string;
  contactId: string;
  contactPhone: string;
  contactTags: string | null;
  inboundText: string;
  sentAt: Date;
  settings: Awaited<ReturnType<typeof getOrCreateAutomationSettings>>;
}) {
  const state = await prisma.conversationAutomationState.findUnique({
    where: {
      conversationId: input.conversationId
    }
  });

  if (state?.activeFlowStep !== "AWAITING_DECISION") {
    return false;
  }

  const branch = parseDecisionBranch(
    input.inboundText,
    input.settings.decisionFlowYesKeywords,
    input.settings.decisionFlowNoKeywords
  );

  if (!branch) {
    await sendAutomatedMessage({
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      to: input.contactPhone,
      body:
        input.settings.decisionFlowFallbackReply ??
        "Please reply yes or no so we can route you correctly."
    });

    await prisma.conversationAutomationState.update({
      where: {
        conversationId: input.conversationId
      },
      data: {
        lastAutoReplyAt: input.sentAt
      }
    });

    return true;
  }

  const reply =
    branch === "YES"
      ? input.settings.decisionFlowYesReply
      : input.settings.decisionFlowNoReply;
  const tags =
    branch === "YES"
      ? input.settings.decisionFlowYesTags
      : input.settings.decisionFlowNoTags;

  if (tags.length) {
    await prisma.contact.update({
      where: {
        id: input.contactId
      },
      data: {
        tags: mergeTags(input.contactTags, tags).join(", ")
      }
    });
  }

  if (reply?.trim()) {
    await sendAutomatedMessage({
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      to: input.contactPhone,
      body: reply
    });
  }

  await prisma.conversationAutomationState.update({
    where: {
      conversationId: input.conversationId
    },
    data: {
      activeFlowKey: null,
      activeFlowStep: null,
      flowStateJson: JSON.stringify({ branch }),
      lastAutoReplyAt: input.sentAt
    }
  });

  return true;
}

type StructuredWorkflowDefinition = {
  startStepId: string;
  variables?: Array<{
    key: string;
    type: "text";
    description?: string | null;
  }>;
  steps: StructuredWorkflowStep[];
};

type StructuredWorkflowStep =
  | {
      id: string;
      type: "ask";
      title?: string;
      position?: { x: number; y: number };
      prompt: string;
      saveAs?: string | null;
      nextStepId?: string | null;
    }
  | {
      id: string;
      type: "question" | "choice";
      title?: string;
      position?: { x: number; y: number };
      prompt: string;
      decisionSource?: "currentReply" | "savedValue";
      decisionSourceKey?: string | null;
      maxRetries?: number | null;
      branches: Array<{
        id: string;
        label: string;
        keywords: string[];
        reply?: string | null;
        nextStepId?: string | null;
        tags?: string[];
      }>;
      fallbackReply?: string | null;
      fallbackNextStepId?: string | null;
    }
  | {
      id: string;
      type: "action";
      title?: string;
      position?: { x: number; y: number };
      reply?: string | null;
      tags?: string[];
      assignOwnerId?: string | null;
      leadStage?: string | null;
      nextStepId?: string | null;
    }
  | {
      id: string;
      type: "end";
      title?: string;
      position?: { x: number; y: number };
      reply?: string | null;
      tags?: string[];
    };

type WorkflowBranchHistoryEntry = { stepId: string; branchId: string; label: string; at: string };

async function startStructuredWorkflow(input: {
  workspaceId: string;
  conversationId: string;
  contactId: string;
  contactPhone: string;
  contactTags: string | null;
  sentAt: Date;
  workflow: StructuredWorkflowDefinition | null;
}) {
  if (!input.workflow) {
    return false;
  }

  const startStep = input.workflow.steps.find((step) => step.id === input.workflow?.startStepId);
  if (!startStep) {
    return false;
  }

  await enterStructuredWorkflowStep({
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
    contactId: input.contactId,
    contactPhone: input.contactPhone,
    contactTags: input.contactTags,
    sentAt: input.sentAt,
    workflow: input.workflow,
    step: startStep,
    branchHistory: [],
    answers: {},
    retries: {}
  });

  return true;
}

async function advanceStructuredWorkflow(input: {
  workspaceId: string;
  conversationId: string;
  contactId: string;
  contactPhone: string;
  contactTags: string | null;
  inboundText: string;
  sentAt: Date;
  workflow: StructuredWorkflowDefinition | null;
  settings: Awaited<ReturnType<typeof getOrCreateAutomationSettings>>;
}) {
  if (!input.workflow) {
    return false;
  }

  const state = await prisma.conversationAutomationState.findUnique({
    where: {
      conversationId: input.conversationId
    }
  });

  if (!state?.activeFlowStep) {
    return false;
  }

  const step = input.workflow.steps.find((entry) => entry.id === state.activeFlowStep);
  if (!step || (step.type !== "ask" && step.type !== "question" && step.type !== "choice")) {
    return false;
  }

  const flowState = parseStructuredWorkflowState(state.flowStateJson);
  const branchHistory = flowState.history;
  const answers = { ...flowState.answers };
  const retries = { ...flowState.retries };

  if (step.type === "ask") {
    if (step.saveAs?.trim()) {
      answers[step.saveAs.trim()] = input.inboundText.trim();
    }

    if (step.nextStepId) {
      const nextStep = input.workflow.steps.find((entry) => entry.id === step.nextStepId);
      if (nextStep) {
        await enterStructuredWorkflowStep({
          workspaceId: input.workspaceId,
          conversationId: input.conversationId,
          contactId: input.contactId,
          contactPhone: input.contactPhone,
          contactTags: input.contactTags,
          sentAt: input.sentAt,
          workflow: input.workflow,
          step: nextStep,
          branchHistory,
          answers,
          retries
        });
        return true;
      }
    }

    await prisma.conversationAutomationState.update({
      where: {
        conversationId: input.conversationId
      },
      data: {
        activeFlowKey: null,
        activeFlowStep: null,
        flowStateJson: JSON.stringify({
          history: branchHistory,
          answers,
          retries,
          endedAt: input.sentAt.toISOString(),
          endStepId: step.id
        }),
        lastAutoReplyAt: input.sentAt
      }
    });
    return true;
  }

  const evaluationValue =
    step.decisionSource === "savedValue" && step.decisionSourceKey?.trim()
      ? answers[step.decisionSourceKey.trim()] ?? ""
      : input.inboundText;

  const matchedBranch = step.branches.find((branch) => branchMatches(branch.keywords, evaluationValue));

  if (!matchedBranch) {
    const nextRetries = {
      ...retries,
      [step.id]: (retries[step.id] ?? 0) + 1
    };

    if (step.fallbackReply?.trim()) {
      await sendAutomatedMessage({
        workspaceId: input.workspaceId,
        conversationId: input.conversationId,
        to: input.contactPhone,
        body: step.fallbackReply
      });
    }

    if (step.maxRetries && nextRetries[step.id] >= step.maxRetries) {
      await prisma.conversationAutomationState.update({
        where: {
          conversationId: input.conversationId
        },
        data: {
          activeFlowKey: null,
          activeFlowStep: null,
          flowStateJson: JSON.stringify({
            history: branchHistory,
            answers,
            retries: nextRetries,
            endedAt: input.sentAt.toISOString(),
            endStepId: step.id,
            endReason: "MAX_RETRIES"
          }),
          lastAutoReplyAt: input.sentAt
        }
      });
      return true;
    }

    if (step.fallbackNextStepId) {
      const nextStep = input.workflow.steps.find((entry) => entry.id === step.fallbackNextStepId);
      if (nextStep) {
        await enterStructuredWorkflowStep({
          workspaceId: input.workspaceId,
          conversationId: input.conversationId,
          contactId: input.contactId,
          contactPhone: input.contactPhone,
          contactTags: input.contactTags,
          sentAt: input.sentAt,
          workflow: input.workflow,
          step: nextStep,
          branchHistory,
          answers,
          retries: nextRetries
        });
        return true;
      }
    }

    await prisma.conversationAutomationState.update({
      where: {
        conversationId: input.conversationId
      },
      data: {
        flowStateJson: JSON.stringify({ history: branchHistory, answers, retries: nextRetries }),
        lastAutoReplyAt: input.sentAt
      }
    });
    return true;
  }

  const nextHistory = [
    ...branchHistory,
    {
      stepId: step.id,
      branchId: matchedBranch.id,
        label: matchedBranch.label,
        at: input.sentAt.toISOString()
      }
  ];
  retries[step.id] = 0;

  if (matchedBranch.tags?.length) {
    await prisma.contact.update({
      where: {
        id: input.contactId
      },
      data: {
        tags: mergeTags(input.contactTags, matchedBranch.tags).join(", ")
      }
    });
  }

  if (matchedBranch.reply?.trim()) {
    await sendAutomatedMessage({
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      to: input.contactPhone,
      body: matchedBranch.reply
    });
  }

  if (matchedBranch.nextStepId) {
    const nextStep = input.workflow.steps.find((entry) => entry.id === matchedBranch.nextStepId);
    if (nextStep) {
      await enterStructuredWorkflowStep({
        workspaceId: input.workspaceId,
        conversationId: input.conversationId,
        contactId: input.contactId,
        contactPhone: input.contactPhone,
        contactTags: mergeTags(input.contactTags, matchedBranch.tags ?? []).join(", "),
        sentAt: input.sentAt,
        workflow: input.workflow,
        step: nextStep,
        branchHistory: nextHistory,
        answers,
        retries
      });
      return true;
    }
  }

  await prisma.conversationAutomationState.update({
    where: {
      conversationId: input.conversationId
    },
    data: {
      activeFlowKey: null,
      activeFlowStep: null,
      flowStateJson: JSON.stringify({ history: nextHistory, answers, retries }),
      lastAutoReplyAt: input.sentAt
    }
  });

  return true;
}

async function enterStructuredWorkflowStep(input: {
  workspaceId: string;
  conversationId: string;
  contactId: string;
  contactPhone: string;
  contactTags: string | null;
  sentAt: Date;
  workflow: StructuredWorkflowDefinition;
  step: StructuredWorkflowStep;
  branchHistory: WorkflowBranchHistoryEntry[];
  answers: Record<string, string>;
  retries: Record<string, number>;
}) {
  if (input.step.type === "question" || input.step.type === "choice") {
    if (input.step.decisionSource === "savedValue" && input.step.decisionSourceKey?.trim()) {
      const savedValue = input.answers[input.step.decisionSourceKey.trim()] ?? "";
      const matchedBranch = input.step.branches.find((branch) => branchMatches(branch.keywords, savedValue));

      if (matchedBranch?.tags?.length) {
        await prisma.contact.update({
          where: {
            id: input.contactId
          },
          data: {
            tags: mergeTags(input.contactTags, matchedBranch.tags).join(", ")
          }
        });
      }

      if (matchedBranch?.reply?.trim()) {
        await sendAutomatedMessage({
          workspaceId: input.workspaceId,
          conversationId: input.conversationId,
          to: input.contactPhone,
          body: matchedBranch.reply
        });
      } else if (!matchedBranch && input.step.fallbackReply?.trim()) {
        await sendAutomatedMessage({
          workspaceId: input.workspaceId,
          conversationId: input.conversationId,
          to: input.contactPhone,
          body: input.step.fallbackReply
        });
      }

      const nextHistory = matchedBranch
        ? [
            ...input.branchHistory,
            {
              stepId: input.step.id,
              branchId: matchedBranch.id,
              label: matchedBranch.label,
              at: input.sentAt.toISOString()
            }
          ]
        : input.branchHistory;

      const nextStepId = matchedBranch?.nextStepId ?? input.step.fallbackNextStepId ?? null;
      if (nextStepId) {
        const nextStep = input.workflow.steps.find((entry) => entry.id === nextStepId);
        if (nextStep) {
          await enterStructuredWorkflowStep({
            ...input,
            contactTags: mergeTags(input.contactTags, matchedBranch?.tags ?? []).join(", "),
            step: nextStep,
            branchHistory: nextHistory
          });
          return;
        }
      }

      await prisma.conversationAutomationState.update({
        where: {
          conversationId: input.conversationId
        },
        data: {
          activeFlowKey: null,
          activeFlowStep: null,
          flowStateJson: JSON.stringify({
            history: nextHistory,
            answers: input.answers,
            retries: input.retries,
            endedAt: input.sentAt.toISOString(),
            endStepId: input.step.id
          }),
          lastAutoReplyAt: input.sentAt
        }
      });
      return;
    }

    await sendAutomatedMessage({
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      to: input.contactPhone,
      body: input.step.prompt
    });

    await prisma.conversationAutomationState.update({
      where: {
        conversationId: input.conversationId
      },
      data: {
        activeFlowKey: "CONVERSATION_WORKFLOW",
        activeFlowStep: input.step.id,
        flowStateJson: JSON.stringify({ history: input.branchHistory, answers: input.answers, retries: input.retries }),
        lastAutoReplyAt: input.sentAt
      }
    });
    return;
  }

  if (input.step.type === "ask") {
    await sendAutomatedMessage({
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      to: input.contactPhone,
      body: input.step.prompt
    });

    await prisma.conversationAutomationState.update({
      where: {
        conversationId: input.conversationId
      },
      data: {
        activeFlowKey: "CONVERSATION_WORKFLOW",
        activeFlowStep: input.step.id,
        flowStateJson: JSON.stringify({ history: input.branchHistory, answers: input.answers, retries: input.retries }),
        lastAutoReplyAt: input.sentAt
      }
    });
    return;
  }

  if (input.step.type === "action") {
    const actionStep = input.step;

    if (actionStep.tags?.length) {
      await prisma.contact.update({
        where: {
          id: input.contactId
        },
        data: {
          tags: mergeTags(input.contactTags, actionStep.tags).join(", ")
        }
      });
    }

    if (actionStep.assignOwnerId) {
      await prisma.conversation.update({
        where: {
          id: input.conversationId
        },
        data: {
          assigneeId: actionStep.assignOwnerId
        }
      });
    }

    if (actionStep.leadStage) {
      const lead = await prisma.lead.findFirst({
        where: {
          workspaceId: input.workspaceId,
          contactId: input.contactId
        },
        orderBy: {
          lastActivityAt: "desc"
        },
        select: {
          id: true
        }
      });

      if (lead) {
        await prisma.lead.update({
          where: {
            id: lead.id
          },
          data: {
            stage: mapWorkflowLeadStage(actionStep.leadStage),
            lastActivityAt: input.sentAt
          }
        });
      }
    }

    if (actionStep.reply?.trim()) {
      await sendAutomatedMessage({
        workspaceId: input.workspaceId,
        conversationId: input.conversationId,
        to: input.contactPhone,
        body: actionStep.reply
      });
    }

    if (actionStep.nextStepId) {
      const nextStep = input.workflow.steps.find((entry) => entry.id === actionStep.nextStepId);
      if (nextStep) {
        await enterStructuredWorkflowStep({
          ...input,
          contactTags: mergeTags(input.contactTags, actionStep.tags ?? []).join(", "),
          step: nextStep
        });
        return;
      }
    }

    await prisma.conversationAutomationState.update({
      where: {
        conversationId: input.conversationId
      },
      data: {
        activeFlowKey: null,
        activeFlowStep: null,
        flowStateJson: JSON.stringify({
          history: input.branchHistory,
          answers: input.answers,
          retries: input.retries,
          endedAt: input.sentAt.toISOString(),
          endStepId: actionStep.id
        }),
        lastAutoReplyAt: input.sentAt
      }
    });
    return;
  }

  if (input.step.type === "end" && input.step.tags?.length) {
    await prisma.contact.update({
      where: {
        id: input.contactId
      },
      data: {
        tags: mergeTags(input.contactTags, input.step.tags).join(", ")
      }
    });
  }

  if (input.step.type === "end" && input.step.reply?.trim()) {
    await sendAutomatedMessage({
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      to: input.contactPhone,
      body: input.step.reply
    });
  }

  await prisma.conversationAutomationState.update({
    where: {
      conversationId: input.conversationId
    },
    data: {
      activeFlowKey: null,
      activeFlowStep: null,
      flowStateJson: JSON.stringify({
        history: input.branchHistory,
        answers: input.answers,
        retries: input.retries,
        endedAt: input.sentAt.toISOString(),
        endStepId: input.step.id
      }),
      lastAutoReplyAt: input.sentAt
    }
  });
}

async function ensureAutomationLead(input: {
  workspaceId: string;
  contactId: string;
  contactName: string;
  contactPhone: string;
}) {
  const existing = await prisma.lead.findFirst({
    where: {
      workspaceId: input.workspaceId,
      contactId: input.contactId
    },
    orderBy: {
      lastActivityAt: "desc"
    }
  });

  if (existing) {
    return existing;
  }

  return prisma.lead.create({
    data: {
      workspaceId: input.workspaceId,
      contactId: input.contactId,
      name: input.contactName,
      phone: input.contactPhone,
      source: LeadSource.WEBSITE_CHAT,
      project: "New property inquiry",
      stage: LeadStage.NEW_LEAD,
      pipelineStageKey: "new_lead",
      priority: LeadPriority.MEDIUM,
      lastActivityAt: new Date()
    }
  });
}

function parseBusinessHours(value: string | null) {
  if (!value) {
    return [] as Array<{ day: number; enabled: boolean; start: string; end: string }>;
  }

  try {
    return JSON.parse(value) as Array<{ day: number; enabled: boolean; start: string; end: string }>;
  } catch {
    return [];
  }
}

function isWithinBusinessHours(
  settings: Awaited<ReturnType<typeof getOrCreateAutomationSettings>>,
  date: Date
) {
  const local = new Date(date.toLocaleString("en-US", { timeZone: settings.timezone || DEFAULT_TIMEZONE }));
  const day = local.getDay();
  const hours = `${`${local.getHours()}`.padStart(2, "0")}:${`${local.getMinutes()}`.padStart(2, "0")}`;
  const window = settings.businessHours.find((entry) => entry.day === day);

  if (!window || !window.enabled) {
    return false;
  }

  return hours >= window.start && hours <= window.end;
}

function parseStringArray(value: string | null) {
  if (!value) {
    return [] as string[];
  }

  try {
    const parsed = JSON.parse(value) as string[];
    return parsed.filter((item) => typeof item === "string" && item.trim().length > 0);
  } catch {
    return [];
  }
}

function parseCsvList(value: string | null | undefined) {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseWorkflowDefinition(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as StructuredWorkflowDefinition;
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.steps) || typeof parsed.startStepId !== "string") {
      return null;
    }

    return {
      ...parsed,
      variables: Array.isArray(parsed.variables) ? parsed.variables : []
    };
  } catch {
    return null;
  }
}

function buildDefaultStructuredWorkflowDefinitionJson() {
  return JSON.stringify(
    {
      startStepId: "interest-check",
      variables: [],
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

function parseStructuredWorkflowState(value: string | null) {
  const parsed = parseJsonObject(value);
  const history = parsed.history;
  const answersPayload = parsed.answers;
  const retriesPayload = parsed.retries;

  const normalizedHistory = Array.isArray(history)
    ? history.filter(
        (entry): entry is WorkflowBranchHistoryEntry =>
          Boolean(
            entry &&
              typeof entry === "object" &&
              typeof (entry as { stepId?: unknown }).stepId === "string" &&
              typeof (entry as { branchId?: unknown }).branchId === "string" &&
              typeof (entry as { label?: unknown }).label === "string" &&
              typeof (entry as { at?: unknown }).at === "string"
          )
      )
    : [];

  const normalizedAnswers =
    answersPayload && typeof answersPayload === "object"
      ? Object.fromEntries(
          Object.entries(answersPayload).filter(
            (entry): entry is [string, string] => typeof entry[0] === "string" && typeof entry[1] === "string"
          )
        )
      : {};

  const normalizedRetries =
    retriesPayload && typeof retriesPayload === "object"
      ? Object.fromEntries(
          Object.entries(retriesPayload).filter(
            (entry): entry is [string, number] => typeof entry[0] === "string" && typeof entry[1] === "number"
          )
        )
      : {};

  return {
    history: normalizedHistory,
    answers: normalizedAnswers,
    retries: normalizedRetries
  };
}

function mergeTags(current: string | null, next: string[]) {
  return Array.from(
    new Set(
      [...(current?.split(",").map((tag) => tag.trim()).filter(Boolean) ?? []), ...next].filter(Boolean)
    )
  );
}

function normalizeText(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function parseDecisionBranch(
  inboundText: string,
  yesKeywords: string | null | undefined,
  noKeywords: string | null | undefined
) {
  const normalized = normalizeText(inboundText);
  const yesMatches = parseCsvList(yesKeywords).some((keyword) => {
    const normalizedKeyword = normalizeText(keyword);
    return normalized === normalizedKeyword || normalized.includes(normalizedKeyword);
  });
  const noMatches = parseCsvList(noKeywords).some((keyword) => {
    const normalizedKeyword = normalizeText(keyword);
    return normalized === normalizedKeyword || normalized.includes(normalizedKeyword);
  });

  if (yesMatches && !noMatches) {
    return "YES" as const;
  }

  if (noMatches && !yesMatches) {
    return "NO" as const;
  }

  return null;
}

function branchMatches(keywords: string[] | undefined, inboundText: string) {
  const normalized = normalizeText(inboundText);
  const normalizedKeywords = (keywords ?? []).map((keyword) => normalizeText(keyword)).filter(Boolean);

  if (!normalizedKeywords.length) {
    return false;
  }

  if (normalizedKeywords.includes("*")) {
    return true;
  }

  return normalizedKeywords.some((keyword) => normalized === keyword || normalized.includes(keyword));
}

function minutesBetween(left: Date, right: Date) {
  return Math.round((right.getTime() - left.getTime()) / (1000 * 60));
}

function parseJsonObject(value: string | null) {
  if (!value) {
    return {} as Record<string, unknown>;
  }

  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function parsePurpose(value: string) {
  const normalized = normalizeText(value);
  if (normalized.includes("buy")) {
    return "BUY";
  }
  if (normalized.includes("rent")) {
    return "RENT";
  }
  if (normalized.includes("sell")) {
    return "SELL";
  }
  return null;
}

function formatPurposeLabel(value: string) {
  switch (value) {
    case "BUY":
      return "Buy";
    case "RENT":
      return "Rent";
    case "SELL":
      return "Sell";
    default:
      return "Property";
  }
}

function mapWorkflowLeadStage(value: string) {
  switch (value) {
    case "NEW_LEAD":
    case "QUALIFIED":
    case "SITE_VISIT_BOOKED":
    case "FOLLOW_UP":
    case "NEGOTIATION":
    case "CLOSED_WON":
    case "CLOSED_LOST":
      return value as LeadStage;
    default:
      return LeadStage.FOLLOW_UP;
  }
}

function parseBudget(value: string) {
  const normalized = value.toLowerCase().replace(/,/g, "").trim();
  const match = normalized.match(/(\d+(?:\.\d+)?)(k|m)?/i);
  if (!match) {
    return null;
  }

  const base = Number(match[1]);
  if (!Number.isFinite(base)) {
    return null;
  }

  const suffix = match[2]?.toLowerCase();
  if (suffix === "m") {
    return Math.round(base * 1_000_000);
  }
  if (suffix === "k") {
    return Math.round(base * 1_000);
  }
  return Math.round(base);
}
