import { createHash } from "node:crypto";
import { requireCurrentWorkspaceId } from "@/lib/auth/current-user";
import { listConversationsPage } from "@/lib/conversations";
import { ConversationStatus } from "@/lib/db-types";
import { getConversationScheduledStats } from "@/lib/scheduled-messages";

const DISPLAY_TIME_ZONE = "Asia/Kuala_Lumpur";
const statusLabels: Record<ConversationStatus, string> = {
  OPEN: "Open",
  PENDING: "Pending",
  CLOSED: "Closed"
};

export async function getInboxConversationListPage(input: {
  channelId?: string | null;
  cursor?: string | null;
  limit?: number;
}) {
  const result = await listConversationsPage(input);
  const scheduledStats = await getConversationScheduledStats(
    // listConversationsPage has already enforced workspace authorization. The
    // stats helper still needs the id, so derive it through the scoped rows by
    // using the current workspace helper internally in its existing API.
    await requireCurrentWorkspaceId(),
    result.conversations.map((conversation) => conversation.id)
  );
  const conversations = result.conversations.map((conversation) => ({
    id: conversation.id,
    channelId: conversation.channelId ?? null,
    channelLabel: conversation.channelLabel ?? null,
    contactName: conversation.contactName,
    photoUrl: conversation.photoUrl ?? null,
    profilePicUrl: getInboxProfilePictureUrl(conversation.id, conversation.photoUrl),
    phone: conversation.phone,
    isGroup: conversation.isGroup,
    tags: conversation.tags,
    status: statusLabels[conversation.status as ConversationStatus] ?? conversation.status,
    isSnoozed: conversation.isSnoozed,
    snoozedUntil:
      conversation.isSnoozed && conversation.snoozedUntil
        ? `Snoozed until ${formatTimestamp(conversation.snoozedUntil)}`
        : null,
    snoozedUntilIso:
      conversation.isSnoozed && conversation.snoozedUntil ? conversation.snoozedUntil.toISOString() : null,
    snoozeReason: conversation.isSnoozed ? conversation.snoozeReason : null,
    snoozeStatus: conversation.snoozeStatus,
    snoozedBy: conversation.isSnoozed ? conversation.snoozedBy : null,
    isMuted: conversation.isMuted,
    muteExpiration: conversation.muteExpiration ? formatTimestamp(conversation.muteExpiration) : null,
    muteExpirationIso: conversation.muteExpiration?.toISOString() ?? null,
    isArchived: conversation.isArchived,
    isPinned: conversation.isPinned,
    unreadCount: conversation.unreadCount,
    isHotLead: conversation.isHotLead,
    scheduledCount: scheduledStats.get(conversation.id)?.scheduledCount ?? 0,
    nextScheduledAt: scheduledStats.get(conversation.id)?.nextScheduledAt
      ? formatTimestamp(scheduledStats.get(conversation.id)!.nextScheduledAt as Date)
      : null,
    nextScheduledAtIso: scheduledStats.get(conversation.id)?.nextScheduledAt?.toISOString() ?? null,
    assigneeId: conversation.assignee?.id ?? null,
    assignee: conversation.assignee?.name ?? "Unassigned",
    teammateIds: conversation.teammates.map((teammate) => teammate.id),
    teammates: conversation.teammates,
    lastMessagePreview: sanitizeListText(conversation.lastMessagePreview) || "No recent messages",
    lastMessageDirection: conversation.lastMessageDirection,
    lastMessageAt: formatTimestamp(conversation.lastMessageAt),
    lastMessageAtIso: conversation.lastMessageAt.toISOString()
  }));
  const version = createHash("sha1")
    .update(conversations.map((item) => `${item.id}:${item.lastMessageAtIso}:${item.unreadCount}`).join("|"))
    .digest("hex");
  return { conversations, page: result.page, version };
}

function formatTimestamp(date: Date) {
  return new Intl.DateTimeFormat("en-MY", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: DISPLAY_TIME_ZONE
  }).format(date);
}

function sanitizeListText(value?: string | null) {
  return value?.replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim() ?? "";
}

function getInboxProfilePictureUrl(conversationId: string, photoUrl: string | null | undefined) {
  const normalized = photoUrl?.trim();
  if (!normalized) return null;
  if (normalized.startsWith("/api/uploads/")) return normalized;
  if (normalized.startsWith("/uploads/")) return `/api${normalized}`;
  return `/api/conversations/${conversationId}/avatar`;
}
