import type { InboxMessage, InboxSelectedConversation } from "@/components/inbox/types";

export function getStableInboxMessageKey(message: Pick<InboxMessage, "id" | "providerMessageId" | "sentAtIso" | "direction" | "sender">) {
  const normalizedId = `${message.id ?? ""}`.trim();
  if (normalizedId) {
    return `id:${normalizedId}`;
  }

  const normalizedProviderMessageId = `${message.providerMessageId ?? ""}`.trim();
  if (normalizedProviderMessageId) {
    return `provider:${normalizedProviderMessageId}`;
  }

  return `fallback:${message.sentAtIso}:${message.direction}:${message.sender}`;
}

export function normalizeInboxSelectedConversation(
  conversation: InboxSelectedConversation | null | undefined
): InboxSelectedConversation | null {
  if (!conversation) {
    return null;
  }

  return {
    ...conversation,
    messages: normalizeInboxMessages(conversation.messages)
  };
}

export function normalizeInboxMessages(messages: InboxMessage[]) {
  const mergedByKey = new Map<string, InboxMessage>();

  for (const message of messages) {
    const normalizedMessage = normalizeInboxMessage(message);
    const stableKey = getStableInboxMessageKey(normalizedMessage);
    const existing = mergedByKey.get(stableKey);

    if (!existing) {
      mergedByKey.set(stableKey, normalizedMessage);
      continue;
    }

    mergedByKey.set(stableKey, mergeInboxMessages(existing, normalizedMessage));
  }

  return Array.from(mergedByKey.values()).sort((left, right) => {
    if (left.sentAtIso === right.sentAtIso) {
      return getStableInboxMessageKey(left).localeCompare(getStableInboxMessageKey(right));
    }

    return left.sentAtIso.localeCompare(right.sentAtIso);
  });
}

export function normalizeInboxMessage(message: InboxMessage): InboxMessage {
  return {
    ...message,
    id: `${message.id ?? ""}`.trim() || buildFallbackMessageId(message),
    body: normalizeMessageText(message.body),
    sender: normalizeInlineText(message.sender, "Unknown sender"),
    attachmentMimeType: normalizeNullableText(message.attachmentMimeType),
    attachmentName: normalizeNullableText(message.attachmentName),
    attachmentUrl: normalizeNullableText(message.attachmentUrl),
    providerMessageId: normalizeNullableText(message.providerMessageId),
    replyToMessageId: normalizeNullableText(message.replyToMessageId),
    replyToMessage: message.replyToMessage
      ? {
          ...message.replyToMessage,
          id: `${message.replyToMessage.id ?? ""}`.trim(),
          body: normalizeNullableMessageText(message.replyToMessage.body),
          attachmentName: normalizeNullableText(message.replyToMessage.attachmentName),
          sender: normalizeNullableText(message.replyToMessage.sender)
        }
      : null,
    reactions: dedupeReactions(message.reactions)
  };
}

function mergeInboxMessages(existing: InboxMessage, incoming: InboxMessage): InboxMessage {
  const existingBody = normalizeMessageText(existing.body);
  const incomingBody = normalizeMessageText(incoming.body);

  return {
    ...existing,
    ...incoming,
    id: existing.id || incoming.id,
    providerMessageId: existing.providerMessageId || incoming.providerMessageId,
    body: pickRicherText(existingBody, incomingBody),
    sender: pickRicherText(existing.sender, incoming.sender),
    attachmentMimeType: pickNullableValue(existing.attachmentMimeType, incoming.attachmentMimeType),
    attachmentName: pickNullableValue(existing.attachmentName, incoming.attachmentName),
    attachmentUrl: pickNullableValue(existing.attachmentUrl, incoming.attachmentUrl),
    replyToMessageId: pickNullableValue(existing.replyToMessageId, incoming.replyToMessageId),
    replyToMessage: mergeReplyTargets(existing.replyToMessage, incoming.replyToMessage),
    reactions: dedupeReactions([...(existing.reactions ?? []), ...(incoming.reactions ?? [])]),
    ack: pickGreaterNumber(existing.ack, incoming.ack),
    ackUpdatedAt: pickNullableValue(existing.ackUpdatedAt, incoming.ackUpdatedAt),
    deletedAt: pickNullableValue(existing.deletedAt, incoming.deletedAt),
    deliveryStatus: pickDeliveryStatus(existing.deliveryStatus, incoming.deliveryStatus)
  };
}

function mergeReplyTargets(
  existing: InboxMessage["replyToMessage"],
  incoming: InboxMessage["replyToMessage"]
): InboxMessage["replyToMessage"] {
  if (!existing) {
    return incoming ?? null;
  }

  if (!incoming) {
    return existing;
  }

  return {
    id: existing.id || incoming.id,
    body: pickNullableValue(normalizeNullableMessageText(existing.body), normalizeNullableMessageText(incoming.body)),
    attachmentName: pickNullableValue(existing.attachmentName, incoming.attachmentName),
    sender: pickNullableValue(existing.sender, incoming.sender)
  };
}

function dedupeReactions(reactions: InboxMessage["reactions"]) {
  const reactionMap = new Map<string, InboxMessage["reactions"][number]>();

  for (const reaction of reactions ?? []) {
    const key = `${reaction.id}:${reaction.emoji}:${reaction.sender}:${reaction.sentAtIso}`;
    if (!reactionMap.has(key)) {
      reactionMap.set(key, reaction);
    }
  }

  return Array.from(reactionMap.values());
}

function buildFallbackMessageId(message: Pick<InboxMessage, "providerMessageId" | "sentAtIso" | "direction" | "sender" | "body">) {
  const bodyFingerprint = normalizeMessageText(message.body).slice(0, 32);
  return `fallback:${message.providerMessageId ?? ""}:${message.sentAtIso}:${message.direction}:${message.sender}:${bodyFingerprint}`;
}

function normalizeMessageText(value: unknown) {
  return normalizeInlineText(extractMessageText(value), "");
}

function normalizeNullableMessageText(value: unknown) {
  const normalized = normalizeMessageText(value);
  return normalized ? normalized : null;
}

function normalizeNullableText(value: unknown) {
  const normalized = normalizeInlineText(typeof value === "string" ? value : "", "");
  return normalized ? normalized : null;
}

function normalizeInlineText(value: string, fallback: string) {
  const normalized = value
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();

  return normalized || fallback;
}

function extractMessageText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .map((entry) => extractMessageText(entry))
      .filter(Boolean)
      .join(" ");
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["text", "body", "caption", "message"]) {
      const nested = extractMessageText(record[key]);
      if (nested) {
        return nested;
      }
    }
  }

  return "";
}

function pickRicherText(left: string, right: string) {
  if (!left) {
    return right;
  }

  if (!right) {
    return left;
  }

  if (left === right) {
    return left;
  }

  if (left.includes(right)) {
    return left;
  }

  if (right.includes(left)) {
    return right;
  }

  return right.length >= left.length ? right : left;
}

function pickNullableValue<T>(left: T | null | undefined, right: T | null | undefined) {
  return right ?? left ?? null;
}

function pickGreaterNumber(left: number | null, right: number | null) {
  if (left === null) {
    return right;
  }

  if (right === null) {
    return left;
  }

  return Math.max(left, right);
}

function pickDeliveryStatus(left: InboxMessage["deliveryStatus"], right: InboxMessage["deliveryStatus"]) {
  const rank: Record<InboxMessage["deliveryStatus"], number> = {
    pending: 0,
    sent: 1,
    delivered: 2,
    read: 3
  };

  return rank[right] >= rank[left] ? right : left;
}
