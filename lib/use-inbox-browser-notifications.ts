"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildInboxDesktopNotificationsNotNowKey,
  clearInboxDesktopNotificationsNotNow,
  disableInboxBrowserPushSubscription,
  ensureInboxBrowserPushSubscription,
  getBrowserPushPermissionState,
  persistInboxDesktopNotificationsNotNow,
  readInboxDesktopNotificationsNotNow,
  requestBrowserPushPermission,
  syncInboxNotificationMuteStateToServiceWorker
} from "@/lib/inbox-browser-notifications-client";

type UseInboxBrowserNotificationsInput = {
  agentId: string;
  workspaceId: string;
  initialMuted: boolean;
  initialPromptDismissedAt: string | null;
};

type PushStatusResponse = {
  inboxNotificationSoundsMuted?: boolean;
  inboxDesktopNotificationsPromptDismissedAt?: string | null;
  pushEnabled?: boolean;
  pushSubscriptionCount?: number;
  vapidPublicKey?: string | null;
};

export function useInboxBrowserNotifications(input: UseInboxBrowserNotificationsInput) {
  const scope = useMemo(
    () => ({
      agentId: input.agentId,
      workspaceId: input.workspaceId
    }),
    [input.agentId, input.workspaceId]
  );
  const [permissionState, setPermissionState] = useState(getBrowserPushPermissionState);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [subscriptionCount, setSubscriptionCount] = useState(0);
  const [vapidPublicKey, setVapidPublicKey] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [promptDismissedAt, setPromptDismissedAt] = useState(input.initialPromptDismissedAt);
  const [hasLocalNotNow, setHasLocalNotNow] = useState(() => readInboxDesktopNotificationsNotNow(scope));
  const [muted, setMuted] = useState(input.initialMuted);
  const mutationSequenceRef = useRef(0);

  useEffect(() => {
    setHasLocalNotNow(readInboxDesktopNotificationsNotNow(scope));
  }, [scope]);

  useEffect(() => {
    setMuted(input.initialMuted);
  }, [input.initialMuted]);

  useEffect(() => {
    void syncInboxNotificationMuteStateToServiceWorker({
      scope,
      muted
    });
  }, [muted, scope]);

  const refreshStatus = useCallback(async () => {
    setPermissionState(getBrowserPushPermissionState());

    const response = await fetch("/api/inbox/push/status", {
      method: "GET",
      cache: "no-store"
    }).catch(() => null);

    if (!response?.ok) {
      return;
    }

    const payload = (await response.json().catch(() => null)) as PushStatusResponse | null;
    setPushEnabled(payload?.pushEnabled === true);
    setSubscriptionCount(typeof payload?.pushSubscriptionCount === "number" ? payload.pushSubscriptionCount : 0);
    setVapidPublicKey(payload?.vapidPublicKey ?? null);
    setPromptDismissedAt(payload?.inboxDesktopNotificationsPromptDismissedAt ?? input.initialPromptDismissedAt);
  }, [input.initialPromptDismissedAt]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    if (permissionState !== "granted" || !pushEnabled || !vapidPublicKey) {
      return;
    }

    let cancelled = false;
    void ensureInboxBrowserPushSubscription({
      vapidPublicKey
    })
      .then(() => {
        if (!cancelled) {
          clearInboxDesktopNotificationsNotNow(scope);
          setHasLocalNotNow(false);
          setSubscriptionCount((current) => (current > 0 ? current : 1));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError("Unable to enable desktop notifications.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [permissionState, pushEnabled, scope, vapidPublicKey]);

  useEffect(() => {
    if (
      permissionState === "granted" ||
      permissionState === "default" ||
      subscriptionCount < 1
    ) {
      return;
    }

    void disableInboxBrowserPushSubscription()
      .then(() => {
        setSubscriptionCount(0);
      })
      .catch(() => undefined);
  }, [permissionState, subscriptionCount]);

  useEffect(() => {
    const handleFocus = () => {
      setPermissionState(getBrowserPushPermissionState());
      void refreshStatus();
    };

    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [refreshStatus]);

  const enableDesktopNotifications = useCallback(async () => {
    const requestSequence = ++mutationSequenceRef.current;
    setIsPending(true);
    setError(null);

    try {
      const permission = await requestBrowserPushPermission();
      const nextState =
        permission === "granted" ? "granted" : permission === "denied" ? "denied" : "default";
      setPermissionState(nextState);

      if (permission !== "granted") {
        if (requestSequence === mutationSequenceRef.current) {
          setIsPending(false);
        }
        return false;
      }

      clearInboxDesktopNotificationsNotNow(scope);
      setHasLocalNotNow(false);

      if (!pushEnabled || !vapidPublicKey) {
        setSubscriptionCount(0);
        return true;
      }

      await ensureInboxBrowserPushSubscription({
        vapidPublicKey
      });

      setSubscriptionCount((current) => (current > 0 ? current : 1));
      return true;
    } catch (nextError) {
      if (requestSequence === mutationSequenceRef.current) {
        setError(nextError instanceof Error ? nextError.message : "Unable to enable desktop notifications.");
      }
      return false;
    } finally {
      if (requestSequence === mutationSequenceRef.current) {
        setIsPending(false);
      }
    }
  }, [pushEnabled, scope, vapidPublicKey]);

  const dismissDesktopNotificationsForNow = useCallback(() => {
    persistInboxDesktopNotificationsNotNow(scope);
    setHasLocalNotNow(true);
  }, [scope]);

  const dismissDesktopNotificationsPromptPermanently = useCallback(async () => {
    setError(null);
    const response = await fetch("/api/inbox/push/onboarding", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        inboxDesktopNotificationsPromptDismissed: true
      })
    }).catch(() => null);

    if (!response?.ok) {
      setError("Unable to update the desktop notification prompt preference.");
      return false;
    }

    const payload = (await response.json().catch(() => null)) as
      | { inboxDesktopNotificationsPromptDismissedAt?: string | null }
      | null;

    setPromptDismissedAt(payload?.inboxDesktopNotificationsPromptDismissedAt ?? new Date().toISOString());
    return true;
  }, []);

  const clearCurrentDesktopNotificationSubscription = useCallback(async () => {
    await disableInboxBrowserPushSubscription();
    setSubscriptionCount(0);
  }, []);

  return {
    permissionState,
    pushEnabled,
    subscriptionCount,
    isPending,
    error,
    shouldShowPrompt:
      permissionState === "default" &&
      !promptDismissedAt &&
      !hasLocalNotNow &&
      !muted,
    hasDismissedPromptPermanently: Boolean(promptDismissedAt),
    hasLocalNotNow,
    setMuted,
    refreshStatus,
    enableDesktopNotifications,
    dismissDesktopNotificationsForNow,
    dismissDesktopNotificationsPromptPermanently,
    clearCurrentDesktopNotificationSubscription
  };
}

export function buildInboxDesktopNotificationsNotNowStorageKeyForTest(input: {
  agentId: string;
  workspaceId: string;
}) {
  return buildInboxDesktopNotificationsNotNowKey(input);
}
