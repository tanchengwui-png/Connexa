import { AutomationJobStatus } from "@prisma/client";
import { getPlatformAutomationWorkflowConfig } from "@/lib/platform-config";
import { prisma } from "@/lib/prisma";

type ConversationAutomationTimeoutState = {
  activeFlowKey: string | null;
  activeFlowStep: string | null;
  flowStateJson?: string | null;
  lastAutoReplyAt: Date | null;
  lastMatchedRuleId?: string | null;
  automationPausedUntil?: Date | null;
  welcomeSentAt?: Date | null;
  awayReplySentAt?: Date | null;
};

export async function expireStaleConversationWorkflowIfNeeded<T extends ConversationAutomationTimeoutState | null>(input: {
  workspaceId: string;
  conversationId: string;
  state: T;
}): Promise<T> {
  const state = input.state;
  if (!state?.activeFlowStep || state.activeFlowKey !== "CONVERSATION_WORKFLOW" || !state.lastAutoReplyAt) {
    return state;
  }

  const { expireAfterHours } = await getPlatformAutomationWorkflowConfig();
  const expireAfterMs = expireAfterHours * 60 * 60 * 1000;
  if (Date.now() - state.lastAutoReplyAt.getTime() < expireAfterMs) {
    return state;
  }

  const pendingFutureJob = await prisma.automationJob.findFirst({
    where: {
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      status: {
        in: [AutomationJobStatus.PENDING, AutomationJobStatus.RUNNING]
      },
      runAt: {
        gt: new Date()
      }
    },
    select: {
      id: true
    }
  });

  if (pendingFutureJob) {
    return state;
  }

  const previousFlowState = parseFlowState(state.flowStateJson ?? null);
  const expiredAt = new Date();

  const nextFlowStateJson = JSON.stringify({
    ...previousFlowState,
    endedAt: expiredAt.toISOString(),
    endStepId: state.activeFlowStep,
    endReason: "WORKFLOW_INACTIVITY_TIMEOUT"
  });

  await prisma.conversationAutomationState.update({
    where: {
      conversationId: input.conversationId
    },
    data: {
      activeFlowKey: null,
      activeFlowStep: null,
      flowStateJson: nextFlowStateJson
    }
  });

  return {
    ...state,
    activeFlowKey: null,
    activeFlowStep: null,
    flowStateJson: nextFlowStateJson
  };
}

function parseFlowState(value: string | null) {
  if (!value) {
    return {};
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
