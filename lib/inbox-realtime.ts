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
  // Set only by the personal whatsapp-web.js lifecycle classifier. Cloud/API
  // callers omit this and retain their established notification behavior.
  notificationEligible?: boolean;
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

export type WhatsAppConnectionRealtimeEvent = {
  workspaceId: string;
  channelId: string;
  connectionStatus: string;
  updatedAt: string;
  displayName?: string | null;
  phoneNumber?: string | null;
  connectedAt?: string | null;
  lastError?: string | null;
  connectionAttemptId?: string | null;
  eventSequence?: number;
  qrVersion?: number;
  qrCodeDataUrl?: string | null;
  qrCodeGeneratedAt?: string | null;
  qrCodeExpiresAt?: string | null;
  qrCodeExpired?: boolean;
  snapshot?: boolean;
};

let inboxRealtimeEmitter: InboxRealtimeEmitter | null = null;
let inboxRealtimeEventBus: EventEmitter | null = null;
const RELAYED_INBOX_EVENTS = new Set([
  "inbox:message",
  "inbox:ack",
  "inbox:conversation",
  "inbox:chat-state",
  "whatsapp:connection"
]);

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

function relayInboxRealtimeEvent(event: string, payload: unknown) {
  const relayUrl = process.env.INBOX_REALTIME_RELAY_URL?.trim().replace(/\/$/, "");
  const relayToken = process.env.SENDER_SERVICE_TOKEN?.trim();
  if (!relayUrl || !relayToken || !RELAYED_INBOX_EVENTS.has(event)) {
    return;
  }

  void fetch(`${relayUrl}/api/internal/inbox-events`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-sender-token": relayToken
    },
    body: JSON.stringify({ event, payload })
  }).then((response) => {
    if (!response.ok) {
      console.warn(`[inbox-realtime] relay failed event=${event} status=${response.status}`);
    }
  }).catch((error) => {
    console.warn(
      `[inbox-realtime] relay unavailable event=${event}: ${
        error instanceof Error ? error.message : "Unknown relay error."
      }`
    );
  });
}

function isInboxRealtimeRelayConfigured() {
  return Boolean(
    process.env.INBOX_REALTIME_RELAY_URL?.trim() &&
    process.env.SENDER_SERVICE_TOKEN?.trim()
  );
}

export function emitRelayedInboxRealtimeEvent(event: string, payload: unknown) {
  if (!RELAYED_INBOX_EVENTS.has(event)) {
    return false;
  }

  return emitInboxRealtimeEvent(event, payload);
}

export function emitWhatsAppConnectionToInbox(event: WhatsAppConnectionRealtimeEvent) {
  emitInboxRealtimeEvent("whatsapp:connection", event);
  relayInboxRealtimeEvent("whatsapp:connection", event);
}

