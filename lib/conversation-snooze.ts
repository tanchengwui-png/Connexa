import { ConversationSnoozeStatus } from "@/lib/db-types";
import { emitConversationToInbox } from "@/lib/inbox-realtime";
import { prisma } from "@/lib/prisma";

type ConversationSnoozeSnapshot = {
  channelId: string | null;
  conversationId: string;
  snoozeReason: string | null;
  snoozeStatus: string | null;
  snoozedUntil: Date | string | null;
  workspaceId: string;
};

export function isConversationSnoozed(input: {
  snoozeStatus?: string | null;
  snoozedUntil?: Date | string | null;
}, now = Date.now()) {
  if (input.snoozeStatus !== ConversationSnoozeStatus.ACTIVE || !input.snoozedUntil) {
    return false;
  }

  const timestamp =
    input.snoozedUntil instanceof Date
      ? input.snoozedUntil.getTime()
      : new Date(input.snoozedUntil).getTime();

  return Number.isFinite(timestamp) && timestamp > now;
}

export async function emitConversationSnoozeEvent(input: {
  action: "snoozed" | "unsnoozed";
  channelId: string | null;
  conversationId: string;
  snoozeReason: string | null;
  snoozeStatus: string | null;
  snoozedUntil: Date | string | null;
  trigger: "manual" | "expiry" | "incoming_message" | "workflow";
  workspaceId: string;
}) {
  await emitConversationToInbox({
    workspaceId: input.workspaceId,
    channelId: input.channelId,
    conversationId: input.conversationId,
    action: input.action,
    trigger: input.trigger,
    snoozedUntil: input.snoozedUntil
      ? (input.snoozedUntil instanceof Date ? input.snoozedUntil.toISOString() : new Date(input.snoozedUntil).toISOString())
      : null,
    snoozeReason: input.snoozeReason,
    snoozeStatus: input.snoozeStatus,
    timestamp: new Date().toISOString()
  });
}

export async function releaseExpiredConversationSnoozes(workspaceId: string, now = new Date()) {
  const expiredConversations = await prisma.conversation.findMany({
    where: {
      workspaceId,
      snoozeStatus: ConversationSnoozeStatus.ACTIVE,
      snoozedUntil: {
        lte: now
      }
    },
    select: {
      id: true,
      channelId: true
    }
  });

  if (!expiredConversations.length) {
    return [];
  }

  await prisma.conversation.updateMany({
    where: {
      id: {
        in: expiredConversations.map((conversation) => conversation.id)
      }
    },
    data: {
      snoozedUntil: null,
      snoozedById: null,
      snoozeReason: null,
      snoozeStatus: ConversationSnoozeStatus.EXPIRED
    }
  });

  await Promise.all(
    expiredConversations.map((conversation) =>
      emitConversationSnoozeEvent({
        action: "unsnoozed",
        channelId: conversation.channelId,
        conversationId: conversation.id,
        snoozeReason: null,
        snoozeStatus: ConversationSnoozeStatus.EXPIRED,
        snoozedUntil: null,
        trigger: "expiry",
        workspaceId
      })
    )
  );

  return expiredConversations;
}

export function getSnoozeTransitionAction(input: {
  current: ConversationSnoozeSnapshot;
  next: Pick<ConversationSnoozeSnapshot, "snoozeReason" | "snoozeStatus" | "snoozedUntil">;
}) {
  const wasSnoozed = isConversationSnoozed(input.current);
  const isSnoozed = isConversationSnoozed(input.next);

  if (!wasSnoozed && isSnoozed) {
    return "snoozed" as const;
  }

  if (wasSnoozed && !isSnoozed) {
    return "unsnoozed" as const;
  }

  return null;
}
