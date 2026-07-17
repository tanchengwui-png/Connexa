import { EventEmitter } from "node:events";
import {
  dispatchInboxWebPushForConversationEvent,
  dispatchInboxWebPushForMessageEvent
} from "@/lib/inbox-web-push";

type InboxRealtimeEmitter = {
  emit: (event: string, payload: unknown) => void;
};

export type InboxRealtimeMessageEvent = {
  channel: "personal" | "cloud";
  workspaceId: string;
  channelId: string | null;
  conversationId: string | null;
  messageId: string | null;
  from: string;
  message: string;
  direction?: "INBOUND" | "OUTBOUND" | null;
  timestamp: string;
};

export type InboxRealtimeAckEvent = {
  workspaceId: string;
  channelId: string | null;
  conversationId: string | null;
  messageId: string | null;
  providerMessageId: string;
  ack: number;
  ackStatus: "pending" | "sent" | "delivered" | "read" | "played";
  deliveryStatus: "pending" | "sent" | "delivered" | "read";
  timestamp: string;
};

export type InboxRealtimeConversationEvent = {
  workspaceId: string;
  channelId: string | null;
  conversationId: string | null;
  action: "snoozed" | "unsnoozed";
  trigger: "manual" | "expiry" | "incoming_message" | "workflow";
  snoozedUntil: string | null;
  snoozeReason: string | null;
  snoozeStatus: string | null;
  timestamp: string;
};

export type InboxRealtimeChatStateEvent = {
  workspaceId: string;
  channelId: string | null;
  conversationId: string | null;
  isMuted: boolean;
  muteExpiration: string | null;
  isArchived: boolean;
  isPinned: boolean;
  unreadCount: number;
  timestamp: string;
};

let inboxRealtimeEmitter: InboxRealtimeEmitter | null = null;
let inboxRealtimeEventBus: EventEmitter | null = null;

function getOrCreateInboxRealtimeEventBus() {
  if (!inboxRealtimeEventBus) {
    inboxRealtimeEventBus = new EventEmitter();
    inboxRealtimeEventBus.setMaxListeners(0);
  }

  return inboxRealtimeEventBus;
}

export function registerInboxRealtimeEmitter(emitter: InboxRealtimeEmitter | null | undefined) {
  inboxRealtimeEmitter = emitter && typeof emitter.emit === "function" ? emitter : null;
}

export function getInboxRealtimeEmitter() {
  return inboxRealtimeEmitter;
}

export function subscribeToInboxRealtime(
  event: string,
  listener: (payload: unknown) => void
) {
  const bus = getOrCreateInboxRealtimeEventBus();
  bus.on(event, listener);

  return () => {
    bus.off(event, listener);
  };
}

function emitInboxRealtimeEvent(event: string, payload: unknown) {
  getOrCreateInboxRealtimeEventBus().emit(event, payload);
  const emitter = getInboxRealtimeEmitter();

  if (!emitter) {
    return false;
  }

  emitter.emit(event, payload);
  return true;
}

export async function emitMessageToInbox(event: InboxRealtimeMessageEvent) {
  const bus = getOrCreateInboxRealtimeEventBus();
  const hasExternalEmitter = Boolean(getInboxRealtimeEmitter());
  const hasLocalListener =
    bus.listenerCount("inbox:message") > 0 ||
    bus.listenerCount(`workspace:${event.workspaceId}:inbox:message`) > 0 ||
    (event.conversationId ? bus.listenerCount(`conversation:${event.conversationId}:message`) > 0 : false);

  if (!hasExternalEmitter && !hasLocalListener) {
    console.warn(
      `[inbox-realtime] emitter unavailable for workspace=${event.workspaceId} conversation=${event.conversationId ?? "unknown"}`
    );
  }

  emitInboxRealtimeEvent("inbox:message", event);
  emitInboxRealtimeEvent(`workspace:${event.workspaceId}:inbox:message`, event);

  void dispatchInboxWebPushForMessageEvent({
    workspaceId: event.workspaceId,
    conversationId: event.conversationId,
    messageId: event.messageId,
    from: event.from,
    message: event.message,
    direction: event.direction ?? null,
    timestamp: event.timestamp
  }).catch((error) => {
    console.warn(
      `[inbox-web-push] message dispatch failed workspace=${event.workspaceId} conversation=${event.conversationId ?? "unknown"}`,
      error
    );
  });

  if (event.conversationId) {
    emitInboxRealtimeEvent(`conversation:${event.conversationId}:message`, event);
  }

  return hasExternalEmitter || hasLocalListener;
}