export async function emitMessageToInbox(event: InboxRealtimeMessageEvent) {
  const bus = getOrCreateInboxRealtimeEventBus();
  const hasExternalEmitter = Boolean(getInboxRealtimeEmitter());
  const hasRelay = isInboxRealtimeRelayConfigured();
  const hasLocalListener =
    bus.listenerCount("inbox:message") > 0 ||
    bus.listenerCount(`workspace:${event.workspaceId}:inbox:message`) > 0 ||
    (event.conversationId ? bus.listenerCount(`conversation:${event.conversationId}:message`) > 0 : false);

  if (!hasExternalEmitter && !hasLocalListener && !hasRelay) {
    console.warn(
      `[inbox-realtime] emitter unavailable for workspace=${event.workspaceId} conversation=${event.conversationId ?? "unknown"}`
    );
  }

  emitInboxRealtimeEvent("inbox:message", event);
  emitInboxRealtimeEvent(`workspace:${event.workspaceId}:inbox:message`, event);
  relayInboxRealtimeEvent("inbox:message", event);

  if (event.notificationEligible !== false) void dispatchInboxWebPushForMessageEvent({
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

  return hasExternalEmitter || hasLocalListener || hasRelay;
}

export async function emitAckToInbox(event: InboxRealtimeAckEvent) {
  const bus = getOrCreateInboxRealtimeEventBus();
  const hasExternalEmitter = Boolean(getInboxRealtimeEmitter());
  const hasRelay = isInboxRealtimeRelayConfigured();
  const hasLocalListener =
    bus.listenerCount("inbox:ack") > 0 ||
    bus.listenerCount(`workspace:${event.workspaceId}:inbox:ack`) > 0 ||
    (event.conversationId ? bus.listenerCount(`conversation:${event.conversationId}:ack`) > 0 : false);

  if (!hasExternalEmitter && !hasLocalListener && !hasRelay) {
    console.warn(
      `[inbox-realtime] ack emitter unavailable for workspace=${event.workspaceId} conversation=${event.conversationId ?? "unknown"}`
    );
  }

  emitInboxRealtimeEvent("inbox:ack", event);
  emitInboxRealtimeEvent(`workspace:${event.workspaceId}:inbox:ack`, event);
  relayInboxRealtimeEvent("inbox:ack", event);

  if (event.conversationId) {
    emitInboxRealtimeEvent(`conversation:${event.conversationId}:ack`, event);
  }

  return hasExternalEmitter || hasLocalListener || hasRelay;
}

export async function emitConversationToInbox(event: InboxRealtimeConversationEvent) {
  const bus = getOrCreateInboxRealtimeEventBus();
  const hasExternalEmitter = Boolean(getInboxRealtimeEmitter());
  const hasRelay = isInboxRealtimeRelayConfigured();
  const hasLocalListener =
    bus.listenerCount("inbox:conversation") > 0 ||
    bus.listenerCount(`workspace:${event.workspaceId}:inbox:conversation`) > 0 ||
    (event.conversationId ? bus.listenerCount(`conversation:${event.conversationId}:conversation`) > 0 : false);

  if (!hasExternalEmitter && !hasLocalListener && !hasRelay) {
    console.warn(
      `[inbox-realtime] conversation emitter unavailable for workspace=${event.workspaceId} conversation=${event.conversationId ?? "unknown"}`
    );
  }

  emitInboxRealtimeEvent("inbox:conversation", event);
  emitInboxRealtimeEvent(`workspace:${event.workspaceId}:inbox:conversation`, event);
  relayInboxRealtimeEvent("inbox:conversation", event);

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

  return hasExternalEmitter || hasLocalListener || hasRelay;
}

export async function emitChatStateToInbox(event: InboxRealtimeChatStateEvent) {
  const bus = getOrCreateInboxRealtimeEventBus();
  const hasExternalEmitter = Boolean(getInboxRealtimeEmitter());
  const hasRelay = isInboxRealtimeRelayConfigured();
  const hasLocalListener =
    bus.listenerCount("inbox:chat-state") > 0 ||
    bus.listenerCount(`workspace:${event.workspaceId}:inbox:chat-state`) > 0 ||
    (event.conversationId ? bus.listenerCount(`conversation:${event.conversationId}:chat-state`) > 0 : false);

  if (!hasExternalEmitter && !hasLocalListener && !hasRelay) {
    console.warn(
      `[inbox-realtime] chat-state emitter unavailable for workspace=${event.workspaceId} conversation=${event.conversationId ?? "unknown"}`
    );
  }

  emitInboxRealtimeEvent("inbox:chat-state", event);
  emitInboxRealtimeEvent(`workspace:${event.workspaceId}:inbox:chat-state`, event);
  relayInboxRealtimeEvent("inbox:chat-state", event);

  if (event.conversationId) {
    emitInboxRealtimeEvent(`conversation:${event.conversationId}:chat-state`, event);
  }

  return hasExternalEmitter || hasLocalListener || hasRelay;
}
