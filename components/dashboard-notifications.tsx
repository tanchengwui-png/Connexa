"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  EMPTY_HISTORY_SYNC_BELL_STATE,
  acknowledgeHistorySyncBell,
  applyHistorySyncStatus,
  getHistorySyncNotificationId,
  parseHistorySyncBellState,
  queueHistorySyncRecheck,
  type HistorySyncBellState
} from "@/lib/history-sync-bell";
import {
  readInboxDesktopNotificationsDisabled,
  showInboxDesktopNotificationFromPage
} from "@/lib/inbox-browser-notifications-client";
import { playInboxNotificationTone } from "@/lib/inbox-notification-sound-client";
import { useInboxNotificationSoundPreference } from "@/lib/use-inbox-notification-sound-preference";

type DashboardNotification = {
  id: string;
  conversationId: string | null;
  contactName: string;
  channelLabel: string | null;
  kind?: "message" | "snooze-expired" | "history-sync-complete";
  message: string;
  timestamp: string;
  timestampLabel: string;
};

type HistorySyncStatusResponse = {
  checkedAt: string;
  isCaughtUp: boolean;
  version: string | null;
  channels: Array<{
    channelId: string;
    channelLabel: string;
    completedAt: string | null;
    isCaughtUp: boolean;
  }>;
};

type NotificationConversation = {
  id: string;
  channelLabel: string | null;
  contactName: string;
  phone: string;
  isMuted: boolean;
  isSnoozed: boolean;
  unreadCount: number;
  lastMessagePreview: string;
  lastMessageDirection?: string | null;
  lastMessageAt: string;
  lastMessageAtIso: string;
  snoozeReason: string | null;
  snoozedUntil: string | null;
  snoozedUntilIso: string | null;
};

const NOTIFICATION_EVENT = "connexa:inbox-notification";
const MAX_NOTIFICATIONS = 8;