export async function emitAckToInbox(event: InboxRealtimeAckEvent) {
  const bus = getOrCreateInboxRealtimeEventBus();
  const hasExternalEmitter = Boolean(getInboxRealtimeEmitter());
  const hasLocalListener =
    bus.listenerCount("inbox:ack") > 0 ||
    bus.listenerCount(`workspace:${event.workspaceId}:inbox:ack`) > 0 ||
    (event.conversationId ? bus.listenerCount(`conversation:${event.conversationId}:ack`) > 0 : false);

  if (!hasExternalEmitter && !hasLocalListener) {
    console.warn(
      `[inbox-realtime] ack emitter unavailable for workspace=${event.workspaceId} conversation=${event.conversationId ?? "unknown"}`
    );
  }

  emitInboxRealtimeEvent("inbox:ack", event);
  emitInboxRealtimeEvent(`workspace:${event.workspaceId}:inbox:ack`, event);

  if (event.conversationId) {
    emitInboxRealtimeEvent(`conversation:${event.conversationId}:ack`, event);
  }

  return hasExternalEmitter || hasLocalListener;
}

export async function emitConversationToInbox(event: InboxRealtimeConversationEvent) {
  const bus = getOrCreateInboxRealtimeEventBus();
  const hasExternalEmitter = Boolean(getInboxRealtimeEmitter());
  const hasLocalListener =
    bus.listenerCount("inbox:conversation") > 0 ||
    bus.listenerCount(`workspace:${event.workspaceId}:inbox:conversation`) > 0 ||
    (event.conversationId ? bus.listenerCount(`conversation:${event.conversationId}:conversation`) > 0 : false);

  if (!hasExternalEmitter && !hasLocalListener) {
    console.warn(
      `[inbox-realtime] conversation emitter unavailable for workspace=${event.workspaceId} conversation=${event.conversationId ?? "unknown"}`
    );
  }

  emitInboxRealtimeEvent("inbox:conversation", event);
  emitInboxRealtimeEvent(`workspace:${event.workspaceId}:inbox:conversation`, event);

  void dispatchInboxWebPushForConversationEvent({
    workspaceId: event.workspaceId,
    conversationId: event.conversationId,
    action: event.action,
    trigger: event.trigger,
    timestamp: event.timestamp
  }).catch((error) => {
    console.warn(
      `[inbox-web-push] conversation dispatch failed workspace=${event.workspaceId} conversation=${event.conversationId ?? "unknown"}`,
      error
    );
  });

  if (event.conversationId) {
    emitInboxRealtimeEvent(`conversation:${event.conversationId}:conversation`, event);
  }

  return hasExternalEmitter || hasLocalListener;
}

export async function emitChatStateToInbox(event: InboxRealtimeChatStateEvent) {
  const bus = getOrCreateInboxRealtimeEventBus();
  const hasExternalEmitter = Boolean(getInboxRealtimeEmitter());
  const hasLocalListener =
    bus.listenerCount("inbox:chat-state") > 0 ||
    bus.listenerCount(`workspace:${event.workspaceId}:inbox:chat-state`) > 0 ||
    (event.conversationId ? bus.listenerCount(`conversation:${event.conversationId}:chat-state`) > 0 : false);

  if (!hasExternalEmitter && !hasLocalListener) {
    console.warn(
      `[inbox-realtime] chat-state emitter unavailable for workspace=${event.workspaceId} conversation=${event.conversationId ?? "unknown"}`
    );
  }

  emitInboxRealtimeEvent("inbox:chat-state", event);
  emitInboxRealtimeEvent(`workspace:${event.workspaceId}:inbox:chat-state`, event);

  if (event.conversationId) {
    emitInboxRealtimeEvent(`conversation:${event.conversationId}:chat-state`, event);
  }

  return hasExternalEmitter || hasLocalListener;
}
