"use client";

type InboxNotificationSoundScope = {
  agentId: string;
  workspaceId: string;
};

type InboxNotificationSoundListener = (muted: boolean) => void;

type InboxNotificationSoundPlayback = {
  context: AudioContext;
  oscillator: OscillatorNode;
  closeTimeoutId: number;
};

const STORAGE_KEY_PREFIX = "connexa.inboxNotificationSoundsMuted";
const BROADCAST_CHANNEL_NAME = "connexa:inbox-notification-sounds";

const scopeMutedState = new Map<string, boolean>();
const scopeListeners = new Map<string, Set<InboxNotificationSoundListener>>();
const scopePlayback = new Map<string, InboxNotificationSoundPlayback>();

let storageListenerRegistered = false;
let broadcastChannel: BroadcastChannel | null = null;

export function buildInboxNotificationSoundPreferenceStorageKey(scope: InboxNotificationSoundScope) {
  return `${STORAGE_KEY_PREFIX}:${scope.workspaceId}:${scope.agentId}`;
}

export function getInboxNotificationSoundsMuted(scope: InboxNotificationSoundScope) {
  return scopeMutedState.get(buildInboxNotificationSoundPreferenceStorageKey(scope)) ?? false;
}

export function initializeInboxNotificationSoundPreference(
  scope: InboxNotificationSoundScope,
  initialMuted: boolean
) {
  const scopeKey = buildInboxNotificationSoundPreferenceStorageKey(scope);
  const storedMuted = readStoredMuted(scopeKey);
  const nextMuted = storedMuted ?? initialMuted;

  scopeMutedState.set(scopeKey, nextMuted);
  persistMutedLocally(scopeKey, nextMuted);
  ensurePreferenceSync();
  return nextMuted;
}

export function subscribeToInboxNotificationSoundPreference(
  scope: InboxNotificationSoundScope,
  listener: InboxNotificationSoundListener
) {
  const scopeKey = buildInboxNotificationSoundPreferenceStorageKey(scope);
  const listeners = scopeListeners.get(scopeKey) ?? new Set<InboxNotificationSoundListener>();
  listeners.add(listener);
  scopeListeners.set(scopeKey, listeners);

  return () => {
    const current = scopeListeners.get(scopeKey);
    if (!current) {
      return;
    }

    current.delete(listener);
    if (current.size < 1) {
      scopeListeners.delete(scopeKey);
    }
  };
}

export function setInboxNotificationSoundsMuted(
  scope: InboxNotificationSoundScope,
  muted: boolean,
  options: { broadcast?: boolean } = {}
) {
  const scopeKey = buildInboxNotificationSoundPreferenceStorageKey(scope);
  scopeMutedState.set(scopeKey, muted);
  persistMutedLocally(scopeKey, muted);

  if (muted) {
    stopInboxNotificationTone(scope);
  }

  notifyScopeListeners(scopeKey, muted);

  if (options.broadcast !== false) {
    broadcastMutedPreference(scopeKey, muted);
  }
}

export function playInboxNotificationTone(scope: InboxNotificationSoundScope) {
  if (typeof window === "undefined" || getInboxNotificationSoundsMuted(scope)) {
    return;
  }

  try {
    const AudioContextClass = window.AudioContext ?? window.webkitAudioContext;
    if (!AudioContextClass) {
      return;
    }

    stopInboxNotificationTone(scope);

    const context = new AudioContextClass();
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(880, context.currentTime);
    oscillator.frequency.setValueAtTime(660, context.currentTime + 0.09);
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, context.currentTime + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.22);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.24);

    const scopeKey = buildInboxNotificationSoundPreferenceStorageKey(scope);
    const closeTimeoutId = window.setTimeout(() => {
      void closePlayback(scopeKey);
    }, 320);

    scopePlayback.set(scopeKey, {
      context,
      oscillator,
      closeTimeoutId
    });
  } catch {
    // Browsers may block audio until the user interacts with the page.
  }
}

export function stopInboxNotificationTone(scope: InboxNotificationSoundScope) {
  const scopeKey = buildInboxNotificationSoundPreferenceStorageKey(scope);
  void closePlayback(scopeKey);
}

function ensurePreferenceSync() {
  if (typeof window === "undefined") {
    return;
  }

  if (!storageListenerRegistered) {
    window.addEventListener("storage", handleStorageEvent);
    storageListenerRegistered = true;
  }

  if (!broadcastChannel && typeof BroadcastChannel !== "undefined") {
    broadcastChannel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
    broadcastChannel.addEventListener("message", handleBroadcastMessage);
  }
}

function notifyScopeListeners(scopeKey: string, muted: boolean) {
  const listeners = scopeListeners.get(scopeKey);
  if (!listeners?.size) {
    return;
  }

  listeners.forEach((listener) => listener(muted));
}

function broadcastMutedPreference(scopeKey: string, muted: boolean) {
  try {
    broadcastChannel?.postMessage({
      scopeKey,
      muted
    });
  } catch {
    // Ignore cross-tab sync failures.
  }
}

function persistMutedLocally(scopeKey: string, muted: boolean) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(scopeKey, muted ? "true" : "false");
  } catch {
    // Ignore local persistence failures.
  }
}

function readStoredMuted(scopeKey: string) {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const stored = window.localStorage.getItem(scopeKey);
    if (stored === "true") {
      return true;
    }

    if (stored === "false") {
      return false;
    }
  } catch {
    return null;
  }

  return null;
}

async function closePlayback(scopeKey: string) {
  const playback = scopePlayback.get(scopeKey);
  if (!playback) {
    return;
  }

  window.clearTimeout(playback.closeTimeoutId);
  scopePlayback.delete(scopeKey);

  try {
    playback.oscillator.stop();
  } catch {
    // Ignore closed oscillator failures.
  }

  try {
    await playback.context.close();
  } catch {
    // Ignore browser close failures.
  }
}

function handleStorageEvent(event: StorageEvent) {
  if (!event.key?.startsWith(`${STORAGE_KEY_PREFIX}:`)) {
    return;
  }

  const muted = event.newValue === "true";
  scopeMutedState.set(event.key, muted);
  if (muted) {
    void closePlayback(event.key);
  }
  notifyScopeListeners(event.key, muted);
}

function handleBroadcastMessage(event: MessageEvent) {
  const data = event.data as { muted?: unknown; scopeKey?: unknown } | null;
  if (!data || typeof data.scopeKey !== "string" || typeof data.muted !== "boolean") {
    return;
  }

  scopeMutedState.set(data.scopeKey, data.muted);
  persistMutedLocally(data.scopeKey, data.muted);
  if (data.muted) {
    void closePlayback(data.scopeKey);
  }
  notifyScopeListeners(data.scopeKey, data.muted);
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}
