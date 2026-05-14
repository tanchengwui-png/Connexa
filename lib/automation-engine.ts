import {
  AgentStatus,
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
import {
  decodeRuleMatcher,
  RULE_MATCH_OPERATORS
} from "@/lib/automation-rule-operators";
import { expireStaleConversationWorkflowIfNeeded } from "@/lib/automation-workflow-timeouts";
import { resolveMediaAssetUrl } from "@/lib/media-library-urls";
import { enqueueOutboundMessage } from "@/lib/outbound-message-jobs";
import { getPlatformAutomationWorkflowConfig } from "@/lib/platform-config";
import { prisma } from "@/lib/prisma";
import {
  normalizeWorkflowContentAttributeKey,
  normalizeWorkflowContentAttributeText,
  normalizeWorkflowTagList,
  parseWorkflowAmount,
  validateNormalizedWorkflowContentAttributeValue
} from "@/lib/workflow-content-attributes";
import { normalizeStoredPhone } from "@/lib/phone";

const DEFAULT_TIMEZONE = "Asia/Kuala_Lumpur";

export async function processInboundAutomation(input: {
  workspaceId: string;
  conversationId: string;
  inboundText: string;
  sentAt: Date;
  ignorePausedState?: boolean;
  includeDisabledRules?: boolean;
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

  const [settings, rules, stateRecord, inboundCount, executions] = await Promise.all([
    getOrCreateAutomationSettings(input.workspaceId),
    prisma.automationRule.findMany({
      where: {
        workspaceId: input.workspaceId,
        ...(input.includeDisabledRules ? {} : { enabled: true })
      },
      include: {
        replyMediaAsset: true,
        followUpMediaAsset: true
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
    }),
    prisma.conversationRuleExecution.findMany({
      where: {
        workspaceId: input.workspaceId,
        conversationId: input.conversationId
      },
      include: {
        rule: {
          select: {
            id: true,
            cooldownMinutes: true
          }
        }
      }
    })
  ]);

  await cancelPendingAutomationJobsOnInbound({
    conversationId: input.conversationId,
    sentAt: input.sentAt
  });

  const state = await expireStaleConversationWorkflowIfNeeded({
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
    state: stateRecord
  });

  if (!input.ignorePausedState && state.automationPausedUntil && state.automationPausedUntil > input.sentAt) {
    return;
  }

  if (settings.workflowFlowEnabled && state.activeFlowKey === "CONVERSATION_WORKFLOW") {
    const flowState = parseStructuredWorkflowState(state.flowStateJson);
    const activeWorkflowRecord = flowState.workflowId
      ? await prisma.automationWorkflow.findFirst({
          where: {
            id: flowState.workflowId,
            workspaceId: input.workspaceId
          },
          select: {
            id: true,
            definitionJson: true
          }
        })
      : null;
    const progressed = await advanceStructuredWorkflow({
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      contactId: conversation.contactId,
      contactPhone: conversation.contact.phone,
      contactTags: conversation.contact.tags,
      inboundText: input.inboundText,
      sentAt: input.sentAt,
      workflowId: activeWorkflowRecord?.id ?? settings.activeWorkflowId,
      workflow: parseWorkflowDefinition(activeWorkflowRecord?.definitionJson ?? settings.workflowDefinitionJson),
      settings
    });

    if (progressed) {
      return;
    }
  }

  const eligibleRules = rules.filter((rule) => {
    if (rule.triggerType === AutomationTriggerType.WELCOME_MESSAGE) {
      return inboundCount === 1;
    }

    return rule.triggerType === AutomationTriggerType.KEYWORD_MATCH;
  });
  const executionMap = new Map(executions.map((execution) => [execution.ruleId, execution] as const));
  const latestExecution = executions.reduce<(typeof executions)[number] | null>((latest, execution) => {
    if (!execution.rule) {
      return latest;
    }

    if (!latest || execution.lastTriggeredAt > latest.lastTriggeredAt) {
      return execution;
    }

    return latest;
  }, null);

  if (
    latestExecution?.rule &&
    minutesBetween(latestExecution.lastTriggeredAt, input.sentAt) < latestExecution.rule.cooldownMinutes
  ) {
    return;
  }

  let matchedRule = false;
  const mediaAssetIds = Array.from(
    new Set(
      rules.flatMap((rule) => [
        ...parseMediaAssetIds(rule.replyMediaAssetIdsJson, rule.replyMediaAssetId),
        ...parseMediaAssetIds(rule.followUpMediaAssetIdsJson, rule.followUpMediaAssetId)
      ])
    )
  );
  const mediaAssetMap =
    mediaAssetIds.length > 0
      ? new Map(
          (
            await prisma.workspaceMediaAsset.findMany({
              where: {
                workspaceId: input.workspaceId,
                id: { in: mediaAssetIds }
              }
            })
          ).map((asset) => [asset.id, asset] as const)
        )
      : new Map();

  for (const rule of eligibleRules) {
    if (rule.businessHoursOnly && !isWithinBusinessHours(settings, input.sentAt)) {
      continue;
    }

    if (
      rule.triggerType === AutomationTriggerType.KEYWORD_MATCH &&
      !matchesRule({
        matchType: rule.matchType,
        keyword: rule.keyword,
        inboundText: input.inboundText,
        inboundCount,
        sentAt: input.sentAt,
        settings
      })
    ) {
      continue;
    }

    const execution = executionMap.get(rule.id) ?? null;

    if (execution && minutesBetween(execution.lastTriggeredAt, input.sentAt) < rule.cooldownMinutes) {
      continue;
    }

    matchedRule = true;

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

    const replyMediaAssets = parseMediaAssetIds(rule.replyMediaAssetIdsJson, rule.replyMediaAssetId)
      .map((assetId) => mediaAssetMap.get(assetId))
      .filter(Boolean);

    if (rule.replyBody.trim()) {
      await sendAutomatedMessage({
        workspaceId: input.workspaceId,
        conversationId: input.conversationId,
        to: conversation.contact.phone,
        body: rule.replyBody,
        attachmentMimeType: null,
        attachmentName: null,
        attachmentUrl: null
      });
    }

    if (replyMediaAssets[0]) {
      await sendAutomatedMediaMessages({
        workspaceId: input.workspaceId,
        conversationId: input.conversationId,
        to: conversation.contact.phone,
        mediaAssets: replyMediaAssets
      });
    }

    if (rule.workflowId && !state.activeFlowKey) {
      const workflowRecord = await prisma.automationWorkflow.findFirst({
        where: {
          id: rule.workflowId,
          workspaceId: input.workspaceId
        },
        select: {
          id: true,
          definitionJson: true
        }
      });

      const started = workflowRecord
        ? await startStructuredWorkflow({
            workspaceId: input.workspaceId,
            conversationId: input.conversationId,
            contactId: conversation.contactId,
            contactPhone: conversation.contact.phone,
            contactTags: conversation.contact.tags,
            sentAt: input.sentAt,
            workflowId: workflowRecord.id,
            workflow: parseWorkflowDefinition(workflowRecord.definitionJson)
          })
        : false;

      if (started) {
        state.activeFlowKey = "CONVERSATION_WORKFLOW";
      }
    }

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

    const followUpMediaAssets = parseMediaAssetIds(rule.followUpMediaAssetIdsJson, rule.followUpMediaAssetId)
      .map((assetId) => mediaAssetMap.get(assetId))
      .filter(Boolean);

    if (rule.followUpDelayMinutes && (rule.followUpReplyBody?.trim() || followUpMediaAssets.length)) {
      const followUpBody = rule.followUpReplyBody?.trim() ?? null;

      await prisma.automationJob.create({
        data: {
          workspaceId: input.workspaceId,
          conversationId: input.conversationId,
          ruleId: rule.id,
          jobType: AutomationJobType.FOLLOW_UP_MESSAGE,
          status: AutomationJobStatus.PENDING,
          runAt: new Date(input.sentAt.getTime() + rule.followUpDelayMinutes * 60 * 1000),
          payloadJson: JSON.stringify({
            kind: "rule-follow-up",
            scheduledFrom: input.sentAt.toISOString(),
            cancelOnInbound: true,
            body: followUpBody,
            attachments: followUpMediaAssets.map((asset) => ({
              mimeType: asset!.mimeType,
              name: asset!.title,
              url: resolveMediaAssetUrl(asset!.publicUrl)
            }))
          })
        }
      });
    }

    break;
  }

  if (!matchedRule && settings.businessHoursEnabled && settings.awayReplyEnabled && !isWithinBusinessHours(settings, input.sentAt)) {
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

export async function processPendingAutomationJobs(limit = 10, workspaceId?: string) {
  const dueJobs = await prisma.automationJob.findMany({
    where: {
      ...(workspaceId ? { workspaceId } : {}),
      status: AutomationJobStatus.PENDING,
      runAt: {
        lte: new Date()
      }
    },
    orderBy: [{ runAt: "asc" }, { createdAt: "asc" }],
    take: limit
  });

  let claimed = 0;
  let sent = 0;
  let failed = 0;
  let canceled = 0;
  let rescheduled = 0;

  for (const job of dueJobs) {
    const claim = await prisma.automationJob.updateMany({
      where: {
        id: job.id,
        status: AutomationJobStatus.PENDING
      },
      data: {
        status: AutomationJobStatus.RUNNING,
        attempts: {
          increment: 1
        },
        lastError: null
      }
    });

    if (claim.count === 0) {
      continue;
    }

    claimed += 1;

    const runningJob = await prisma.automationJob.findUnique({
      where: {
        id: job.id
      }
    });

    if (!runningJob) {
      continue;
    }

    try {
      const payload = parseAutomationJobPayload(runningJob.payloadJson);

      if (payload.kind === "workflow-delay") {
        const outcome = await processWorkflowDelayJob(runningJob, payload);
        if (outcome === "sent") {
          sent += 1;
        } else if (outcome === "canceled") {
          canceled += 1;
        } else if (outcome === "rescheduled") {
          rescheduled += 1;
        }
        continue;
      }

      if (payload.kind === "workflow-wait-timeout") {
        const outcome = await processWorkflowWaitTimeoutJob(runningJob, payload);
        if (outcome === "sent") {
          sent += 1;
        } else if (outcome === "canceled") {
          canceled += 1;
        } else if (outcome === "rescheduled") {
          rescheduled += 1;
        }
        continue;
      }

      if (shouldCancelRuleFollowUpOnReply(payload)) {
        const inboundAfterSchedule = await prisma.message.findFirst({
          where: {
            conversationId: runningJob.conversationId,
            direction: MessageDirection.INBOUND,
            sentAt: {
              gt: getRuleFollowUpScheduledFrom(runningJob, payload)
            }
          },
          select: {
            id: true
          }
        });

        if (inboundAfterSchedule) {
          await prisma.automationJob.update({
            where: {
              id: runningJob.id
            },
            data: {
              status: AutomationJobStatus.CANCELED,
              lastError: "Canceled because the contact replied before the follow-up was sent."
            }
          });
          canceled += 1;
          continue;
        }
      }

      const body = payload.body?.trim();
      if (!body && !payload.attachmentUrl && !payload.attachments?.length) {
        await prisma.automationJob.update({
          where: {
            id: runningJob.id
          },
          data: {
            status: AutomationJobStatus.CANCELED,
            lastError: "Automation job payload did not include a message body or media."
          }
        });
        canceled += 1;
        continue;
      }

      const conversation = await prisma.conversation.findFirst({
        where: {
          id: runningJob.conversationId,
          workspaceId: runningJob.workspaceId
        },
        include: {
          contact: true
        }
      });

      if (!conversation) {
        await prisma.automationJob.update({
          where: {
            id: runningJob.id
          },
          data: {
            status: AutomationJobStatus.CANCELED,
            lastError: "Conversation not found."
          }
        });
        canceled += 1;
        continue;
      }

      await sendAutomatedMessage({
        workspaceId: runningJob.workspaceId,
        conversationId: runningJob.conversationId,
        to: conversation.contact.phone,
        body: body ?? "",
        attachmentMimeType: payload.attachmentMimeType ?? null,
        attachmentName: payload.attachmentName ?? null,
        attachmentUrl: payload.attachmentUrl ?? null
      });

      if (payload.attachments?.length) {
        const remainingAttachments = body && payload.attachmentUrl ? payload.attachments.slice(1) : payload.attachments;
        await sendAutomatedAttachmentPayloads({
          workspaceId: runningJob.workspaceId,
          conversationId: runningJob.conversationId,
          to: conversation.contact.phone,
          attachments: remainingAttachments
        });
      }

      await prisma.automationJob.update({
        where: {
          id: runningJob.id
        },
        data: {
          status: AutomationJobStatus.SENT,
          lastError: null
        }
      });

      sent += 1;
    } catch (error) {
      const isExhausted = runningJob.attempts >= 3;
      const retryDelayMinutes = Math.min(30, Math.max(1, runningJob.attempts * 2));

      await prisma.automationJob.update({
        where: {
          id: runningJob.id
        },
        data: {
          status: isExhausted ? AutomationJobStatus.FAILED : AutomationJobStatus.PENDING,
          lastError: error instanceof Error ? error.message : "Unable to process automation job.",
          runAt: isExhausted ? runningJob.runAt : new Date(Date.now() + retryDelayMinutes * 60 * 1000)
        }
      });

      failed += 1;
    }
  }

  return {
    fetched: dueJobs.length,
    claimed,
    sent,
    failed,
    canceled,
    rescheduled
  };
}

async function sendAutomatedMessage(input: {
  workspaceId: string;
  conversationId: string;
  to: string;
  body: string;
  attachmentMimeType?: string | null;
  attachmentName?: string | null;
  attachmentUrl?: string | null;
}) {
  const normalizedBody = input.body.trim();
  if (!normalizedBody && !input.attachmentUrl) {
    return;
  }

  await enqueueOutboundMessage({
    conversationId: input.conversationId,
    workspaceId: input.workspaceId,
    to: input.to,
    body: normalizedBody,
    attachmentMimeType: input.attachmentMimeType ?? null,
    attachmentName: input.attachmentName ?? null,
    attachmentUrl: input.attachmentUrl ?? null,
    source: "automation-engine"
  });
}

async function resolveOrderedWorkflowMediaAssets(workspaceId: string, mediaAssetIds: string[]) {
  if (!mediaAssetIds.length) {
    return [] as Array<{ mimeType: string; title: string; originalName: string; publicUrl: string }>;
  }

  const mediaAssets = await prisma.workspaceMediaAsset.findMany({
    where: {
      workspaceId,
      id: {
        in: mediaAssetIds
      }
    },
    select: {
      id: true,
      mimeType: true,
      title: true,
      originalName: true,
      publicUrl: true
    }
  });
  const mediaAssetMap = new Map(mediaAssets.map((asset) => [asset.id, asset] as const));

  return mediaAssetIds.map((mediaAssetId) => mediaAssetMap.get(mediaAssetId)).filter(Boolean) as Array<{
    mimeType: string;
    title: string;
    originalName: string;
    publicUrl: string;
  }>;
}

async function resolveOrderedWorkflowMediaItems(
  workspaceId: string,
  mediaItems: StructuredWorkflowMediaItem[]
) {
  const mediaAssetIds = mediaItems.map((item) => item.mediaAssetId);
  const mediaAssets = await resolveOrderedWorkflowMediaAssets(workspaceId, mediaAssetIds);

  return mediaItems
    .map((item, index) => {
      const mediaAsset = mediaAssets[index];
      if (!mediaAsset) {
        return null;
      }

      return {
        ...mediaAsset,
        message: item.message?.trim() ?? ""
      };
    })
    .filter(Boolean) as Array<{ mimeType: string; title: string; originalName: string; publicUrl: string; message: string }>;
}

async function sendAutomatedMediaMessages(input: {
  workspaceId: string;
  conversationId: string;
  to: string;
  mediaAssets: Array<{ mimeType: string; title: string; originalName: string; publicUrl: string; message?: string | null }>;
}) {
  for (const asset of input.mediaAssets) {
    await sendAutomatedMessage({
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      to: input.to,
      body: asset.message?.trim() ?? "",
      attachmentMimeType: asset.mimeType,
      attachmentName: asset.originalName || asset.title,
      attachmentUrl: resolveMediaAssetUrl(asset.publicUrl)
    });
  }
}

async function sendAutomatedAttachmentPayloads(input: {
  workspaceId: string;
  conversationId: string;
  to: string;
  attachments: Array<{ mimeType?: string | null; name?: string | null; url?: string | null }>;
}) {
  for (const attachment of input.attachments) {
    if (!attachment.url) {
      continue;
    }

    await sendAutomatedMessage({
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      to: input.to,
      body: "",
      attachmentMimeType: attachment.mimeType ?? null,
      attachmentName: attachment.name ?? null,
      attachmentUrl: attachment.url
    });
  }
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

  const activeWorkflowIds = getStoredActiveWorkflowIds(
    settings.activeWorkflowId,
    workflows.map((workflow) => workflow.id)
  );
  const activeWorkflow = activeWorkflowIds.length
    ? workflows.find((workflow) => workflow.id === activeWorkflowIds[0]) ?? null
    : null;
  const storedActiveWorkflowId = serializeStoredActiveWorkflowIds(activeWorkflowIds);

  if ((settings.activeWorkflowId ?? null) !== storedActiveWorkflowId) {
    await prisma.workspaceAutomationSettings.update({
      where: { workspaceId },
      data: {
        activeWorkflowId: storedActiveWorkflowId
      }
    });
  }

  return {
    ...settings,
    activeWorkflowIds,
    activeWorkflowId: activeWorkflow?.id ?? null,
    workflowDefinitionJson: activeWorkflow?.definitionJson ?? null,
    businessHours: parseBusinessHours(settings.businessHoursJson),
    decisionFlowYesTags: parseCsvList(settings.decisionFlowYesTags),
    decisionFlowNoTags: parseCsvList(settings.decisionFlowNoTags)
  };
}

function matchesRule(input: {
  matchType: AutomationMatchType;
  keyword: string | null;
  inboundText: string;
  inboundCount: number;
  sentAt: Date;
  settings: Awaited<ReturnType<typeof getOrCreateAutomationSettings>>;
}) {
  const matcher = decodeRuleMatcher(input.matchType, input.keyword);
  const normalizedInbound = normalizeText(input.inboundText);
  const normalizedValue = normalizeText(matcher.value);

  switch (matcher.operator) {
    case RULE_MATCH_OPERATORS.EXACTLY_MATCHES:
      return Boolean(normalizedValue) && normalizedInbound === normalizedValue;
    case RULE_MATCH_OPERATORS.STARTS_WITH:
      return Boolean(normalizedValue) && normalizedInbound.startsWith(normalizedValue);
    case RULE_MATCH_OPERATORS.ENDS_WITH:
      return Boolean(normalizedValue) && normalizedInbound.endsWith(normalizedValue);
    case RULE_MATCH_OPERATORS.CONTAINS_ANY_WORDS:
      return parseMatcherList(matcher.value).some((value) => normalizedInbound.includes(normalizeText(value)));
    case RULE_MATCH_OPERATORS.HAS_NUMBER:
      return /\d/.test(input.inboundText);
    case RULE_MATCH_OPERATORS.HAS_PHONE_NUMBER:
      return hasPhoneNumber(input.inboundText);
    case RULE_MATCH_OPERATORS.HAS_EMAIL:
      return hasEmailAddress(input.inboundText);
    case RULE_MATCH_OPERATORS.MESSAGE_LANGUAGE_IS:
      return matchesLanguage(input.inboundText, matcher.value);
    case RULE_MATCH_OPERATORS.CUSTOMER_HAS_NOT_REPLIED_BEFORE:
      return input.inboundCount <= 1;
    case RULE_MATCH_OPERATORS.OUTSIDE_BUSINESS_HOURS:
      return !isWithinBusinessHours(input.settings, input.sentAt);
    case RULE_MATCH_OPERATORS.REGEX:
      if (!input.keyword) {
        return false;
      }

      try {
        return new RegExp(input.keyword, "i").test(input.inboundText);
      } catch {
        return false;
      }
    case RULE_MATCH_OPERATORS.CONTAINS_WORD:
    default:
      return Boolean(normalizedValue) && normalizedInbound.includes(normalizedValue);
  }
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

    const nextFlowState = {
      ...flowState,
      industryType: "PROPERTY",
      project: `${formatPurposeLabel(purpose)} property inquiry`,
      purpose
    };
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

    const nextFlowState = { ...flowState, industryType: "PROPERTY", preferredArea };
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
    const budget = parseWorkflowAmount(input.inboundText);
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

    const nextFlowState = { ...flowState, industryType: "PROPERTY", budget: String(budget) };
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

type StructuredWorkflowMediaItem = {
  mediaAssetId: string;
  message?: string | null;
};

type StructuredWorkflowStep =
  | {
      id: string;
      type: "ask";
      title?: string;
      position?: { x: number; y: number };
      prompt: string;
      saveAs?: string | null;
      expiresAfterMinutes?: number | null;
      onTimeoutStepId?: string | null;
      nextStepId?: string | null;
    }
  | {
      id: string;
      type: "question" | "choice";
      title?: string;
      position?: { x: number; y: number };
      prompt: string;
      saveAs?: string | null;
      nextStepId?: string | null;
      decisionSource?: "currentReply" | "savedValue";
      decisionSourceKey?: string | null;
      maxRetries?: number | null;
      expiresAfterMinutes?: number | null;
      onTimeoutStepId?: string | null;
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
      notifyAssignedOwner?: boolean;
      notifyAgentIds?: string[];
      notifyMessage?: string | null;
      leadStage?: string | null;
      nextStepId?: string | null;
    }
  | {
      id: string;
      type: "reply";
      title?: string;
      position?: { x: number; y: number };
      reply?: string | null;
      emoji?: string | null;
      mediaAssetIds?: string[];
      mediaItems?: StructuredWorkflowMediaItem[];
      nextStepId?: string | null;
    }
  | {
      id: string;
      type: "update";
      title?: string;
      position?: { x: number; y: number };
      tags?: string[];
      assignOwnerId?: string | null;
      notifyAssignedOwner?: boolean;
      notifyAgentIds?: string[];
      notifyMessage?: string | null;
      assignmentMode?: "none" | "fixed" | "round_robin";
      roundRobinAgentIds?: string[];
      overwriteExistingOwner?: boolean;
      leadStage?: string | null;
      leadAttributeKey?: string | null;
      leadAttributeValue?: string | null;
      leadAttributeValueSource?: "literal" | "savedValue";
      leadAttributeValueKey?: string | null;
      leadCustomAttributeKey?: string | null;
      nextStepId?: string | null;
    }
  | {
      id: string;
      type: "delay";
      title?: string;
      position?: { x: number; y: number };
      delayMinutes?: number | null;
      businessHoursOnly?: boolean;
      cancelOnInbound?: boolean;
      cancelOnHumanReply?: boolean;
      nextStepId?: string | null;
    }
  | {
      id: string;
      type: "go_to";
      title?: string;
      position?: { x: number; y: number };
      targetStepId?: string | null;
    }
  | {
      id: string;
      type: "end";
      title?: string;
      position?: { x: number; y: number };
      reply?: string | null;
      tags?: string[];
    };

type StructuredWorkflowWaitingStep =
  | Extract<StructuredWorkflowStep, { type: "ask" }>
  | Extract<StructuredWorkflowStep, { type: "question" | "choice" }>;

type WorkflowBranchHistoryEntry = { stepId: string; branchId: string; label: string; at: string };
function renderWorkflowReplyTemplate(template: string | null | undefined, answers: Record<string, string>) {
  if (!template) {
    return "";
  }

  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key: string) => answers[key] ?? "");
}

function clampWorkflowWaitTimeoutMinutes(value: number | null | undefined) {
  if (!Number.isFinite(value)) {
    return null;
  }

  const rounded = Math.round(value as number);
  if (rounded <= 0) {
    return null;
  }

  return Math.min(60 * 24 * 30, rounded);
}

async function setStructuredWorkflowWaitingState(input: {
  workspaceId: string;
  conversationId: string;
  workflowId: string | null;
  step: StructuredWorkflowWaitingStep;
  branchHistory: WorkflowBranchHistoryEntry[];
  answers: Record<string, string>;
  retries: Record<string, number>;
  continuationStepIds: string[];
  sentAt: Date;
}) {
  const waitingAt = input.sentAt.toISOString();
  await prisma.conversationAutomationState.update({
    where: {
      conversationId: input.conversationId
    },
    data: {
      activeFlowKey: "CONVERSATION_WORKFLOW",
      activeFlowStep: input.step.id,
      flowStateJson: JSON.stringify({
        workflowId: input.workflowId,
        history: input.branchHistory,
        answers: input.answers,
        retries: input.retries,
        continuationStepIds: input.continuationStepIds,
        waitingAt,
        waitingFor: "reply"
      }),
      lastAutoReplyAt: input.sentAt
    }
  });

  const workflowTimeoutConfig = await getPlatformAutomationWorkflowConfig();
  const expiresAfterMinutes =
    clampWorkflowWaitTimeoutMinutes(input.step.expiresAfterMinutes) ??
    workflowTimeoutConfig.expireAfterHours * 60;
  if (!expiresAfterMinutes) {
    return;
  }

  await prisma.automationJob.create({
    data: {
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      jobType: AutomationJobType.FOLLOW_UP_MESSAGE,
      status: AutomationJobStatus.PENDING,
      runAt: new Date(input.sentAt.getTime() + expiresAfterMinutes * 60 * 1000),
      payloadJson: JSON.stringify({
        kind: "workflow-wait-timeout",
        workflowId: input.workflowId,
        stepId: input.step.id,
        onTimeoutStepId: input.step.onTimeoutStepId ?? null,
        scheduledFrom: waitingAt
      })
    }
  });
}

async function sendWorkflowTeamNotifications(input: {
  workspaceId: string;
  sourceConversationId: string;
  sourceContactId: string;
  sourceContactPhone: string;
  stepId: string;
  stepTitle?: string;
  notifyAssignedOwner?: boolean;
  notifyAgentIds?: string[];
  notifyMessage?: string | null;
  assignedOwnerId?: string | null;
  answers: Record<string, string>;
  sentAt: Date;
}) {
  const selectedAgentIds = normalizeWorkflowRoundRobinAgentIds(input.notifyAgentIds);
  const requestedAgentIds = new Set<string>(selectedAgentIds);
  if (input.notifyAssignedOwner && input.assignedOwnerId?.trim()) {
    requestedAgentIds.add(input.assignedOwnerId.trim());
  }

  const notifyMessage = input.notifyMessage?.trim();
  if (!requestedAgentIds.size || !notifyMessage) {
    return;
  }

  const [sourceContact, latestInboundMessage, agents] = await Promise.all([
    prisma.contact.findFirst({
      where: {
        id: input.sourceContactId,
        workspaceId: input.workspaceId
      },
      select: {
        displayName: true,
        phone: true
      }
    }),
    prisma.message.findFirst({
      where: {
        conversationId: input.sourceConversationId,
        direction: MessageDirection.INBOUND,
        deletedAt: null
      },
      orderBy: {
        sentAt: "desc"
      },
      select: {
        body: true
      }
    }),
    prisma.agent.findMany({
      where: {
        workspaceId: input.workspaceId,
        status: AgentStatus.ACTIVE,
        id: {
          in: Array.from(requestedAgentIds)
        }
      },
      select: {
        id: true,
        name: true,
        phone: true
      }
    })
  ]);

  if (!agents.length) {
    return;
  }

  const templateValues = {
    name: sourceContact?.displayName?.trim() || input.answers.name || "",
    phone: sourceContact?.phone?.trim() || input.sourceContactPhone,
    currentReply: latestInboundMessage?.body?.trim() || "",
    workflowStep: input.stepTitle?.trim() || input.stepId,
    ...input.answers
  };

  const messageBody = renderWorkflowReplyTemplate(notifyMessage, templateValues).trim();
  if (!messageBody) {
    return;
  }

  for (const agent of agents) {
    const agentPhone = agent.phone ? normalizeStoredPhone(agent.phone) : "";
    if (!agentPhone) {
      continue;
    }

    const contact = await prisma.contact.upsert({
      where: {
        workspaceId_phone: {
          workspaceId: input.workspaceId,
          phone: agentPhone
        }
      },
      update: {
        displayName: agent.name,
        ownerId: agent.id,
        lastInteractionAt: input.sentAt
      },
      create: {
        workspaceId: input.workspaceId,
        displayName: agent.name,
        phone: agentPhone,
        ownerId: agent.id,
        tags: "team, whatsapp",
        lastInteractionAt: input.sentAt
      },
      select: {
        id: true
      }
    });

    const conversation =
      (await prisma.conversation.findFirst({
        where: {
          workspaceId: input.workspaceId,
          contactId: contact.id
        },
        orderBy: {
          updatedAt: "desc"
        },
        select: {
          id: true
        }
      })) ??
      (await prisma.conversation.create({
        data: {
          workspaceId: input.workspaceId,
          contactId: contact.id,
          assigneeId: agent.id,
          status: ConversationStatus.OPEN,
          lastMessageAt: input.sentAt
        },
        select: {
          id: true
        }
      }));

    await enqueueOutboundMessage({
      workspaceId: input.workspaceId,
      conversationId: conversation.id,
      to: agentPhone,
      body: messageBody,
      source: "automation-engine"
    });
  }
}

const WORKFLOW_END_ID = "workflow-end";

function resolveWorkflowBranchNextStepId(
  branchNextStepId: string | null | undefined,
  sharedNextStepId: string | null | undefined,
  fallbackNextStepId?: string | null
) {
  const normalizedBranchNextStepId = branchNextStepId?.trim() || null;
  const normalizedSharedNextStepId = sharedNextStepId?.trim() || null;
  const normalizedFallbackNextStepId = fallbackNextStepId?.trim() || null;

  if (normalizedBranchNextStepId && normalizedBranchNextStepId !== WORKFLOW_END_ID) {
    return normalizedBranchNextStepId;
  }

  if (normalizedSharedNextStepId && normalizedSharedNextStepId !== WORKFLOW_END_ID) {
    return normalizedSharedNextStepId;
  }

  if (normalizedBranchNextStepId === WORKFLOW_END_ID) {
    return WORKFLOW_END_ID;
  }

  if (normalizedFallbackNextStepId && normalizedFallbackNextStepId !== WORKFLOW_END_ID) {
    return normalizedFallbackNextStepId;
  }

  return normalizedFallbackNextStepId === WORKFLOW_END_ID ? WORKFLOW_END_ID : null;
}

function normalizeWorkflowContinuationStepIds(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function getWorkflowSharedContinuationStepId(nextStepId: string | null | undefined) {
  const normalizedNextStepId = nextStepId?.trim() || null;
  return normalizedNextStepId && normalizedNextStepId !== WORKFLOW_END_ID ? normalizedNextStepId : null;
}

function getWorkflowBranchExecutionPlan(input: {
  branchNextStepId: string | null | undefined;
  sharedNextStepId: string | null | undefined;
  continuationStepIds: string[];
}) {
  const normalizedBranchNextStepId = input.branchNextStepId?.trim() || null;
  const sharedContinuationStepId = getWorkflowSharedContinuationStepId(input.sharedNextStepId);

  if (normalizedBranchNextStepId && normalizedBranchNextStepId !== WORKFLOW_END_ID) {
    return {
      nextStepId: normalizedBranchNextStepId,
      continuationStepIds: sharedContinuationStepId
        ? [sharedContinuationStepId, ...input.continuationStepIds]
        : input.continuationStepIds
    };
  }

  return {
    nextStepId: resolveWorkflowBranchNextStepId(normalizedBranchNextStepId, input.sharedNextStepId),
    continuationStepIds: input.continuationStepIds
  };
}

function resolveWorkflowContinuationFallback(input: {
  workflow: StructuredWorkflowDefinition;
  continuationStepIds: string[];
}) {
  if (!input.continuationStepIds.length) {
    return null;
  }

  const [continuationStepId, ...remainingContinuationStepIds] = input.continuationStepIds;
  const continuationStep = input.workflow.steps.find((entry) => entry.id === continuationStepId);
  if (!continuationStep) {
    return null;
  }

  return {
    step: continuationStep,
    continuationStepIds: remainingContinuationStepIds
  };
}

async function startStructuredWorkflow(input: {
  workspaceId: string;
  conversationId: string;
  contactId: string;
  contactPhone: string;
  contactTags: string | null;
  sentAt: Date;
  workflowId: string | null;
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
    workflowId: input.workflowId,
    workflow: input.workflow,
    step: startStep,
    branchHistory: [],
    answers: {},
    retries: {},
    continuationStepIds: []
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
  workflowId: string | null;
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
  const continuationStepIds = [...flowState.continuationStepIds];

  if (step.saveAs?.trim()) {
    answers[step.saveAs.trim()] = input.inboundText.trim();
  }

  if (step.type === "ask") {
    if (step.nextStepId && step.nextStepId !== WORKFLOW_END_ID) {
      const nextStep = input.workflow.steps.find((entry) => entry.id === step.nextStepId);
      if (nextStep) {
        await enterStructuredWorkflowStep({
          workspaceId: input.workspaceId,
          conversationId: input.conversationId,
          contactId: input.contactId,
          contactPhone: input.contactPhone,
          contactTags: input.contactTags,
          sentAt: input.sentAt,
          workflowId: input.workflowId,
          workflow: input.workflow,
          step: nextStep,
          branchHistory,
          answers,
          retries,
          continuationStepIds
        });
        return true;
      }
    }

    if (step.nextStepId === WORKFLOW_END_ID || !step.nextStepId) {
      const continuationFallback = resolveWorkflowContinuationFallback({
        workflow: input.workflow,
        continuationStepIds
      });
      if (continuationFallback) {
        await enterStructuredWorkflowStep({
          workspaceId: input.workspaceId,
          conversationId: input.conversationId,
          contactId: input.contactId,
          contactPhone: input.contactPhone,
          contactTags: input.contactTags,
          sentAt: input.sentAt,
          workflowId: input.workflowId,
          workflow: input.workflow,
          step: continuationFallback.step,
          branchHistory,
          answers,
          retries,
          continuationStepIds: continuationFallback.continuationStepIds
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
          continuationStepIds,
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
        body: renderWorkflowReplyTemplate(step.fallbackReply, answers)
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
            continuationStepIds,
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
          workflowId: input.workflowId,
          workflow: input.workflow,
          step: nextStep,
          branchHistory,
          answers,
          retries: nextRetries,
          continuationStepIds
        });
        return true;
      }
    }

    await setStructuredWorkflowWaitingState({
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      workflowId: input.workflowId,
      step,
      branchHistory,
      answers,
      retries: nextRetries,
      continuationStepIds,
      sentAt: input.sentAt
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
      body: renderWorkflowReplyTemplate(matchedBranch.reply, answers)
    });
  }

  const branchExecutionPlan = getWorkflowBranchExecutionPlan({
    branchNextStepId: matchedBranch.nextStepId,
    sharedNextStepId: step.nextStepId,
    continuationStepIds
  });
  const nextStepId = branchExecutionPlan.nextStepId;
  if (nextStepId) {
    const nextStep = input.workflow.steps.find((entry) => entry.id === nextStepId);
    if (nextStep) {
      await enterStructuredWorkflowStep({
        workspaceId: input.workspaceId,
        conversationId: input.conversationId,
        contactId: input.contactId,
        contactPhone: input.contactPhone,
        contactTags: mergeTags(input.contactTags, matchedBranch.tags ?? []).join(", "),
        sentAt: input.sentAt,
        workflowId: input.workflowId,
        workflow: input.workflow,
        step: nextStep,
        branchHistory: nextHistory,
        answers,
        retries,
        continuationStepIds: branchExecutionPlan.continuationStepIds
      });
      return true;
    }
  }

  if (branchExecutionPlan.continuationStepIds.length) {
    const [continuationStepId, ...remainingContinuationStepIds] = branchExecutionPlan.continuationStepIds;
    const continuationStep = input.workflow.steps.find((entry) => entry.id === continuationStepId);
    if (continuationStep) {
      await enterStructuredWorkflowStep({
        workspaceId: input.workspaceId,
        conversationId: input.conversationId,
        contactId: input.contactId,
        contactPhone: input.contactPhone,
        contactTags: mergeTags(input.contactTags, matchedBranch.tags ?? []).join(", "),
        sentAt: input.sentAt,
        workflowId: input.workflowId,
        workflow: input.workflow,
        step: continuationStep,
        branchHistory: nextHistory,
        answers,
        retries,
        continuationStepIds: remainingContinuationStepIds
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
      flowStateJson: JSON.stringify({ history: nextHistory, answers, retries, continuationStepIds: branchExecutionPlan.continuationStepIds }),
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
  workflowId: string | null;
  workflow: StructuredWorkflowDefinition;
  step: StructuredWorkflowStep;
  branchHistory: WorkflowBranchHistoryEntry[];
  answers: Record<string, string>;
  retries: Record<string, number>;
  continuationStepIds: string[];
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
          body: renderWorkflowReplyTemplate(matchedBranch.reply, input.answers)
        });
      } else if (!matchedBranch && input.step.fallbackReply?.trim()) {
        await sendAutomatedMessage({
          workspaceId: input.workspaceId,
          conversationId: input.conversationId,
          to: input.contactPhone,
          body: renderWorkflowReplyTemplate(input.step.fallbackReply, input.answers)
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

      const branchExecutionPlan = matchedBranch
        ? getWorkflowBranchExecutionPlan({
            branchNextStepId: matchedBranch.nextStepId,
            sharedNextStepId: input.step.nextStepId,
            continuationStepIds: input.continuationStepIds
          })
        : {
            nextStepId: input.step.nextStepId ?? input.step.fallbackNextStepId ?? null,
            continuationStepIds: input.continuationStepIds
          };
      const nextStepId = branchExecutionPlan.nextStepId;
      if (nextStepId) {
        const nextStep = input.workflow.steps.find((entry) => entry.id === nextStepId);
        if (nextStep) {
          await enterStructuredWorkflowStep({
            ...input,
            contactTags: mergeTags(input.contactTags, matchedBranch?.tags ?? []).join(", "),
            step: nextStep,
            branchHistory: nextHistory,
            continuationStepIds: branchExecutionPlan.continuationStepIds
          });
          return;
        }
      }

      if (branchExecutionPlan.continuationStepIds.length) {
        const [continuationStepId, ...remainingContinuationStepIds] = branchExecutionPlan.continuationStepIds;
        const continuationStep = input.workflow.steps.find((entry) => entry.id === continuationStepId);
        if (continuationStep) {
          await enterStructuredWorkflowStep({
            ...input,
            contactTags: mergeTags(input.contactTags, matchedBranch?.tags ?? []).join(", "),
            step: continuationStep,
            branchHistory: nextHistory,
            continuationStepIds: remainingContinuationStepIds
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
            continuationStepIds: branchExecutionPlan.continuationStepIds,
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
      body: renderWorkflowReplyTemplate(input.step.prompt, input.answers)
    });

    await setStructuredWorkflowWaitingState({
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      workflowId: input.workflowId,
      step: input.step,
      branchHistory: input.branchHistory,
      answers: input.answers,
      retries: input.retries,
      continuationStepIds: input.continuationStepIds,
      sentAt: input.sentAt
    });
    return;
  }

  if (input.step.type === "ask") {
    await sendAutomatedMessage({
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      to: input.contactPhone,
      body: renderWorkflowReplyTemplate(input.step.prompt, input.answers)
    });

    await setStructuredWorkflowWaitingState({
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      workflowId: input.workflowId,
      step: input.step,
      branchHistory: input.branchHistory,
      answers: input.answers,
      retries: input.retries,
      continuationStepIds: input.continuationStepIds,
      sentAt: input.sentAt
    });
    return;
  }

  if (input.step.type === "delay") {
    const delayMinutes = clampDelayMinutes(input.step.delayMinutes);
    const runAt = new Date(input.sentAt.getTime() + delayMinutes * 60 * 1000);

    await prisma.automationJob.create({
      data: {
        workspaceId: input.workspaceId,
        conversationId: input.conversationId,
        jobType: AutomationJobType.FOLLOW_UP_MESSAGE,
        status: AutomationJobStatus.PENDING,
        runAt,
        payloadJson: JSON.stringify({
          kind: "workflow-delay",
          workflowId: input.workflowId,
          stepId: input.step.id,
          nextStepId: input.step.nextStepId ?? null,
          scheduledFrom: input.sentAt.toISOString(),
          businessHoursOnly: Boolean(input.step.businessHoursOnly),
          cancelOnInbound: input.step.cancelOnInbound !== false,
          cancelOnHumanReply: Boolean(input.step.cancelOnHumanReply)
        })
      }
    });

    await prisma.conversationAutomationState.update({
      where: {
        conversationId: input.conversationId
      },
      data: {
        activeFlowKey: "CONVERSATION_WORKFLOW",
        activeFlowStep: input.step.id,
        flowStateJson: JSON.stringify({
          workflowId: input.workflowId,
          history: input.branchHistory,
          answers: input.answers,
          retries: input.retries,
          continuationStepIds: input.continuationStepIds,
          waitingAt: input.sentAt.toISOString(),
          waitingFor: "delay"
        }),
        lastAutoReplyAt: input.sentAt
      }
    });
    return;
  }

  if (input.step.type === "go_to") {
    const targetStepId = input.step.targetStepId?.trim() || null;
    if (targetStepId && targetStepId !== input.step.id) {
      const targetStep = input.workflow.steps.find((entry) => entry.id === targetStepId);
      if (targetStep) {
        await enterStructuredWorkflowStep({
          ...input,
          step: targetStep
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
          continuationStepIds: input.continuationStepIds,
          endedAt: input.sentAt.toISOString(),
          endStepId: input.step.id
        }),
        lastAutoReplyAt: input.sentAt
      }
    });
    return;
  }

  if (input.step.type === "action" || input.step.type === "update") {
    const actionStep = input.step;
    let resolvedAssigneeId: string | null = null;

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

    if (actionStep.type === "update") {
      const conversation = await prisma.conversation.findUnique({
        where: {
          id: input.conversationId
        },
        select: {
          assigneeId: true
        }
      });

      const shouldOverwriteExistingOwner = Boolean(actionStep.overwriteExistingOwner);
      if (!conversation?.assigneeId || shouldOverwriteExistingOwner) {
        const nextAssigneeId = await resolveWorkflowUpdateAssignee({
          workspaceId: input.workspaceId,
          workflowId: input.workflowId,
          stepId: actionStep.id,
          assignOwnerId: actionStep.assignOwnerId,
          assignmentMode: actionStep.assignmentMode,
          roundRobinAgentIds: actionStep.roundRobinAgentIds,
          sentAt: input.sentAt
        });

        if (nextAssigneeId && nextAssigneeId !== conversation?.assigneeId) {
          await prisma.conversation.update({
            where: {
              id: input.conversationId
            },
            data: {
              assigneeId: nextAssigneeId
            }
          });
        }

        resolvedAssigneeId = nextAssigneeId ?? conversation?.assigneeId ?? null;
      } else {
        resolvedAssigneeId = conversation.assigneeId;
      }
    } else if (actionStep.assignOwnerId) {
      await prisma.conversation.update({
        where: {
          id: input.conversationId
        },
        data: {
          assigneeId: actionStep.assignOwnerId
        }
      });
      resolvedAssigneeId = actionStep.assignOwnerId;
    } else {
      const conversation = await prisma.conversation.findUnique({
        where: {
          id: input.conversationId
        },
        select: {
          assigneeId: true
        }
      });
      resolvedAssigneeId = conversation?.assigneeId ?? null;
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

    if (actionStep.type === "update" && actionStep.leadAttributeKey) {
      await applyWorkflowLeadAttributeUpdate({
        workspaceId: input.workspaceId,
        contactId: input.contactId,
        sentAt: input.sentAt,
        attributeKey: actionStep.leadAttributeKey,
        literalValue: actionStep.leadAttributeValue,
        valueSource: actionStep.leadAttributeValueSource,
        savedValueKey: actionStep.leadAttributeValueKey,
        customAttributeKey: actionStep.leadCustomAttributeKey,
        answers: input.answers
      });
    }

    if (actionStep.type === "action" && actionStep.reply?.trim()) {
      await sendAutomatedMessage({
        workspaceId: input.workspaceId,
        conversationId: input.conversationId,
        to: input.contactPhone,
        body: actionStep.reply
      });
    }

    if ((actionStep.notifyAssignedOwner || actionStep.notifyAgentIds?.length) && actionStep.notifyMessage?.trim()) {
      await sendWorkflowTeamNotifications({
        workspaceId: input.workspaceId,
        sourceConversationId: input.conversationId,
        sourceContactId: input.contactId,
        sourceContactPhone: input.contactPhone,
        stepId: actionStep.id,
        stepTitle: actionStep.title,
        notifyAssignedOwner: actionStep.notifyAssignedOwner,
        notifyAgentIds: actionStep.notifyAgentIds,
        notifyMessage: actionStep.notifyMessage,
        assignedOwnerId: resolvedAssigneeId,
        answers: input.answers,
        sentAt: input.sentAt
      });
    }

    if (actionStep.nextStepId && actionStep.nextStepId !== WORKFLOW_END_ID) {
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

    if (actionStep.nextStepId === WORKFLOW_END_ID || !actionStep.nextStepId) {
      const continuationFallback = resolveWorkflowContinuationFallback({
        workflow: input.workflow,
        continuationStepIds: input.continuationStepIds
      });
      if (continuationFallback) {
        await enterStructuredWorkflowStep({
          ...input,
          contactTags: mergeTags(input.contactTags, actionStep.tags ?? []).join(", "),
          step: continuationFallback.step,
          continuationStepIds: continuationFallback.continuationStepIds
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
          continuationStepIds: input.continuationStepIds,
          endedAt: input.sentAt.toISOString(),
          endStepId: actionStep.id
        }),
        lastAutoReplyAt: input.sentAt
      }
    });
    return;
  }

  if (input.step.type === "reply") {
    const replyStep = input.step;
    const mediaItems = normalizeWorkflowMediaItems(replyStep.mediaItems, replyStep.mediaAssetIds);
    const introBody = renderWorkflowReplyTemplate(replyStep.reply, input.answers).trim();

    if (introBody) {
      await sendAutomatedMessage({
        workspaceId: input.workspaceId,
        conversationId: input.conversationId,
        to: input.contactPhone,
        body: introBody
      });
    }

    if (mediaItems.length) {
      const mediaAssets = await resolveOrderedWorkflowMediaItems(input.workspaceId, mediaItems);
      await sendAutomatedMediaMessages({
        workspaceId: input.workspaceId,
        conversationId: input.conversationId,
        to: input.contactPhone,
        mediaAssets: mediaAssets.map((item) => ({
          ...item,
          message: [
            replyStep.emoji?.trim(),
            renderWorkflowReplyTemplate(item.message, input.answers).trim()
          ]
            .filter(Boolean)
            .join(" ")
        }))
      });
    }

    if (replyStep.nextStepId && replyStep.nextStepId !== WORKFLOW_END_ID) {
      const nextStep = input.workflow.steps.find((entry) => entry.id === replyStep.nextStepId);
      if (nextStep) {
        await enterStructuredWorkflowStep({
          ...input,
          step: nextStep
        });
        return;
      }
    }

    if (replyStep.nextStepId === WORKFLOW_END_ID || !replyStep.nextStepId) {
      const continuationFallback = resolveWorkflowContinuationFallback({
        workflow: input.workflow,
        continuationStepIds: input.continuationStepIds
      });
      if (continuationFallback) {
        await enterStructuredWorkflowStep({
          ...input,
          step: continuationFallback.step,
          continuationStepIds: continuationFallback.continuationStepIds
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
          continuationStepIds: input.continuationStepIds,
          endedAt: input.sentAt.toISOString(),
          endStepId: replyStep.id
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

  const endContinuationFallback = resolveWorkflowContinuationFallback({
    workflow: input.workflow,
    continuationStepIds: input.continuationStepIds
  });
  if (endContinuationFallback) {
    await enterStructuredWorkflowStep({
      ...input,
      step: endContinuationFallback.step,
      continuationStepIds: endContinuationFallback.continuationStepIds
    });
    return;
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
        continuationStepIds: input.continuationStepIds,
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
      source: LeadSource.WHATSAPP,
      project: "New property inquiry",
      stage: LeadStage.NEW_LEAD,
      pipelineStageKey: "new_lead",
      priority: LeadPriority.MEDIUM,
      currency: "MYR",
      customData: JSON.stringify({ project: "New property inquiry", industryType: "PROPERTY" }),
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
  const local = getLocalTimeParts(date, settings.timezone || DEFAULT_TIMEZONE);
  const day = local.day;
  const hours = `${`${local.hour}`.padStart(2, "0")}:${`${local.minute}`.padStart(2, "0")}`;
  const window = settings.businessHours.find((entry) => entry.day === day);

  if (!window || !window.enabled) {
    return false;
  }

  return hours >= window.start && hours <= window.end;
}

function getNextBusinessOpening(
  settings: Awaited<ReturnType<typeof getOrCreateAutomationSettings>>,
  date: Date
) {
  const timezone = settings.timezone || DEFAULT_TIMEZONE;
  const local = getLocalTimeParts(date, timezone);
  const currentMinutes = local.hour * 60 + local.minute;

  for (let dayOffset = 0; dayOffset < 8; dayOffset += 1) {
    const candidateDay = getLocalTimeParts(
      zonedDateTimeToUtc(
        {
          year: local.year,
          month: local.month,
          day: local.date + dayOffset,
          hour: 12,
          minute: 0
        },
        timezone
      ),
      timezone
    );
    const window = settings.businessHours.find((entry) => entry.day === candidateDay.day && entry.enabled);

    if (!window) {
      continue;
    }

    const openingMinutes = parseTimeToMinutes(window.start);
    if (dayOffset === 0 && currentMinutes > openingMinutes) {
      continue;
    }

    const [hour, minute] = window.start.split(":").map((value) => Number.parseInt(value, 10));
    return zonedDateTimeToUtc(
      {
        year: candidateDay.year,
        month: candidateDay.month,
        day: candidateDay.date,
        hour,
        minute
      },
      timezone
    );
  }

  return null;
}

function getLocalTimeParts(date: Date, timezone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });
  const parts = formatter.formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return {
    year: Number.parseInt(values.year ?? "0", 10),
    month: Number.parseInt(values.month ?? "0", 10),
    date: Number.parseInt(values.day ?? "0", 10),
    hour: Number.parseInt(values.hour ?? "0", 10),
    minute: Number.parseInt(values.minute ?? "0", 10),
    second: Number.parseInt(values.second ?? "0", 10),
    day: parseWeekday(values.weekday ?? "")
  };
}

function zonedDateTimeToUtc(
  input: { year: number; month: number; day: number; hour: number; minute: number },
  timezone: string
) {
  let utcMs = Date.UTC(input.year, input.month - 1, input.day, input.hour, input.minute);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const offsetMinutes = getTimezoneOffsetMinutes(new Date(utcMs), timezone);
    const adjustedUtcMs = Date.UTC(input.year, input.month - 1, input.day, input.hour, input.minute) - offsetMinutes * 60 * 1000;

    if (adjustedUtcMs === utcMs) {
      break;
    }

    utcMs = adjustedUtcMs;
  }

  return new Date(utcMs);
}

function getTimezoneOffsetMinutes(date: Date, timezone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    timeZoneName: "shortOffset"
  });
  const parts = formatter.formatToParts(date);
  const offset = parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  const match = offset.match(/^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/);

  if (!match) {
    return 0;
  }

  const [, sign, hours, minutes] = match;
  const totalMinutes = Number.parseInt(hours, 10) * 60 + Number.parseInt(minutes ?? "0", 10);
  return sign === "-" ? -totalMinutes : totalMinutes;
}

function parseWeekday(value: string) {
  const normalized = value.slice(0, 3).toLowerCase();
  const weekdayMap: Record<string, number> = {
    sun: 0,
    mon: 1,
    tue: 2,
    wed: 3,
    thu: 4,
    fri: 5,
    sat: 6
  };

  return weekdayMap[normalized] ?? 0;
}

function parseTimeToMinutes(value: string) {
  const [hour, minute] = value.split(":").map((item) => Number.parseInt(item, 10));
  return hour * 60 + minute;
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
      variables: Array.isArray(parsed.variables) ? parsed.variables : [],
      steps: parsed.steps.map((step) => {
        if (step.type === "ask" || step.type === "question" || step.type === "choice") {
          return {
            ...step,
            saveAs: typeof step.saveAs === "string" ? step.saveAs.trim() || null : null,
            expiresAfterMinutes: clampWorkflowWaitTimeoutMinutes(step.expiresAfterMinutes),
            onTimeoutStepId: typeof step.onTimeoutStepId === "string" ? step.onTimeoutStepId.trim() || null : null,
            ...(step.type === "question" || step.type === "choice"
              ? {
                  decisionSource: step.decisionSource === "savedValue" ? ("savedValue" as const) : ("currentReply" as const),
                  decisionSourceKey:
                    typeof step.decisionSourceKey === "string" ? step.decisionSourceKey.trim() || null : null,
                  maxRetries: clampWorkflowWaitTimeoutMinutes(step.maxRetries),
                  fallbackReply: typeof step.fallbackReply === "string" ? step.fallbackReply.trim() || null : null,
                  fallbackNextStepId:
                    typeof step.fallbackNextStepId === "string" ? step.fallbackNextStepId.trim() || null : null
                }
              : {})
          };
        }

        if (step.type === "reply") {
          return {
            ...step,
            emoji: typeof step.emoji === "string" && step.emoji.trim() ? step.emoji.trim() : null,
            mediaAssetIds: normalizeWorkflowMediaAssetIds(step.mediaAssetIds),
            mediaItems: normalizeWorkflowMediaItems(step.mediaItems, step.mediaAssetIds)
          };
        }

        if (step.type === "update") {
          const assignOwnerId = typeof step.assignOwnerId === "string" ? step.assignOwnerId.trim() || null : null;
          return {
            ...step,
            assignmentMode: normalizeWorkflowAssignmentMode(step.assignmentMode ?? (assignOwnerId ? "fixed" : "none")),
            assignOwnerId,
            notifyAssignedOwner: Boolean(step.notifyAssignedOwner),
            notifyAgentIds: normalizeWorkflowRoundRobinAgentIds(step.notifyAgentIds),
            notifyMessage: typeof step.notifyMessage === "string" ? step.notifyMessage.trim() || null : null,
            roundRobinAgentIds: normalizeWorkflowRoundRobinAgentIds(step.roundRobinAgentIds),
            overwriteExistingOwner: Boolean(step.overwriteExistingOwner),
            leadAttributeKey: normalizeWorkflowLeadAttributeKey(step.leadAttributeKey),
            leadAttributeValue:
              typeof step.leadAttributeValue === "string" ? step.leadAttributeValue.trim() : null,
            leadAttributeValueSource:
              step.leadAttributeValueSource === "savedValue" ? ("savedValue" as const) : ("literal" as const),
            leadAttributeValueKey:
              typeof step.leadAttributeValueKey === "string" ? step.leadAttributeValueKey.trim() || null : null,
            leadCustomAttributeKey:
              typeof step.leadCustomAttributeKey === "string" ? step.leadCustomAttributeKey.trim() || null : null
          };
        }

        if (step.type === "action") {
          const assignOwnerId = typeof step.assignOwnerId === "string" ? step.assignOwnerId.trim() || null : null;
          return {
            ...step,
            assignOwnerId,
            notifyAssignedOwner: Boolean(step.notifyAssignedOwner),
            notifyAgentIds: normalizeWorkflowRoundRobinAgentIds(step.notifyAgentIds),
            notifyMessage: typeof step.notifyMessage === "string" ? step.notifyMessage.trim() || null : null
          };
        }

        return step;
      })
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
  const continuationStepIdsPayload = parsed.continuationStepIds;
  const waitingAtPayload = typeof parsed.waitingAt === "string" ? parsed.waitingAt : null;
  const waitingForPayload = parsed.waitingFor === "delay" || parsed.waitingFor === "reply" ? parsed.waitingFor : null;

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

  const normalizedContinuationStepIds = normalizeWorkflowContinuationStepIds(continuationStepIdsPayload);
  const workflowIdPayload = typeof parsed.workflowId === "string" ? parsed.workflowId : null;

  return {
    workflowId: workflowIdPayload,
    history: normalizedHistory,
    answers: normalizedAnswers,
    retries: normalizedRetries,
    continuationStepIds: normalizedContinuationStepIds,
    waitingAt: waitingAtPayload,
    waitingFor: waitingForPayload
  };
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
  return uniqueWorkflowIds.filter((workflowId) => validWorkflowIdSet.has(workflowId));
}

function serializeStoredActiveWorkflowIds(workflowIds: string[]) {
  const normalized = Array.from(new Set(workflowIds.map((workflowId) => workflowId.trim()).filter(Boolean)));
  if (!normalized.length) {
    return null;
  }

  return normalized.length === 1 ? normalized[0] : JSON.stringify(normalized);
}

type AutomationJobPayload =
  | {
      kind: "rule-follow-up";
      scheduledFrom?: string | null;
      cancelOnInbound?: boolean;
      body?: string | null;
      attachmentMimeType?: string | null;
      attachmentName?: string | null;
      attachmentUrl?: string | null;
      attachments?: Array<{
        mimeType?: string | null;
        name?: string | null;
        url?: string | null;
      }>;
    }
  | {
      kind: "workflow-delay";
      workflowId?: string | null;
      stepId?: string | null;
      nextStepId?: string | null;
      scheduledFrom?: string | null;
      businessHoursOnly?: boolean;
      cancelOnInbound?: boolean;
      cancelOnHumanReply?: boolean;
    }
  | {
      kind: "workflow-wait-timeout";
      workflowId?: string | null;
      stepId?: string | null;
      onTimeoutStepId?: string | null;
      scheduledFrom?: string | null;
    };

function parseAutomationJobPayload(value: string): AutomationJobPayload {
  const parsed = parseJsonObject(value);

  if (parsed.kind === "workflow-delay") {
    return {
      kind: "workflow-delay",
      workflowId: typeof parsed.workflowId === "string" ? parsed.workflowId : null,
      stepId: typeof parsed.stepId === "string" ? parsed.stepId : null,
      nextStepId: typeof parsed.nextStepId === "string" ? parsed.nextStepId : null,
      scheduledFrom: typeof parsed.scheduledFrom === "string" ? parsed.scheduledFrom : null,
      businessHoursOnly: Boolean(parsed.businessHoursOnly),
      cancelOnInbound: parsed.cancelOnInbound !== false,
      cancelOnHumanReply: Boolean(parsed.cancelOnHumanReply)
    };
  }

  if (parsed.kind === "workflow-wait-timeout") {
    return {
      kind: "workflow-wait-timeout",
      workflowId: typeof parsed.workflowId === "string" ? parsed.workflowId : null,
      stepId: typeof parsed.stepId === "string" ? parsed.stepId : null,
      onTimeoutStepId: typeof parsed.onTimeoutStepId === "string" ? parsed.onTimeoutStepId : null,
      scheduledFrom: typeof parsed.scheduledFrom === "string" ? parsed.scheduledFrom : null
    };
  }

  return {
    kind: "rule-follow-up",
    scheduledFrom: typeof parsed.scheduledFrom === "string" ? parsed.scheduledFrom : null,
    cancelOnInbound: parsed.cancelOnInbound !== false,
    body: typeof parsed.body === "string" ? parsed.body : null,
    attachmentMimeType: typeof parsed.attachmentMimeType === "string" ? parsed.attachmentMimeType : null,
    attachmentName: typeof parsed.attachmentName === "string" ? parsed.attachmentName : null,
    attachmentUrl: typeof parsed.attachmentUrl === "string" ? parsed.attachmentUrl : null,
    attachments: Array.isArray(parsed.attachments)
      ? parsed.attachments
          .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
          .map((item) => ({
            mimeType: typeof item.mimeType === "string" ? item.mimeType : null,
            name: typeof item.name === "string" ? item.name : null,
            url: typeof item.url === "string" ? item.url : null
          }))
          .filter((item) => item.url)
      : []
  };
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

    const normalized = parsed.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
    return normalized.length ? Array.from(new Set(normalized)) : fallback;
  } catch {
    return fallback;
  }
}

function normalizeWorkflowMediaAssetIds(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as string[];
  }

  return Array.from(
    new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))
  );
}

function normalizeWorkflowMediaItems(value: unknown, fallbackMediaAssetIds?: unknown) {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
      .map((item) => ({
        mediaAssetId: typeof item.mediaAssetId === "string" ? item.mediaAssetId.trim() : "",
        message: typeof item.message === "string" ? item.message : ""
      }))
      .filter((item) => item.mediaAssetId);
  }

  return normalizeWorkflowMediaAssetIds(fallbackMediaAssetIds).map((mediaAssetId) => ({
    mediaAssetId,
    message: ""
  }));
}

function normalizeWorkflowAssignmentMode(value: unknown): "none" | "fixed" | "round_robin" {
  return value === "round_robin" ? "round_robin" : value === "fixed" ? "fixed" : "none";
}

function normalizeWorkflowRoundRobinAgentIds(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as string[];
  }

  return Array.from(
    new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))
  );
}

function normalizeWorkflowLeadAttributeKey(value: unknown) {
  return normalizeWorkflowContentAttributeKey(value);
}

async function applyWorkflowLeadAttributeUpdate(input: {
  workspaceId: string;
  contactId: string;
  sentAt: Date;
  attributeKey: string;
  literalValue?: string | null;
  valueSource?: "literal" | "savedValue" | null;
  savedValueKey?: string | null;
  customAttributeKey?: string | null;
  answers: Record<string, string>;
}) {
  const attributeKey = normalizeWorkflowLeadAttributeKey(input.attributeKey);
  if (!attributeKey) {
    return;
  }

  const rawValue =
    input.valueSource === "savedValue" && input.savedValueKey?.trim()
      ? input.answers[input.savedValueKey.trim()] ?? ""
      : input.literalValue ?? "";
  const value = normalizeWorkflowContentAttributeText(rawValue);

  if (!value) {
    return;
  }

  const validationError = validateNormalizedWorkflowContentAttributeValue(attributeKey, value);
  if (validationError) {
    console.warn(
      `[automation-workflow][update] skipped invalid value for ${attributeKey}: ${validationError}`
    );
    return;
  }

  if (attributeKey === "contact.displayName") {
    await prisma.contact.update({
      where: { id: input.contactId },
      data: {
        displayName: value,
        displayNameManualOverride: true
      }
    });
    return;
  }

  if (attributeKey === "contact.email") {
    await prisma.contact.update({
      where: { id: input.contactId },
      data: {
        email: value.toLowerCase(),
        emailManualOverride: true
      }
    });
    return;
  }

  if (attributeKey === "contact.tags") {
    await prisma.contact.update({
      where: { id: input.contactId },
      data: {
        tags: mergeTags(null, normalizeWorkflowTagList(value)).join(", "),
        tagsManualOverride: true
      }
    });
    return;
  }

  if (
    attributeKey === "contact.addressLine1" ||
    attributeKey === "contact.addressLine2" ||
    attributeKey === "contact.city" ||
    attributeKey === "contact.state" ||
    attributeKey === "contact.postalCode" ||
    attributeKey === "contact.country"
  ) {
    await prisma.contact.update({
      where: { id: input.contactId },
      data: {
        [attributeKey.replace("contact.", "")]: value
      }
    });
    return;
  }

  const lead = await prisma.lead.findFirst({
    where: {
      workspaceId: input.workspaceId,
      contactId: input.contactId
    },
    orderBy: {
      lastActivityAt: "desc"
    },
    select: {
      id: true,
      customData: true
    }
  });

  if (!lead) {
    return;
  }

  const data: Record<string, unknown> = {
    lastActivityAt: input.sentAt
  };

  if (attributeKey === "budget" || attributeKey === "value") {
    const numericValue = parseWorkflowAmount(value);
    if (!Number.isFinite(numericValue)) {
      console.warn(
        `[automation-workflow][update] skipped invalid numeric value for ${attributeKey}: ${value}`
      );
      return;
    }
    data[attributeKey] = numericValue;
  } else if (attributeKey === "priority") {
    data.priority = mapWorkflowLeadPriority(value);
  } else if (attributeKey === "custom") {
    const customKey = input.customAttributeKey?.trim();
    if (!customKey) {
      return;
    }
    const customData = parseLeadCustomDataRecord(lead.customData);
    customData[customKey] = value;
    data.customData = stringifyLeadCustomDataRecord(customData);
  } else {
    data[attributeKey] = value;
  }

  await prisma.lead.update({
    where: {
      id: lead.id
    },
    data
  });
}

function parseLeadCustomDataRecord(value?: string | null) {
  if (!value) {
    return {} as Record<string, unknown>;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function stringifyLeadCustomDataRecord(value: Record<string, unknown>) {
  const entries = Object.entries(value).filter(([, entryValue]) => {
    if (entryValue === null || entryValue === undefined) {
      return false;
    }
    return typeof entryValue !== "string" || entryValue.trim().length > 0;
  });

  return entries.length ? JSON.stringify(Object.fromEntries(entries)) : null;
}

async function resolveWorkflowUpdateAssignee(input: {
  workspaceId: string;
  workflowId: string | null;
  stepId: string;
  assignOwnerId?: string | null;
  assignmentMode?: "none" | "fixed" | "round_robin";
  roundRobinAgentIds?: string[];
  sentAt: Date;
}) {
  const assignmentMode =
    input.assignmentMode ?? (input.assignOwnerId?.trim() ? "fixed" : "none");

  if (assignmentMode === "fixed") {
    return input.assignOwnerId?.trim() || null;
  }

  if (assignmentMode !== "round_robin") {
    return null;
  }

  const requestedAgentIds = normalizeWorkflowRoundRobinAgentIds(input.roundRobinAgentIds);
  if (!requestedAgentIds.length) {
    return null;
  }

  const activeAgents = await prisma.agent.findMany({
    where: {
      workspaceId: input.workspaceId,
      status: AgentStatus.ACTIVE,
      id: {
        in: requestedAgentIds
      }
    },
    select: {
      id: true
    }
  });

  const activeAgentIds = requestedAgentIds.filter((agentId) => activeAgents.some((agent) => agent.id === agentId));
  if (!activeAgentIds.length) {
    return null;
  }

  if (!input.workflowId) {
    return activeAgentIds[0];
  }

  return prisma.$transaction(async (tx) => {
    await tx.automationWorkflowAssignmentCursor.upsert({
      where: {
        workflowId_stepId: {
          workflowId: input.workflowId!,
          stepId: input.stepId
        }
      },
      create: {
        workspaceId: input.workspaceId,
        workflowId: input.workflowId!,
        stepId: input.stepId
      },
      update: {}
    });

    const [cursor] = await tx.$queryRaw<Array<{ id: string; nextIndex: number }>>`
      SELECT id, "nextIndex"
      FROM "AutomationWorkflowAssignmentCursor"
      WHERE "workflowId" = ${input.workflowId!} AND "stepId" = ${input.stepId}
      FOR UPDATE
    `;

    if (!cursor) {
      return activeAgentIds[0];
    }

    const currentIndex = Number.isFinite(cursor.nextIndex) ? cursor.nextIndex : 0;
    const nextAgentId = activeAgentIds[((currentIndex % activeAgentIds.length) + activeAgentIds.length) % activeAgentIds.length];

    await tx.automationWorkflowAssignmentCursor.update({
      where: {
        id: cursor.id
      },
      data: {
        nextIndex: (currentIndex + 1) % activeAgentIds.length,
        lastAssignedAgentId: nextAgentId,
        lastAssignedAt: input.sentAt
      }
    });

    return nextAgentId;
  });
}

async function cancelPendingAutomationJobsOnInbound(input: {
  conversationId: string;
  sentAt: Date;
}) {
  const jobs = await prisma.automationJob.findMany({
    where: {
      conversationId: input.conversationId,
      status: AutomationJobStatus.PENDING,
      jobType: AutomationJobType.FOLLOW_UP_MESSAGE
    },
    select: {
      id: true,
      payloadJson: true
    }
  });

  const jobsToCancel = jobs
    .filter((job) => {
      const payload = parseAutomationJobPayload(job.payloadJson);
      if (payload.kind === "workflow-delay") {
        return payload.cancelOnInbound !== false;
      }

      if (payload.kind === "workflow-wait-timeout") {
        return true;
      }

      return shouldCancelRuleFollowUpOnReply(payload);
    })
    .map((job) => job.id);

  if (!jobsToCancel.length) {
    return;
  }

  await prisma.automationJob.updateMany({
    where: {
      id: {
        in: jobsToCancel
      },
      status: AutomationJobStatus.PENDING
    },
    data: {
      status: AutomationJobStatus.CANCELED,
      lastError: `Canceled after inbound reply at ${input.sentAt.toISOString()}.`
    }
  });
}

function shouldCancelRuleFollowUpOnReply(payload: AutomationJobPayload) {
  return payload.kind === "rule-follow-up" && payload.cancelOnInbound !== false;
}

function getRuleFollowUpScheduledFrom(
  job: {
    runAt: Date;
  },
  payload: Extract<AutomationJobPayload, { kind: "rule-follow-up" }>
) {
  if (payload.scheduledFrom) {
    const parsed = new Date(payload.scheduledFrom);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return new Date(job.runAt.getTime() - 1);
}

async function processWorkflowDelayJob(
  job: {
    id: string;
    workspaceId: string;
    conversationId: string;
    runAt: Date;
    payloadJson: string;
  },
  payload: Extract<AutomationJobPayload, { kind: "workflow-delay" }>
) {
  if (!payload.stepId) {
    await prisma.automationJob.update({
      where: {
        id: job.id
      },
      data: {
        status: AutomationJobStatus.CANCELED,
        lastError: "Workflow delay job is missing stepId."
      }
    });
    return "canceled" as const;
  }

  const conversation = await prisma.conversation.findFirst({
    where: {
      id: job.conversationId,
      workspaceId: job.workspaceId
    },
    include: {
      contact: true,
      automationState: true
    }
  });

  if (!conversation) {
    await prisma.automationJob.update({
      where: {
        id: job.id
      },
      data: {
        status: AutomationJobStatus.CANCELED,
        lastError: "Conversation not found."
      }
    });
    return "canceled" as const;
  }

  if (
    conversation.automationState?.activeFlowKey !== "CONVERSATION_WORKFLOW" ||
    conversation.automationState?.activeFlowStep !== payload.stepId
  ) {
    await prisma.automationJob.update({
      where: {
        id: job.id
      },
      data: {
        status: AutomationJobStatus.CANCELED,
        lastError: "Workflow state moved past the scheduled delay."
      }
    });
    return "canceled" as const;
  }

  const scheduledFrom = payload.scheduledFrom ? new Date(payload.scheduledFrom) : job.runAt;

  if (payload.cancelOnInbound !== false) {
    const inboundAfterSchedule = await prisma.message.findFirst({
      where: {
        conversationId: job.conversationId,
        direction: MessageDirection.INBOUND,
        sentAt: {
          gt: scheduledFrom
        }
      },
      select: {
        id: true
      }
    });

    if (inboundAfterSchedule) {
      await prisma.automationJob.update({
        where: {
          id: job.id
        },
        data: {
          status: AutomationJobStatus.CANCELED,
          lastError: "Canceled because the contact replied before the delay completed."
        }
      });
      return "canceled" as const;
    }
  }

  if (payload.cancelOnHumanReply && conversation.automationState.automationPausedUntil) {
    if (conversation.automationState.automationPausedUntil > scheduledFrom) {
      await prisma.automationJob.update({
        where: {
          id: job.id
        },
        data: {
          status: AutomationJobStatus.CANCELED,
          lastError: "Canceled because a human reply paused automation."
        }
      });
      return "canceled" as const;
    }
  }

  if (
    conversation.automationState.automationPausedUntil &&
    conversation.automationState.automationPausedUntil > new Date()
  ) {
    await prisma.automationJob.update({
      where: {
        id: job.id
      },
      data: {
        status: AutomationJobStatus.PENDING,
        runAt: conversation.automationState.automationPausedUntil,
        lastError: "Delayed until automation pause expires."
      }
    });
    return "rescheduled" as const;
  }

  const settings = await getOrCreateAutomationSettings(job.workspaceId);
  const now = new Date();
  if (payload.businessHoursOnly && settings.businessHoursEnabled && !isWithinBusinessHours(settings, now)) {
    const nextOpening = getNextBusinessOpening(settings, now);
    await prisma.automationJob.update({
      where: {
        id: job.id
      },
      data: {
        status: AutomationJobStatus.PENDING,
        runAt: nextOpening ?? new Date(now.getTime() + 60 * 60 * 1000),
        lastError: nextOpening
          ? `Waiting for business hours until ${nextOpening.toISOString()}.`
          : "Waiting for business hours."
      }
    });
    return "rescheduled" as const;
  }

  const workflowRecord =
    (payload.workflowId
      ? await prisma.automationWorkflow.findFirst({
          where: {
            id: payload.workflowId,
            workspaceId: job.workspaceId
          },
          select: {
            id: true,
            definitionJson: true
          }
        })
      : null) ??
    (settings.activeWorkflowId
      ? await prisma.automationWorkflow.findFirst({
          where: {
            id: settings.activeWorkflowId,
            workspaceId: job.workspaceId
          },
          select: {
            id: true,
            definitionJson: true
          }
        })
      : null);

  const workflow = parseWorkflowDefinition(workflowRecord?.definitionJson ?? settings.workflowDefinitionJson);
  if (!workflow) {
    throw new Error("Active workflow definition is unavailable.");
  }

  const delayStep = workflow.steps.find(
    (step): step is Extract<StructuredWorkflowStep, { type: "delay" }> =>
      step.id === payload.stepId && step.type === "delay"
  );

  if (!delayStep) {
    await prisma.automationJob.update({
      where: {
        id: job.id
      },
      data: {
        status: AutomationJobStatus.CANCELED,
        lastError: "Delay step no longer exists in the workflow."
      }
    });
    return "canceled" as const;
  }

  const nextStepId = payload.nextStepId ?? delayStep.nextStepId ?? null;
  const flowState = parseStructuredWorkflowState(conversation.automationState.flowStateJson);

  if (!nextStepId) {
    if (flowState.continuationStepIds.length) {
      const [continuationStepId, ...remainingContinuationStepIds] = flowState.continuationStepIds;
      const continuationStep = workflow.steps.find((step) => step.id === continuationStepId);
      if (continuationStep) {
        await enterStructuredWorkflowStep({
          workspaceId: job.workspaceId,
          conversationId: job.conversationId,
          contactId: conversation.contactId,
          contactPhone: conversation.contact.phone,
          contactTags: conversation.contact.tags,
          sentAt: new Date(),
          workflowId: workflowRecord?.id ?? settings.activeWorkflowId,
          workflow,
          step: continuationStep,
          branchHistory: flowState.history,
          answers: flowState.answers,
          retries: flowState.retries,
          continuationStepIds: remainingContinuationStepIds
        });
      } else {
        await prisma.conversationAutomationState.update({
          where: {
            conversationId: job.conversationId
          },
          data: {
            activeFlowKey: null,
            activeFlowStep: null,
            flowStateJson: JSON.stringify({
              history: flowState.history,
              answers: flowState.answers,
              retries: flowState.retries,
              continuationStepIds: flowState.continuationStepIds,
              endedAt: new Date().toISOString(),
              endStepId: delayStep.id
            }),
            lastAutoReplyAt: new Date()
          }
        });
      }
    } else {
      await prisma.conversationAutomationState.update({
        where: {
          conversationId: job.conversationId
        },
        data: {
          activeFlowKey: null,
          activeFlowStep: null,
          flowStateJson: JSON.stringify({
            history: flowState.history,
            answers: flowState.answers,
            retries: flowState.retries,
            continuationStepIds: flowState.continuationStepIds,
            endedAt: new Date().toISOString(),
            endStepId: delayStep.id
          }),
          lastAutoReplyAt: new Date()
        }
      });
    }
  } else {
    const nextStep = workflow.steps.find((step) => step.id === nextStepId);
    if (!nextStep) {
      throw new Error(`Workflow step ${nextStepId} was not found.`);
    }

    await enterStructuredWorkflowStep({
      workspaceId: job.workspaceId,
      conversationId: job.conversationId,
      contactId: conversation.contactId,
      contactPhone: conversation.contact.phone,
      contactTags: conversation.contact.tags,
      sentAt: new Date(),
      workflowId: workflowRecord?.id ?? settings.activeWorkflowId,
      workflow,
      step: nextStep,
      branchHistory: flowState.history,
      answers: flowState.answers,
      retries: flowState.retries,
      continuationStepIds: flowState.continuationStepIds
    });
  }

  await prisma.automationJob.update({
    where: {
      id: job.id
    },
    data: {
      status: AutomationJobStatus.SENT,
      lastError: null
    }
  });

  return "sent" as const;
}

async function processWorkflowWaitTimeoutJob(
  job: {
    id: string;
    workspaceId: string;
    conversationId: string;
    runAt: Date;
    payloadJson: string;
  },
  payload: Extract<AutomationJobPayload, { kind: "workflow-wait-timeout" }>
) {
  if (!payload.stepId) {
    await prisma.automationJob.update({
      where: {
        id: job.id
      },
      data: {
        status: AutomationJobStatus.CANCELED,
        lastError: "Workflow timeout job is missing stepId."
      }
    });
    return "canceled" as const;
  }

  const conversation = await prisma.conversation.findFirst({
    where: {
      id: job.conversationId,
      workspaceId: job.workspaceId
    },
    include: {
      contact: true,
      automationState: true
    }
  });

  if (!conversation) {
    await prisma.automationJob.update({
      where: {
        id: job.id
      },
      data: {
        status: AutomationJobStatus.CANCELED,
        lastError: "Conversation not found."
      }
    });
    return "canceled" as const;
  }

  if (
    conversation.automationState?.activeFlowKey !== "CONVERSATION_WORKFLOW" ||
    conversation.automationState?.activeFlowStep !== payload.stepId
  ) {
    await prisma.automationJob.update({
      where: {
        id: job.id
      },
      data: {
        status: AutomationJobStatus.CANCELED,
        lastError: "Workflow state moved past the scheduled wait timeout."
      }
    });
    return "canceled" as const;
  }

  const flowState = parseStructuredWorkflowState(conversation.automationState.flowStateJson);
  if (!payload.scheduledFrom || flowState.waitingAt !== payload.scheduledFrom || flowState.waitingFor !== "reply") {
    await prisma.automationJob.update({
      where: {
        id: job.id
      },
      data: {
        status: AutomationJobStatus.CANCELED,
        lastError: "Workflow wait timeout no longer matches the active waiting state."
      }
    });
    return "canceled" as const;
  }

  if (
    conversation.automationState.automationPausedUntil &&
    conversation.automationState.automationPausedUntil > new Date()
  ) {
    await prisma.automationJob.update({
      where: {
        id: job.id
      },
      data: {
        status: AutomationJobStatus.PENDING,
        runAt: conversation.automationState.automationPausedUntil,
        lastError: "Delayed until automation pause expires."
      }
    });
    return "rescheduled" as const;
  }

  const settings = await getOrCreateAutomationSettings(job.workspaceId);
  const workflowRecord =
    (payload.workflowId
      ? await prisma.automationWorkflow.findFirst({
          where: {
            id: payload.workflowId,
            workspaceId: job.workspaceId
          },
          select: {
            id: true,
            definitionJson: true
          }
        })
      : null) ??
    (settings.activeWorkflowId
      ? await prisma.automationWorkflow.findFirst({
          where: {
            id: settings.activeWorkflowId,
            workspaceId: job.workspaceId
          },
          select: {
            id: true,
            definitionJson: true
          }
        })
      : null);

  const workflow = parseWorkflowDefinition(workflowRecord?.definitionJson ?? settings.workflowDefinitionJson);
  if (!workflow) {
    throw new Error("Active workflow definition is unavailable.");
  }

  const waitingStepCandidate = workflow.steps.find((step) => step.id === payload.stepId);
  const waitingStep =
    waitingStepCandidate &&
    (waitingStepCandidate.type === "ask" ||
      waitingStepCandidate.type === "question" ||
      waitingStepCandidate.type === "choice")
      ? (waitingStepCandidate as StructuredWorkflowWaitingStep)
      : null;

  if (!waitingStep) {
    await prisma.automationJob.update({
      where: {
        id: job.id
      },
      data: {
        status: AutomationJobStatus.CANCELED,
        lastError: "Waiting step no longer exists in the workflow."
      }
    });
    return "canceled" as const;
  }

  const timeoutStepId = payload.onTimeoutStepId ?? waitingStep.onTimeoutStepId ?? null;
  const sentAt = new Date();
  if (timeoutStepId) {
    const nextStep = workflow.steps.find((step) => step.id === timeoutStepId);
    if (!nextStep) {
      throw new Error(`Workflow timeout step ${timeoutStepId} was not found.`);
    }

    await enterStructuredWorkflowStep({
      workspaceId: job.workspaceId,
      conversationId: job.conversationId,
      contactId: conversation.contactId,
      contactPhone: conversation.contact.phone,
      contactTags: conversation.contact.tags,
      sentAt,
      workflowId: workflowRecord?.id ?? settings.activeWorkflowId,
      workflow,
      step: nextStep,
      branchHistory: flowState.history,
      answers: flowState.answers,
      retries: flowState.retries,
      continuationStepIds: flowState.continuationStepIds
    });
  } else {
    await prisma.conversationAutomationState.update({
      where: {
        conversationId: job.conversationId
      },
      data: {
        activeFlowKey: null,
        activeFlowStep: null,
        flowStateJson: JSON.stringify({
          history: flowState.history,
          answers: flowState.answers,
          retries: flowState.retries,
          continuationStepIds: flowState.continuationStepIds,
          endedAt: sentAt.toISOString(),
          endStepId: waitingStep.id,
          endReason: "WAIT_TIMEOUT"
        }),
        lastAutoReplyAt: sentAt
      }
    });
  }

  await prisma.automationJob.update({
    where: {
      id: job.id
    },
    data: {
      status: AutomationJobStatus.SENT,
      lastError: timeoutStepId ? `Moved to timeout step ${timeoutStepId}.` : "Ended workflow after reply timeout."
    }
  });

  return "sent" as const;
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

function parseMatcherList(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function hasPhoneNumber(value: string) {
  const compact = value.replace(/[^\d+]/g, "");
  return /^\+?\d{7,15}$/.test(compact) || /(?:\+?\d[\d\s().-]{6,}\d)/.test(value);
}

function hasEmailAddress(value: string) {
  return /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(value);
}

function matchesLanguage(inboundText: string, expectedLanguage: string) {
  const detectedLanguage = detectMessageLanguage(inboundText);
  const normalizedExpectedLanguage = normalizeLanguageName(expectedLanguage);

  if (!normalizedExpectedLanguage || !detectedLanguage) {
    return false;
  }

  return detectedLanguage === normalizedExpectedLanguage;
}

function detectMessageLanguage(value: string) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }

  if (/[\u4e00-\u9fff]/u.test(value)) {
    return "chinese";
  }

  const englishScore = countKeywordHits(normalized, [
    "hello",
    "hi",
    "please",
    "thanks",
    "thank you",
    "price",
    "quotation",
    "quote",
    "interested",
    "yes",
    "no",
    "can i",
    "i want",
    "good morning"
  ]);
  const malayScore = countKeywordHits(normalized, [
    "saya",
    "anda",
    "nak",
    "boleh",
    "harga",
    "terima kasih",
    "ya",
    "tidak",
    "berminat",
    "pagi",
    "petang",
    "malam",
    "nak tanya",
    "boleh saya"
  ]);

  if (englishScore === 0 && malayScore === 0) {
    return null;
  }

  if (malayScore > englishScore) {
    return "malay";
  }

  if (englishScore > malayScore) {
    return "english";
  }

  return null;
}

function countKeywordHits(input: string, keywords: string[]) {
  return keywords.reduce((total, keyword) => (input.includes(keyword) ? total + 1 : total), 0);
}

function normalizeLanguageName(value: string) {
  const normalized = normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  const aliases: Record<string, string> = {
    english: "english",
    en: "english",
    malay: "malay",
    "bahasa melayu": "malay",
    bm: "malay",
    ms: "malay",
    chinese: "chinese",
    mandarin: "chinese",
    cina: "chinese",
    zh: "chinese",
    "zh-cn": "chinese",
    "zh-tw": "chinese"
  };

  return aliases[normalized] ?? normalized;
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

function clampDelayMinutes(value: number | null | undefined) {
  if (!value || !Number.isFinite(value)) {
    return 60;
  }

  return Math.min(43200, Math.max(1, Math.round(value)));
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

function mapWorkflowLeadPriority(value: string) {
  switch (value.trim().toUpperCase()) {
    case "LOW":
      return LeadPriority.LOW;
    case "HIGH":
      return LeadPriority.HIGH;
    case "URGENT":
      return LeadPriority.URGENT;
    case "MEDIUM":
    default:
      return LeadPriority.MEDIUM;
  }
}
