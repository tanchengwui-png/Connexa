type SenderServiceRequestInit = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  searchParams?: URLSearchParams;
  timeoutMs?: number;
};

const SENDER_SERVICE_TIMEOUT_MS = Math.max(
  1500,
  Number.parseInt(process.env.SENDER_SERVICE_TIMEOUT_MS ?? "5000", 10) || 5000
);

const SENDER_SERVICE_SEND_TIMEOUT_MS = Math.max(
  SENDER_SERVICE_TIMEOUT_MS,
  Number.parseInt(process.env.SENDER_SERVICE_SEND_TIMEOUT_MS ?? "30000", 10) || 30000
);

const SENDER_SERVICE_RUNTIME_TIMEOUT_MS = Math.max(
  SENDER_SERVICE_TIMEOUT_MS,
  Number.parseInt(process.env.SENDER_SERVICE_RUNTIME_TIMEOUT_MS ?? "30000", 10) || 30000
);

type RemoteChannelPayload = {
  connectedAt?: string | Date | null;
  lastSeenAt?: string | Date | null;
  updatedAt?: string | Date | null;
  [key: string]: unknown;
};

function getSenderServiceBaseUrl() {
  return process.env.SENDER_SERVICE_URL?.trim()?.replace(/\/$/, "") ?? null;
}

function getSenderServiceToken() {
  return process.env.SENDER_SERVICE_TOKEN?.trim() ?? null;
}

export function isRemoteSenderServiceEnabled() {
  return Boolean(getSenderServiceBaseUrl());
}

function toDate(value: string | Date | null | undefined) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeRemoteChannel<T extends RemoteChannelPayload | null | undefined>(channel: T) {
  if (!channel) {
    return channel ?? null;
  }

  return {
    ...channel,
    connectedAt: toDate(channel.connectedAt),
    lastSeenAt: toDate(channel.lastSeenAt),
    updatedAt: toDate(channel.updatedAt)
  };
}

