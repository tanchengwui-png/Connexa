"use client";

type InboxNotificationScope = {
  agentId: string;
  workspaceId: string;
};

type BrowserPushPermissionState =
  | "unsupported"
  | "insecure"
  | "default"
  | "granted"
  | "denied";

type ServiceWorkerDisplayPayload = {
  body: string;
  conversationId: string | null;
  createdAt: string;
  eventId: string;
  notificationId: string;
  title: string;
  url: string;
  workspaceId: string;
};

const ONBOARDING_NOT_NOW_PREFIX = "connexa.inboxDesktopNotificationsNotNow";

function canUseServiceWorker() {
  return typeof window !== "undefined" && "serviceWorker" in navigator;
}

export function getBrowserPushPermissionState(): BrowserPushPermissionState {
  if (typeof window === "undefined") {
    return "unsupported";
  }

  const isSecureContext =
    window.isSecureContext || window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";

  if (!isSecureContext) {
    return "insecure";
  }

  if (!canUseServiceWorker() || typeof Notification === "undefined") {
    return "unsupported";
  }

  if (Notification.permission === "granted") {
    return "granted";
  }

  if (Notification.permission === "denied") {
    return "denied";
  }

  return "default";
}

export function buildInboxDesktopNotificationsNotNowKey(scope: InboxNotificationScope) {
  return `${ONBOARDING_NOT_NOW_PREFIX}:${scope.workspaceId}:${scope.agentId}`;
}

export function readInboxDesktopNotificationsNotNow(scope: InboxNotificationScope) {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    return window.localStorage.getItem(buildInboxDesktopNotificationsNotNowKey(scope)) === "true";
  } catch {
    return false;
  }
}

export function persistInboxDesktopNotificationsNotNow(scope: InboxNotificationScope) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(buildInboxDesktopNotificationsNotNowKey(scope), "true");
  } catch {
    // Ignore storage failures.
  }
}

export function clearInboxDesktopNotificationsNotNow(scope: InboxNotificationScope) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.removeItem(buildInboxDesktopNotificationsNotNowKey(scope));
  } catch {
    // Ignore storage failures.
  }
}

export async function requestBrowserPushPermission() {
  if (typeof Notification === "undefined") {
    return "denied" as NotificationPermission;
  }

  return Notification.requestPermission();
}

export async function syncInboxNotificationMuteStateToServiceWorker(input: {
  scope: InboxNotificationScope;
  muted: boolean;
}) {
  const registration = await getInboxServiceWorkerRegistration();
  if (!registration) {
    return;
  }

  registration.active?.postMessage({
    type: "connexa:sync-notification-mute",
    agentId: input.scope.agentId,
    workspaceId: input.scope.workspaceId,
    muted: input.muted
  });
}

export async function showInboxDesktopNotificationFromPage(payload: ServiceWorkerDisplayPayload) {
  const registration = await getInboxServiceWorkerRegistration();
  if (!registration) {
    return false;
  }

  registration.active?.postMessage({
    type: "connexa:show-notification",
    payload
  });

  return true;
}

export async function ensureInboxBrowserPushSubscription(input: {
  vapidPublicKey: string;
}) {
  const registration = await getInboxServiceWorkerRegistration();
  if (!registration || !input.vapidPublicKey) {
    throw new Error("INBOX_BROWSER_PUSH_UNAVAILABLE");
  }

  const current = await registration.pushManager.getSubscription();
  const nextSubscription =
    current ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: decodeBase64Url(input.vapidPublicKey)
    }));

  const payload = nextSubscription.toJSON();
  const endpoint = payload.endpoint;
  const auth = payload.keys?.auth;
  const p256dh = payload.keys?.p256dh;

  if (!endpoint || !auth || !p256dh) {
    throw new Error("INVALID_BROWSER_PUSH_SUBSCRIPTION");
  }

  const response = await fetch("/api/inbox/push/subscriptions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      endpoint,
      keys: {
        auth,
        p256dh
      }
    })
  });

  const result = (await response.json().catch(() => null)) as { error?: string } | null;
  if (!response.ok) {
    throw new Error(result?.error ?? "Unable to enable desktop notifications.");
  }

  return nextSubscription;
}

export async function disableInboxBrowserPushSubscription() {
  const registration = await getInboxServiceWorkerRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) {
    return false;
  }

  const payload = subscription.toJSON();
  const endpoint = payload.endpoint;
  const auth = payload.keys?.auth;
  const p256dh = payload.keys?.p256dh;

  if (endpoint && auth && p256dh) {
    await fetch("/api/inbox/push/subscriptions", {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        endpoint,
        keys: {
          auth,
          p256dh
        }
      })
    }).catch(() => null);
  }

  await subscription.unsubscribe().catch(() => false);
  registration?.active?.postMessage({
    type: "connexa:clear-notification-state"
  });
  return true;
}

async function getInboxServiceWorkerRegistration() {
  if (!canUseServiceWorker()) {
    return null;
  }

  return navigator.serviceWorker.register("/sw.js");
}

function decodeBase64Url(input: string) {
  const padding = "=".repeat((4 - (input.length % 4)) % 4);
  const normalized = (input + padding).replace(/-/g, "+").replace(/_/g, "/");
  const binary = window.atob(normalized);
  const output = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    output[index] = binary.charCodeAt(index);
  }

  return output;
}