export function DashboardNotifications(props: {
  agentId: string | null;
  workspaceId: string | null;
  initialInboxNotificationSoundsMuted: boolean;
}) {
  const pathname = usePathname();
  const isInboxRoute = pathname === "/inbox" || Boolean(pathname?.startsWith("/inbox/"));
  const panelRef = useRef<HTMLDivElement | null>(null);
  const notificationIdsRef = useRef<Set<string>>(new Set());
  const conversationSnapshotRef = useRef<Map<string, NotificationConversation>>(new Map());
  const hasConversationSnapshotRef = useRef(false);
  const historySyncBellStateRef = useRef<HistorySyncBellState>({
    ...EMPTY_HISTORY_SYNC_BELL_STATE
  });
  const persistHistorySyncBellStateRef = useRef<(state: HistorySyncBellState) => void>(() => undefined);
  const refreshHistorySyncStatusRef = useRef<() => void>(() => undefined);
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<DashboardNotification[]>([]);
  useInboxNotificationSoundPreference({
    agentId: props.agentId ?? "anonymous",
    workspaceId: props.workspaceId ?? "anonymous",
    initialMuted: props.initialInboxNotificationSoundsMuted
  });
  const unreadCount = notifications.length;

  useEffect(() => {
    const handleNotification = (event: Event) => {
      const detail = (event as CustomEvent<DashboardNotification>).detail;
      if (!detail?.id || !detail.conversationId) {
        return;
      }

      if (detail.kind === "message") {
        const queued = queueHistorySyncRecheck(
          historySyncBellStateRef.current,
          new Date().toISOString()
        );
        if (queued.state !== historySyncBellStateRef.current) {
          historySyncBellStateRef.current = queued.state;
          persistHistorySyncBellStateRef.current(queued.state);
        }
        if (queued.invalidatedNotificationKey) {
          const invalidatedId = getHistorySyncNotificationId(queued.invalidatedNotificationKey);
          notificationIdsRef.current.delete(invalidatedId);
          setNotifications((current) => current.filter((item) => item.id !== invalidatedId));
        }
        if (queued.state.pendingAfter) {
          refreshHistorySyncStatusRef.current();
        }
      }

      if (notificationIdsRef.current.has(detail.id)) {
        return;
      }

      notificationIdsRef.current.add(detail.id);
      setNotifications((current) => {
        const next = [detail, ...current.filter((item) => item.id !== detail.id)];
        return next.slice(0, MAX_NOTIFICATIONS);
      });

      if (
        props.workspaceId &&
        props.agentId &&
        !readInboxDesktopNotificationsDisabled({
          agentId: props.agentId,
          workspaceId: props.workspaceId
        }) &&
        typeof document !== "undefined" &&
        document.visibilityState !== "visible" &&
        typeof Notification !== "undefined" &&
        Notification.permission === "granted"
      ) {
        void showInboxDesktopNotificationFromPage({
          body: detail.message,
          conversationId: detail.conversationId,
          createdAt: detail.timestamp,
          eventId: detail.id,
          notificationId: detail.id,
          title: detail.contactName || "New Inbox message",
          url: `/inbox?conversationId=${encodeURIComponent(detail.conversationId)}`,
          workspaceId: props.workspaceId
        });
      }

      if (props.agentId && props.workspaceId) {
        playInboxNotificationTone({
          agentId: props.agentId,
          workspaceId: props.workspaceId
        });
      }
    };

    window.addEventListener(NOTIFICATION_EVENT, handleNotification);
    return () => window.removeEventListener(NOTIFICATION_EVENT, handleNotification);
  }, []);

  useEffect(() => {
    if (!props.agentId || !props.workspaceId || isInboxRoute) {
      return undefined;
    }

    const storageKey = `connexa:history-sync-bell:${props.workspaceId}:${props.agentId}`;
    let isMounted = true;
    let refreshController: AbortController | null = null;
    let refreshPromise: Promise<void> | null = null;

    const persistState = (state: HistorySyncBellState) => {
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(state));
      } catch {
        // Private browsing or a locked-down browser can disable local storage.
      }
    };

    try {
      historySyncBellStateRef.current = parseHistorySyncBellState(
        window.localStorage.getItem(storageKey)
      );
    } catch {
      historySyncBellStateRef.current = { ...EMPTY_HISTORY_SYNC_BELL_STATE };
    }
    persistHistorySyncBellStateRef.current = persistState;

    const refreshStatus = () => {
      if (refreshPromise || document.visibilityState !== "visible") {
        return;
      }

      refreshController?.abort();
      refreshController = new AbortController();
      refreshPromise = (async () => {
        const response = await fetch("/api/inbox/history-sync-status", {
          method: "GET",
          cache: "no-store",
          signal: refreshController?.signal
        }).catch(() => null);

        if (!response?.ok || !isMounted) {
          return;
        }

        const status = (await response.json().catch(() => null)) as HistorySyncStatusResponse | null;
        if (!status || !Array.isArray(status.channels)) {
          return;
        }

        const decision = applyHistorySyncStatus(historySyncBellStateRef.current, status);
        historySyncBellStateRef.current = decision.state;
        persistState(decision.state);

        if (!decision.shouldPresent || !decision.state.notificationKey) {
          return;
        }

        const id = getHistorySyncNotificationId(decision.state.notificationKey);
        if (notificationIdsRef.current.has(id)) {
          return;
        }

        const onlyChannel = status.channels.length === 1 ? status.channels[0] : null;
        notificationIdsRef.current.add(id);
        setNotifications((current) => [
          {
            id,
            conversationId: null,
            contactName: "WhatsApp history is ready",
            channelLabel: onlyChannel?.channelLabel ?? null,
            kind: "history-sync-complete" as const,
            message: "All chat history has been imported and Connexa is caught up.",
            timestamp: status.checkedAt,
            timestampLabel: "Sync complete"
          },
          ...current.filter((item) => item.id !== id)
        ].slice(0, MAX_NOTIFICATIONS));
      })().finally(() => {
        refreshPromise = null;
      });
    };

    refreshHistorySyncStatusRef.current = refreshStatus;
    refreshStatus();

    const interval = window.setInterval(refreshStatus, 60_000);
    window.addEventListener("focus", refreshStatus);
    document.addEventListener("visibilitychange", refreshStatus);

    return () => {
      isMounted = false;
      refreshController?.abort();
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshStatus);
      document.removeEventListener("visibilitychange", refreshStatus);
      persistHistorySyncBellStateRef.current = () => undefined;
      refreshHistorySyncStatusRef.current = () => undefined;
    };
  }, [isInboxRoute, props.agentId, props.workspaceId]);

  useEffect(() => {
    if (isInboxRoute) {
      return undefined;
    }

    let isMounted = true;
    let refreshController: AbortController | null = null;

    const refreshNotifications = async () => {
      if (document.visibilityState !== "visible") {
        return;
      }

      refreshController?.abort();
      refreshController = new AbortController();

      const response = await fetch("/api/inbox/unread-summary", {
        method: "GET",
        cache: "no-store",
        signal: refreshController.signal
      }).catch(() => null);

      if (!response?.ok || !isMounted) {
        return;
      }

      const payload = (await response.json().catch(() => null)) as
        | { conversations?: NotificationConversation[] }
        | null;
      const nextConversations = payload?.conversations ?? [];
      const previousSnapshot = conversationSnapshotRef.current;

      if (hasConversationSnapshotRef.current) {
        publishIncomingConversationNotifications(previousSnapshot, nextConversations);
      } else {
        hasConversationSnapshotRef.current = true;
      }

      conversationSnapshotRef.current = new Map(
        nextConversations.map((conversation) => [conversation.id, conversation])
      );
    };

    const runRefresh = () => {
      void refreshNotifications();
    };

    runRefresh();

    const interval = window.setInterval(runRefresh, 60_000);
    window.addEventListener("focus", runRefresh);
    document.addEventListener("visibilitychange", runRefresh);

    return () => {
      isMounted = false;
      refreshController?.abort();
      window.clearInterval(interval);
      window.removeEventListener("focus", runRefresh);
      document.removeEventListener("visibilitychange", runRefresh);
    };
  }, [isInboxRoute]);

  useEffect(() => {
    const publishExpiredSnoozeReminders = () => {
      if (document.visibilityState !== "visible") {
        return;
      }

      conversationSnapshotRef.current.forEach((conversation) => {
        const detail = createSnoozeExpiryNotification(conversation);
        if (!detail || notificationIdsRef.current.has(detail.id)) {
          return;
        }

        window.dispatchEvent(
          new CustomEvent<DashboardNotification>(NOTIFICATION_EVENT, {
            detail
          })
        );
      });
    };

    publishExpiredSnoozeReminders();
    const interval = window.setInterval(publishExpiredSnoozeReminders, 1000);

    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const acknowledgeHistorySyncNotification = () => {
    const nextState = acknowledgeHistorySyncBell(historySyncBellStateRef.current);
    if (nextState !== historySyncBellStateRef.current) {
      historySyncBellStateRef.current = nextState;
      persistHistorySyncBellStateRef.current(nextState);
    }
  };

  const toggleNotifications = () => {
    if (!isOpen) {
      acknowledgeHistorySyncNotification();
    }
    setIsOpen((current) => !current);
  };

  const clearNotifications = () => {
    acknowledgeHistorySyncNotification();
    setNotifications([]);
    setIsOpen(false);
  };

  return (
    <div className={`dashboard-notifications${isOpen ? " open" : ""}`} ref={panelRef}>
      <Button
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-label="Notifications"
        className="dashboard-topbar-icon-button"
        onClick={toggleNotifications}
        selected={isOpen}
        variant="icon"
      >
        <BellGlyph />
        {unreadCount ? <span className="dashboard-topbar-notification-badge">{unreadCount}</span> : null}
      </Button>

      {isOpen ? (
        <div aria-label="Inbox notifications" className="dashboard-notification-panel" role="dialog">
          <div className="dashboard-notification-head">
            <strong>Notifications</strong>
            {notifications.length ? (
              <Button onClick={clearNotifications} variant="ghost">
                Clear
              </Button>
            ) : null}
          </div>

          {notifications.length ? (
            <div className="dashboard-notification-list">
              {notifications.map((notification) => (
                <a
                  className="dashboard-notification-item"
                  href={notification.conversationId
                    ? `/inbox?conversationId=${encodeURIComponent(notification.conversationId)}`
                    : "/inbox"}
                  key={notification.id}
                  onClick={() => setIsOpen(false)}
                >
                  <span>{notification.timestampLabel}</span>
                  <strong>{notification.contactName}</strong>
                  {notification.channelLabel ? <span>via {notification.channelLabel}</span> : null}
                  <p>{notification.message}</p>
                </a>
              ))}
            </div>
          ) : (
            <div className="dashboard-notification-empty">
              <strong>No new notifications</strong>
              <span>Incoming messages and completed history syncs will appear here.</span>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function publishIncomingConversationNotifications(
  previousSnapshot: Map<string, NotificationConversation>,
  nextConversations: NotificationConversation[]
) {
  nextConversations.forEach((conversation) => {
    const previous = previousSnapshot.get(conversation.id);
    const previousUnreadCount = previous?.unreadCount ?? 0;
    const hasMoreUnread = conversation.unreadCount > previousUnreadCount;
    const hasNewerMessage =
      !previous ||
      new Date(conversation.lastMessageAtIso).getTime() > new Date(previous.lastMessageAtIso).getTime();
    const isInboundCustomerMessage = conversation.lastMessageDirection === "INBOUND";

    if (!hasMoreUnread || !hasNewerMessage || !isInboundCustomerMessage || conversation.isMuted) {
      const detail = previous ? createSnoozeExpiryNotification(previous, conversation) : null;
      if (!detail) {
        return;
      }

      window.dispatchEvent(
        new CustomEvent<DashboardNotification>(NOTIFICATION_EVENT, {
          detail
        })
      );
      return;
    }

    window.dispatchEvent(
      new CustomEvent<DashboardNotification>(NOTIFICATION_EVENT, {
        detail: {
          id: `${conversation.id}:${conversation.lastMessageAtIso}:${conversation.unreadCount}`,
          conversationId: conversation.id,
          contactName: conversation.contactName || conversation.phone,
          channelLabel: conversation.channelLabel,
          kind: "message",
          message: conversation.lastMessagePreview || "New incoming message",
          timestamp: conversation.lastMessageAtIso,
          timestampLabel: conversation.lastMessageAt || "Just now"
        }
      })
    );
  });
}

function createSnoozeExpiryNotification(
  conversation: NotificationConversation,
  currentConversation?: NotificationConversation
) {
  if (!conversation.isSnoozed || !conversation.snoozedUntilIso) {
    return null;
  }

  if (new Date(conversation.snoozedUntilIso).getTime() > Date.now()) {
    return null;
  }

  if (currentConversation && currentConversation.isSnoozed) {
    return null;
  }

  return {
    id: `${conversation.id}:snooze:expiry:${conversation.snoozedUntilIso}`,
    conversationId: conversation.id,
    contactName: conversation.contactName || conversation.phone,
    channelLabel: conversation.channelLabel,
    kind: "snooze-expired" as const,
    message: conversation.snoozeReason?.trim()
      ? `Snooze expired: ${conversation.snoozeReason}`
      : "Snooze expired. Conversation returned to the queue.",
    timestamp: conversation.snoozedUntilIso,
    timestampLabel: conversation.snoozedUntil ?? "Snooze expired"
  };
}

function BellGlyph() {
  return (
    <svg aria-hidden="true" fill="none" height="17" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="17">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}
