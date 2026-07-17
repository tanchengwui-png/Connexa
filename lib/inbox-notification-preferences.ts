import { prisma } from "@/lib/prisma";

export function isMissingAgentInboxNotificationSoundsMutedColumnError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  const candidate = error as Error & { code?: string; meta?: { column?: string } };
  return (
    candidate.code === "P2022" &&
    (candidate.meta?.column === "Agent.inboxNotificationSoundsMuted" ||
      candidate.message.includes("Agent.inboxNotificationSoundsMuted"))
  );
}

export function isMissingAgentInboxDesktopNotificationsPromptDismissedColumnError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  const candidate = error as Error & { code?: string; meta?: { column?: string } };
  return (
    candidate.code === "P2022" &&
    (candidate.meta?.column === "Agent.inboxDesktopNotificationsPromptDismissedAt" ||
      candidate.message.includes("Agent.inboxDesktopNotificationsPromptDismissedAt"))
  );
}

export async function getAgentInboxNotificationSoundsMuted(input: {
  agentId: string;
  workspaceId: string;
}) {
  try {
    const agent = await prisma.agent.findFirst({
      where: {
        id: input.agentId,
        workspaceId: input.workspaceId
      },
      select: {
        inboxNotificationSoundsMuted: true
      }
    });

    return agent?.inboxNotificationSoundsMuted === true;
  } catch (error) {
    if (isMissingAgentInboxNotificationSoundsMutedColumnError(error)) {
      return false;
    }

    throw error;
  }
}

export async function updateAgentInboxNotificationSoundsMuted(input: {
  agentId: string;
  workspaceId: string;
  muted: boolean;
}) {
  try {
    const result = await prisma.agent.updateMany({
      where: {
        id: input.agentId,
        workspaceId: input.workspaceId
      },
      data: {
        inboxNotificationSoundsMuted: input.muted
      }
    });

    if (result.count < 1) {
      throw new Error("FORBIDDEN");
    }
  } catch (error) {
    if (isMissingAgentInboxNotificationSoundsMutedColumnError(error)) {
      throw new Error(
        "Inbox notification sound preferences are not available until the latest database migration is applied."
      );
    }

    throw error;
  }

  return {
    inboxNotificationSoundsMuted: input.muted
  };
}

export async function getAgentInboxNotificationDesktopPromptState(input: {
  agentId: string;
  workspaceId: string;
}) {
  try {
    const agent = await prisma.agent.findFirst({
      where: {
        id: input.agentId,
        workspaceId: input.workspaceId
      },
      select: {
        inboxDesktopNotificationsPromptDismissedAt: true
      }
    });

    return {
      inboxDesktopNotificationsPromptDismissedAt:
        agent?.inboxDesktopNotificationsPromptDismissedAt?.toISOString() ?? null
    };
  } catch (error) {
    if (isMissingAgentInboxDesktopNotificationsPromptDismissedColumnError(error)) {
      return {
        inboxDesktopNotificationsPromptDismissedAt: null
      };
    }

    throw error;
  }
}

export async function dismissAgentInboxDesktopNotificationsPrompt(input: {
  agentId: string;
  workspaceId: string;
}) {
  try {
    const result = await prisma.agent.updateMany({
      where: {
        id: input.agentId,
        workspaceId: input.workspaceId
      },
      data: {
        inboxDesktopNotificationsPromptDismissedAt: new Date()
      }
    });

    if (result.count < 1) {
      throw new Error("FORBIDDEN");
    }
  } catch (error) {
    if (isMissingAgentInboxDesktopNotificationsPromptDismissedColumnError(error)) {
      throw new Error(
        "Inbox desktop notification prompt preferences are not available until the latest database migration is applied."
      );
    }

    throw error;
  }

  return {
    inboxDesktopNotificationsPromptDismissedAt: new Date().toISOString()
  };
}

export function parseInboxNotificationSoundsMutedInput(input: unknown) {
  if (typeof input !== "boolean") {
    throw new Error("INVALID_INBOX_NOTIFICATION_SOUNDS_MUTED");
  }

  return input;
}

export function parseInboxDesktopNotificationsPromptDismissedInput(input: unknown) {
  if (input !== true) {
    throw new Error("INVALID_INBOX_DESKTOP_NOTIFICATIONS_PROMPT_DISMISSED");
  }

  return true;
}