async function callSenderService<T>(
  path: string,
  init: SenderServiceRequestInit = {}
): Promise<T> {
  const baseUrl = getSenderServiceBaseUrl();
  if (!baseUrl) {
    throw new Error("SENDER_SERVICE_URL is not configured.");
  }

  const url = new URL(`${baseUrl}${path}`);
  if (init.searchParams) {
    url.search = init.searchParams.toString();
  }

  const headers = new Headers();
  const token = getSenderServiceToken();
  if (token) {
    headers.set("x-sender-token", token);
    headers.set("authorization", `Bearer ${token}`);
  }

  let body: string | undefined;
  if (init.body !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(init.body);
  }

  const abortController = new AbortController();
  const timeoutMs = Math.max(1500, init.timeoutMs ?? SENDER_SERVICE_TIMEOUT_MS);
  const timeoutId = setTimeout(() => abortController.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(url, {
      method: init.method ?? "GET",
      headers,
      body,
      cache: "no-store",
      signal: abortController.signal
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Sender service timed out after ${timeoutMs}ms.`);
    }

    const message = error instanceof Error ? error.message.trim() : "Unknown sender service error.";
    throw new Error(
      `Sender service is unreachable at ${baseUrl}. ${message || "Fetch failed."} ` +
        "Check SENDER_SERVICE_URL and confirm the sender service is running and reachable from the app container."
    );
  } finally {
    clearTimeout(timeoutId);
  }

  const payload = (await response.json().catch(() => null)) as
    | {
        error?: string;
      }
    | T
    | null;

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
        ? payload.error
        : `Sender service request failed with status ${response.status}.`;
    throw new Error(message);
  }

  return payload as T;
}

export async function getRemoteWhatsAppRuntimeStatus(input: {
  workspaceId: string;
  agentId: string;
  channelId?: string | null;
}) {
  const searchParams = new URLSearchParams({
    workspaceId: input.workspaceId,
    agentId: input.agentId
  });
  if (input.channelId) {
    searchParams.set("channelId", input.channelId);
  }

  const payload = await callSenderService<{
    status: {
      channel?: unknown;
      qrCodeDataUrl?: string | null;
      runtimeStatus?: string;
      lastError?: string | null;
      connectedByCurrentAgent?: boolean;
      isSyncingHistory?: boolean;
      supervisor?: {
        requiresManualAttention?: boolean;
        stateLabel?: string;
        manualAttentionSince?: string | null;
        manualAttentionReason?: string | null;
        recentAutoRecoveryCount?: number;
        recentAuthFailureCount?: number;
        lastReadyAt?: string | null;
        lastDisconnectAt?: string | null;
      };
    };
  }>("/whatsapp/runtime", {
    searchParams,
    timeoutMs: SENDER_SERVICE_RUNTIME_TIMEOUT_MS
  });

  return {
    ...payload.status,
    channel: normalizeRemoteChannel(payload.status.channel as RemoteChannelPayload | null | undefined)
  };
}

export async function getRemoteSenderServiceMetrics() {
  return callSenderService<{
    metrics: {
      process: {
        startedAt: string;
        uptimeSec: number;
        rssMb: number;
        heapUsedMb: number;
        heapTotalMb: number;
        externalMb: number;
      };
      runtimes: {
        totalTracked: number;
        activeWarm: number;
        connected: number;
        initializing: number;
        syncingHistory: number;
        qrReady: number;
        authenticated: number;
        supervisorPaused: number;
        runtimeCreates24h: number;
      };
      latencies: {
        restoreReadyAvgMs: number | null;
        restoreReadyP95Ms: number | null;
        coldStartReadyAvgMs: number | null;
        coldStartReadyP95Ms: number | null;
        sendAvgMs: number | null;
        sendP95Ms: number | null;
        coldStartSendAvgMs: number | null;
        coldStartSendP95Ms: number | null;
      };
      workspaces: Array<{
        workspaceId: string;
        sessionClientId: string | null;
        runtimeStatus: string | null;
        lastRuntimeStartAt: string | null;
        lastReadyAt: string | null;
        lastReadyDurationMs: number | null;
        lastSendCompletedAt: string | null;
        lastSendDurationMs: number | null;
        lastColdStartReadyDurationMs: number | null;
        coldStarts24h: number;
      }>;
    };
  }>("/sender/health", {
    method: "GET"
  }).then((payload) => payload.metrics);
}

export async function ensureRemoteWorkspaceWhatsAppClient(input: {
  workspaceId: string;
  agentId: string;
  channelId?: string | null;
}) {
  await callSenderService<{ ok: true }>("/whatsapp/runtime/start", {
    method: "POST",
    body: input,
    timeoutMs: SENDER_SERVICE_RUNTIME_TIMEOUT_MS
  });
}

export async function disconnectRemoteWorkspaceWhatsAppClient(workspaceId: string, channelId?: string | null) {
  const searchParams = new URLSearchParams({ workspaceId });
  if (channelId) {
    searchParams.set("channelId", channelId);
  }

  await callSenderService<{ ok: true }>("/whatsapp/runtime", {
    method: "DELETE",
    searchParams
  });
}

export async function deleteRemoteWorkspaceWhatsAppClientSession(workspaceId: string, channelId?: string | null) {
  const searchParams = new URLSearchParams({ workspaceId });
  if (channelId) {
    searchParams.set("channelId", channelId);
  }

  await callSenderService<{ ok: true }>("/whatsapp/runtime/session", {
    method: "DELETE",
    searchParams
  });
}

export async function syncRemoteWorkspaceHistory(
  workspaceId: string,
  channelIdOrOptions?: string | { triggeredBy?: "manual" | "background" } | null,
  options: { triggeredBy?: "manual" | "background" } = {}
) {
  const channelId = typeof channelIdOrOptions === "string" ? channelIdOrOptions : null;
  const resolvedOptions =
    typeof channelIdOrOptions === "object" && channelIdOrOptions !== null ? channelIdOrOptions : options;
  const payload = await callSenderService<{
    ok: true;
    result: {
      importedChats: number;
      importedMessages: number;
    };
  }>("/whatsapp/runtime/sync", {
    method: "POST",
    body: {
      workspaceId,
      channelId,
      triggeredBy: resolvedOptions.triggeredBy
    }
  });

  return payload.result;
}

export async function resolveRemoteWhatsAppContacts(input: {
  workspaceId: string;
  mentionIds: string[];
}) {
  const payload = await callSenderService<{
    contacts: Array<{
      id: string;
      phone: string | null;
      name: string | null;
      pushname: string | null;
    }>;
  }>("/whatsapp/contacts/resolve", {
    method: "POST",
    body: input
  });

  return payload.contacts;
}

export async function listRemoteWhatsAppMentionCandidates(input: {
  workspaceId: string;
  conversationId: string;
  query?: string | null;
}) {
  const payload = await callSenderService<{
    candidates: Array<{
      id: string;
      label: string;
      token: string;
      phone: string | null;
      name: string | null;
      pushname: string | null;
    }>;
  }>("/whatsapp/mentions", {
    method: "POST",
    body: input
  });

  return payload.candidates;
}

export async function sendRemoteWhatsAppMessage(input: {
  channelId?: string | null;
  conversationId: string;
  workspaceId: string;
  to: string;
  body: string;
  mentions?: Array<{
    id: string;
    label: string;
    token: string;
  }> | null;
  quotedProviderMessageId?: string | null;
  simulateTyping?: boolean;
  interactiveButtons?: string[] | null;
  interactiveListButtonText?: string | null;
  interactiveListOptions?: string[] | null;
  attachmentPath?: string | null;
  attachmentUrl?: string | null;
  attachmentMimeType?: string | null;
  attachmentName?: string | null;
  sendAudioAsVoice?: boolean;
}) {
  const payload = await callSenderService<{
    result: {
      providerMessageId: string;
      status: "accepted";
    };
  }>("/messages/send", {
    method: "POST",
    body: input,
    timeoutMs: SENDER_SERVICE_SEND_TIMEOUT_MS
  });

  return payload.result;
}

export async function deleteRemoteWhatsAppMessageForEveryone(input: {
  workspaceId: string;
  channelId?: string | null;
  providerMessageId: string;
}) {
  const payload = await callSenderService<{
    result: {
      status: "deleted";
    };
  }>("/messages/delete-for-everyone", {
    method: "POST",
    body: input
  });

  return payload.result;
}

export async function sendRemoteWhatsAppChatSeen(input: {
  workspaceId: string;
  channelId?: string | null;
  conversationId: string;
}) {
  const payload = await callSenderService<{
    result: {
      status: "seen" | "skipped";
    };
  }>("/messages/seen", {
    method: "POST",
    body: input
  });

  return payload.result;
}

export async function setRemoteWhatsAppChatMute(input: {
  workspaceId: string;
  channelId?: string | null;
  conversationId: string;
  mute: boolean;
  muteUntil?: string | null;
}) {
  const payload = await callSenderService<{
    result: {
      isMuted: boolean;
      muteExpiration: string | null;
    };
  }>("/chats/mute", {
    method: "POST",
    body: input
  });

  return {
    isMuted: payload.result.isMuted,
    muteExpiration: payload.result.muteExpiration ? new Date(payload.result.muteExpiration) : null
  };
}
