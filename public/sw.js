const CACHE_VERSION = "connexa-pwa-v2";
const APP_SHELL_CACHE = `${CACHE_VERSION}-shell`;
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const PUSH_META_CACHE = `${CACHE_VERSION}-push-meta`;
const APP_SHELL_URLS = ["/", "/manifest.webmanifest", "/icon", "/apple-icon"];
const MUTE_STATE_REQUEST = "/__connexa/push-mute-state";
const SEEN_NOTIFICATION_PREFIX = "/__connexa/push-seen/";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE).then((cache) => cache.addAll(APP_SHELL_URLS)).catch(() => undefined)
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== APP_SHELL_CACHE && key !== STATIC_CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") {
    return;
  }

  const requestUrl = new URL(request.url);
  if (requestUrl.origin !== self.location.origin) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const responseClone = response.clone();
          caches.open(APP_SHELL_CACHE).then((cache) => cache.put(request, responseClone)).catch(() => undefined);
          return response;
        })
        .catch(async () => {
          const cachedPage = await caches.match(request);
          if (cachedPage) {
            return cachedPage;
          }

          return (
            (await caches.match("/")) ||
            new Response("Offline", {
              status: 503,
              headers: { "Content-Type": "text/plain; charset=utf-8" }
            })
          );
        })
    );
    return;
  }

  const cacheableDestinations = new Set(["script", "style", "image", "font"]);
  if (!cacheableDestinations.has(request.destination)) {
    return;
  }

  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      const networkFetch = fetch(request)
        .then((response) => {
          const responseClone = response.clone();
          caches.open(STATIC_CACHE).then((cache) => cache.put(request, responseClone)).catch(() => undefined);
          return response;
        })
        .catch(() => cachedResponse);

      return cachedResponse || networkFetch;
    })
  );
});

self.addEventListener("message", (event) => {
  const data = event.data || null;
  if (!data || typeof data.type !== "string") {
    return;
  }

  if (data.type === "connexa:sync-notification-mute") {
    event.waitUntil(
      updateMutedWorkspace(data.workspaceId, data.muted === true).catch(() => undefined)
    );
    return;
  }

  if (data.type === "connexa:show-notification") {
    const payload = sanitizePushPayload(data.payload);
    if (!payload) {
      return;
    }

    event.waitUntil(showInboxNotification(payload));
    return;
  }

  if (data.type === "connexa:clear-notification-state") {
    event.waitUntil(clearPushMetaCache());
  }
});

self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      const payload = sanitizePushPayload(await readPushPayload(event));
      if (!payload) {
        return;
      }

      if (await isWorkspaceMuted(payload.workspaceId)) {
        return;
      }

      await showInboxNotification(payload);
    })()
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const targetUrl = resolveNotificationUrl(event.notification?.data?.url);
      if (!targetUrl) {
        return;
      }

      const clientsList = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true
      });

      for (const client of clientsList) {
        try {
          const clientUrl = new URL(client.url);
          if (clientUrl.origin === targetUrl.origin) {
            await client.focus();
            if ("navigate" in client) {
              await client.navigate(targetUrl.toString());
            }
            return;
          }
        } catch {}
      }

      await self.clients.openWindow(targetUrl.toString());
    })()
  );
});

self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    self.registration.pushManager
      .getSubscription()
      .then((subscription) => subscription?.unsubscribe())
      .catch(() => undefined)
  );
});

async function showInboxNotification(payload) {
  const dedupeKey = payload.notificationId || payload.eventId;
  if (dedupeKey && (await hasSeenNotification(dedupeKey))) {
    return;
  }

  if (dedupeKey) {
    await markNotificationSeen(dedupeKey);
  }

  await self.registration.showNotification(payload.title, {
    body: payload.body,
    icon: payload.icon || "/icon",
    badge: "/icon",
    tag: dedupeKey || payload.workspaceId,
    timestamp: Date.parse(payload.createdAt) || Date.now(),
    data: {
      url: payload.url,
      workspaceId: payload.workspaceId,
      notificationId: dedupeKey || null,
      conversationId: payload.conversationId || null
    }
  });
}

async function readPushPayload(event) {
  if (!event.data) {
    return null;
  }

  try {
    return event.data.json();
  } catch {
    try {
      return JSON.parse(event.data.text());
    } catch {
      return null;
    }
  }
}

function sanitizePushPayload(candidate) {
  if (
    !candidate ||
    typeof candidate !== "object" ||
    typeof candidate.notificationId !== "string" ||
    typeof candidate.eventId !== "string" ||
    typeof candidate.workspaceId !== "string" ||
    typeof candidate.title !== "string" ||
    typeof candidate.body !== "string" ||
    typeof candidate.url !== "string" ||
    typeof candidate.createdAt !== "string"
  ) {
    return null;
  }

  return {
    notificationId: candidate.notificationId,
    eventId: candidate.eventId,
    workspaceId: candidate.workspaceId,
    conversationId:
      typeof candidate.conversationId === "string" && candidate.conversationId ? candidate.conversationId : null,
    title: candidate.title,
    body: candidate.body,
    icon: typeof candidate.icon === "string" && candidate.icon ? candidate.icon : "/icon",
    url: candidate.url,
    createdAt: candidate.createdAt
  };
}

async function getMutedWorkspaceMap() {
  const cache = await caches.open(PUSH_META_CACHE);
  const response = await cache.match(MUTE_STATE_REQUEST);
  if (!response) {
    return {};
  }

  try {
    return (await response.json()) || {};
  } catch {
    return {};
  }
}

async function updateMutedWorkspace(workspaceId, muted) {
  if (typeof workspaceId !== "string" || !workspaceId) {
    return;
  }

  const cache = await caches.open(PUSH_META_CACHE);
  const current = await getMutedWorkspaceMap();
  current[workspaceId] = muted;
  await cache.put(
    MUTE_STATE_REQUEST,
    new Response(JSON.stringify(current), {
      headers: {
        "Content-Type": "application/json; charset=utf-8"
      }
    })
  );
}

async function isWorkspaceMuted(workspaceId) {
  if (typeof workspaceId !== "string" || !workspaceId) {
    return false;
  }

  const current = await getMutedWorkspaceMap();
  return current[workspaceId] === true;
}

async function hasSeenNotification(notificationId) {
  const cache = await caches.open(PUSH_META_CACHE);
  const existing = await cache.match(`${SEEN_NOTIFICATION_PREFIX}${notificationId}`);
  return Boolean(existing);
}

async function markNotificationSeen(notificationId) {
  const cache = await caches.open(PUSH_META_CACHE);
  await cache.put(
    `${SEEN_NOTIFICATION_PREFIX}${notificationId}`,
    new Response(String(Date.now()), {
      headers: {
        "Content-Type": "text/plain; charset=utf-8"
      }
    })
  );
}

async function clearPushMetaCache() {
  await caches.delete(PUSH_META_CACHE).catch(() => undefined);
}

function resolveNotificationUrl(url) {
  if (typeof url !== "string" || !url) {
    return null;
  }

  try {
    const resolved = new URL(url, self.location.origin);
    if (resolved.origin !== self.location.origin) {
      return null;
    }

    return resolved;
  } catch {
    return null;
  }
}
