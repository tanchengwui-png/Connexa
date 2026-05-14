import { accessSync, existsSync, readdirSync, rmSync } from "fs";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { normalizeStoredPhone } from "@/lib/phone";
import QRCode from "qrcode";
import { MessageDirection } from "@prisma/client";
import whatsappWebJs from "whatsapp-web.js";
import type { Client as WhatsAppClient, Message, Reaction } from "whatsapp-web.js";
import { prisma } from "@/lib/prisma";
import {
  deleteWorkspaceWhatsAppSession,
  clearWorkspaceWhatsAppSession,
  markWorkspaceWhatsAppChannelDisconnected,
  getWorkspaceWhatsAppChannelStatus,
  saveWorkspaceWhatsAppChannelConnection
} from "@/lib/whatsapp-channel";
import { captureWhatsAppMessageEnvelope, captureWhatsAppReactionEnvelope, persistIncomingMedia } from "@/lib/whatsapp-message-envelope";
import { logWhatsAppRuntimeEvent, WHATSAPP_RUNTIME_EVENT_TYPES } from "@/lib/whatsapp-runtime-events";
import {
  clearRuntimeSupervisorState,
  getRuntimeSupervisorPausedCount,
  getRuntimeSupervisorStatus,
  recordRuntimeAuthFailure,
  recordRuntimeDisconnected,
  recordRuntimeReady,
  registerAutomaticRecoveryAttempt
} from "@/lib/whatsapp-runtime-supervisor";
import {
  getWhatsAppSenderNodeMetricsSnapshot,
  recordRuntimeReadyMetric,
  recordRuntimeStartMetric,
  recordRuntimeStatusMetric,
  recordSendDurationMetric
} from "@/lib/whatsapp-runtime-metrics";
import { ingestWhatsAppClientMessage, syncWhatsAppHistoryConversation } from "@/lib/whatsapp";

const { Client, LocalAuth, MessageMedia } = whatsappWebJs;

type RuntimeState = {
  client: WhatsAppClient;
  agentId: string;
  workspaceId: string;
  sessionClientId: string;
  restoredFromSession: boolean;
  initializing: Promise<void> | null;
  qrCodeDataUrl: string | null;
  connectionStatus: string;
  lastError: string | null;
  isSyncingHistory: boolean;
  hasCompletedInitialSync: boolean;
  historySyncCursor: number;
  deferredHistoryChatIds: string[];
  historySyncStartedAt: number | null;
  historyRetryDelayMs: number;
  backgroundSyncTimer: NodeJS.Timeout | null;
  statusUpdatedAt: number;
  stallRecoveryTimer: NodeJS.Timeout | null;
  reconnectTimer: NodeJS.Timeout | null;
  idleEvictionTimer: NodeJS.Timeout | null;
  lastActivityAt: number;
};

declare global {
  // eslint-disable-next-line no-var
  var whatsAppRuntimeStates: Map<string, RuntimeState> | undefined;
  // eslint-disable-next-line no-var
  var whatsAppRuntimeCreations: Map<string, Promise<RuntimeState | null>> | undefined;
}

const runtimeStates = global.whatsAppRuntimeStates ?? new Map<string, RuntimeState>();
const runtimeCreations = global.whatsAppRuntimeCreations ?? new Map<string, Promise<RuntimeState | null>>();

const WHATSAPP_HISTORY_SYNC_LIMIT = Math.max(
  1,
  Number.parseInt(process.env.WHATSAPP_HISTORY_SYNC_LIMIT ?? "200", 10) || 200
);

const WHATSAPP_PROTOCOL_TIMEOUT_MS = Math.max(
  120000,
  Number.parseInt(process.env.WHATSAPP_PROTOCOL_TIMEOUT_MS ?? "240000", 10) || 240000
);

const WHATSAPP_INITIAL_SYNC_CHAT_BATCH = Math.max(
  1,
  Number.parseInt(process.env.WHATSAPP_INITIAL_SYNC_CHAT_BATCH ?? "8", 10) || 8
);

const WHATSAPP_BACKGROUND_SYNC_CHAT_BATCH = Math.max(
  WHATSAPP_INITIAL_SYNC_CHAT_BATCH,
  Number.parseInt(process.env.WHATSAPP_BACKGROUND_SYNC_CHAT_BATCH ?? "24", 10) || 24
);

const WHATSAPP_HISTORY_STUCK_MS = Math.max(
  60_000,
  Number.parseInt(process.env.WHATSAPP_HISTORY_STUCK_MS ?? "300000", 10) || 300000
);

const WHATSAPP_HISTORY_RETRY_BASE_MS = Math.max(
  15_000,
  Number.parseInt(process.env.WHATSAPP_HISTORY_RETRY_BASE_MS ?? "15000", 10) || 15000
);

const WHATSAPP_HISTORY_RETRY_MAX_MS = Math.max(
  WHATSAPP_HISTORY_RETRY_BASE_MS,
  Number.parseInt(process.env.WHATSAPP_HISTORY_RETRY_MAX_MS ?? "120000", 10) || 120000
);

const WHATSAPP_CONNECTION_STALL_MS = Math.max(
  45_000,
  Number.parseInt(process.env.WHATSAPP_CONNECTION_STALL_MS ?? "90000", 10) || 90000
);

const WHATSAPP_HISTORY_DEFERRED_RETRY_MS = Math.max(
  WHATSAPP_HISTORY_RETRY_MAX_MS,
  Number.parseInt(process.env.WHATSAPP_HISTORY_DEFERRED_RETRY_MS ?? "300000", 10) || 300000
);

const WHATSAPP_TYPING_MIN_MS = Math.max(
  500,
  Number.parseInt(process.env.WHATSAPP_TYPING_MIN_MS ?? "1200", 10) || 1200
);

const WHATSAPP_TYPING_MAX_MS = Math.max(
  WHATSAPP_TYPING_MIN_MS,
  Number.parseInt(process.env.WHATSAPP_TYPING_MAX_MS ?? "4000", 10) || 4000
);

const WHATSAPP_TYPING_JITTER_MS = Math.max(
  0,
  Number.parseInt(process.env.WHATSAPP_TYPING_JITTER_MS ?? "450", 10) || 450
);

const WHATSAPP_IDLE_EVICT_MS = Math.max(
  0,
  Number.parseInt(process.env.WHATSAPP_IDLE_EVICT_MS ?? "900000", 10) || 900000
);

if (!global.whatsAppRuntimeStates) {
  global.whatsAppRuntimeStates = runtimeStates;
}

if (!global.whatsAppRuntimeCreations) {
  global.whatsAppRuntimeCreations = runtimeCreations;
}

function buildRuntimeKey(workspaceId: string) {
  return workspaceId;
}

function hasWarmRuntime(workspaceId: string) {
  const runtime = runtimeStates.get(buildRuntimeKey(workspaceId));
  return Boolean(runtime?.client);
}

function buildSessionClientId(workspaceId: string, agentId: string) {
  return `connexa-${workspaceId}-${agentId}`.replace(/[^a-zA-Z0-9-_]/g, "");
}

function buildFreshSessionClientId(workspaceId: string, agentId: string) {
  return `${buildSessionClientId(workspaceId, agentId)}-${Date.now().toString(36)}`;
}

function createWhatsAppClient(sessionClientId: string) {
  return new Client({
    authStrategy: new LocalAuth({
      clientId: sessionClientId,
      dataPath: getAuthDataPath()
    }),
    puppeteer: {
      headless: true,
      protocolTimeout: WHATSAPP_PROTOCOL_TIMEOUT_MS,
      executablePath: getBrowserExecutablePath(),
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    }
  });
}

function logProfilePhotoResult(input: {
  source: "inbound" | "sync";
  displayName?: string | null;
  phone?: string | null;
  photoUrl?: string | null;
  fallbackPhotoUrl?: string | null;
  bridgePhotoUrl?: string | null;
}) {
  const label = input.displayName?.trim() || input.phone || "Unknown contact";
  const phone = input.phone ?? "unknown";
  const photoSummary = input.photoUrl ? `${input.photoUrl.slice(0, 96)}...` : "null";
  const fallbackSummary = input.fallbackPhotoUrl
    ? `${input.fallbackPhotoUrl.slice(0, 96)}...`
    : "null";
  const bridgeSummary = input.bridgePhotoUrl ? `${input.bridgePhotoUrl.slice(0, 96)}...` : "null";

  console.info(
    `[whatsapp-web][${input.source}] profile photo primary=${photoSummary} fallback=${fallbackSummary} bridge=${bridgeSummary} for ${label} (${phone})`
  );
}

function resolveIncomingDisplayName(input: {
  notifyName?: string | null;
  pushname?: string | null;
  contactName?: string | null;
  chatName?: string | null;
  phone?: string | null;
  fallbackId?: string | null;
}) {
  return (
    input.contactName?.trim() ||
    input.chatName?.trim() ||
    input.pushname?.trim() ||
    input.notifyName?.trim() ||
    input.phone?.trim() ||
    input.fallbackId?.trim() ||
    null
  );
}

async function getBridgeProfilePhotoUrl(client: WhatsAppClient, contactId?: string | null) {
  if (!contactId) {
    return null;
  }

  const pupPage = (client as WhatsAppClient & {
    pupPage?: { evaluate: <T, A>(fn: (arg: A) => Promise<T>, arg: A) => Promise<T> };
  })
    .pupPage;

  if (!pupPage?.evaluate) {
    return null;
  }

  try {
    return await pupPage.evaluate(async (id) => {
      try {
        const runtimeWindow = window as Window &
          typeof globalThis & {
            WWebJS?: {
              getChat: (contactId: string) => Promise<unknown>;
            };
            require: (moduleName: string) => {
              requestProfilePicFromServer: (chat: unknown) => Promise<{ eurl?: string | null } | null>;
            };
          };

        const chat = await runtimeWindow.WWebJS?.getChat(id);
        if (!chat) {
          return null;
        }

        const pic = await runtimeWindow
          .require("WAWebContactProfilePicThumbBridge")
          .requestProfilePicFromServer(chat);

        return pic?.eurl ?? null;
      } catch (error) {
        if (
          typeof error === "object" &&
          error !== null &&
          "name" in error &&
          error.name === "ServerStatusCodeError"
        ) {
          return null;
        }

        return null;
      }
    }, contactId);
  } catch {
    return null;
  }
}

async function downloadProfilePhotoViaBrowser(client: WhatsAppClient, photoUrl?: string | null) {
  const sourceUrl = photoUrl?.trim();
  if (!sourceUrl) {
    return null;
  }

  const pupPage = (client as WhatsAppClient & {
    pupPage?: { evaluate: <T, A>(fn: (arg: A) => Promise<T>, arg: A) => Promise<T> };
  }).pupPage;

  if (!pupPage?.evaluate) {
    return null;
  }

  try {
    return await pupPage.evaluate(async (url) => {
      try {
        const response = await fetch(url, { credentials: "include" });
        if (!response.ok) {
          return null;
        }

        const blob = await response.blob();
        const buffer = await blob.arrayBuffer();
        let binary = "";
        const bytes = new Uint8Array(buffer);
        const chunkSize = 0x8000;

        for (let index = 0; index < bytes.length; index += chunkSize) {
          binary += String.fromCharCode(...bytes.slice(index, index + chunkSize));
        }

        return {
          contentType: blob.type || response.headers.get("content-type") || "image/jpeg",
          base64: btoa(binary)
        };
      } catch {
        return null;
      }
    }, sourceUrl);
  } catch {
    return null;
  }
}

async function cacheProfilePhoto(input: {
  client: WhatsAppClient;
  workspaceId: string;
  remoteId?: string | null;
  phone?: string | null;
  photoUrl?: string | null;
}) {
  const sourceUrl = input.photoUrl?.trim();
  if (!sourceUrl) {
    console.info(
      `[whatsapp-web][avatar-cache] skipped: no source url for remote=${input.remoteId ?? "unknown"} phone=${input.phone ?? "unknown"}`
    );
    return null;
  }

  if (sourceUrl.startsWith("/")) {
    console.info(
      `[whatsapp-web][avatar-cache] already-local remote=${input.remoteId ?? "unknown"} path=${sourceUrl}`
    );
    return sourceUrl;
  }

  try {
    let contentType = "image/jpeg";
    let body: Buffer | null = null;

    const response = await fetch(sourceUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 Connexa Profile Photo Cache"
      }
    }).catch(() => null);

    if (response?.ok) {
      contentType = response.headers.get("content-type") ?? contentType;
      body = Buffer.from(await response.arrayBuffer());
    } else {
      const browserDownloaded = await downloadProfilePhotoViaBrowser(input.client, sourceUrl);
      if (browserDownloaded?.base64) {
        contentType = browserDownloaded.contentType ?? contentType;
        body = Buffer.from(browserDownloaded.base64, "base64");
      }
    }

    if (!body) {
      console.warn(
        `[whatsapp-web][avatar-cache] unable to download remote=${input.remoteId ?? "unknown"} phone=${
          input.phone ?? "unknown"
        } url=${sourceUrl.slice(0, 160)}`
      );
      return sourceUrl;
    }

    const extension = extensionFromContentType(contentType);
    const fileLabel = sanitizeProfilePhotoSegment(input.phone || input.remoteId || "unknown");
    const relativePath = `/uploads/whatsapp-profile/${sanitizeProfilePhotoSegment(input.workspaceId)}/${fileLabel}.${extension}`;
    const absolutePath = path.join(process.cwd(), "public", relativePath.replace(/^\//, ""));

    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, body);

    console.info(
      `[whatsapp-web][avatar-cache] saved remote=${input.remoteId ?? "unknown"} phone=${input.phone ?? "unknown"} path=${relativePath}`
    );

    return relativePath;
  } catch (error) {
    console.warn(
      `[whatsapp-web][avatar-cache] failed remote=${input.remoteId ?? "unknown"} phone=${input.phone ?? "unknown"}: ${
        error instanceof Error ? error.message : "Unknown cache error."
      }`
    );
    return sourceUrl;
  }
}

function extensionFromContentType(contentType: string) {
  const normalized = contentType.toLowerCase();
  if (normalized.includes("png")) return "png";
  if (normalized.includes("webp")) return "webp";
  if (normalized.includes("gif")) return "gif";
  return "jpg";
}

function sanitizeProfilePhotoSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

async function extractIncomingMediaAttachment(input: {
  workspaceId: string;
  providerMessageId: string;
  message: Message;
}) {
  if (!input.message.hasMedia || isStatusLikeMessage(input.message)) {
    return null;
  }

  const downloadedMedia = await retryWhatsAppOperation(() => input.message.downloadMedia()).catch(
    () => null
  );

  if (!downloadedMedia) {
    return null;
  }

  const storedMedia = await persistIncomingMedia({
    workspaceId: input.workspaceId,
    providerMessageId: input.providerMessageId,
    media: downloadedMedia
  }).catch(() => null);

  return {
    attachmentMimeType: downloadedMedia.mimetype ?? null,
    attachmentName: downloadedMedia.filename ?? null,
    attachmentUrl: storedMedia?.url ?? null
  };
}

function getAuthDataPath() {
  return path.join(process.cwd(), ".wwebjs_auth");
}

function getBrowserExecutablePath() {
  const configuredPath = process.env.WHATSAPP_WEB_EXECUTABLE_PATH?.trim();
  if (configuredPath) {
    return configuredPath;
  }

  const candidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
  ];

  for (const candidate of candidates) {
    try {
      accessSync(candidate);
      return candidate;
    } catch {
      continue;
    }
  }

  return undefined;
}

function getSessionAuthPath(sessionClientId: string) {
  return path.join(getAuthDataPath(), `session-${sessionClientId}`);
}

function isChromiumProfileLockError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  return (
    message.includes("The browser is already running for") ||
    message.includes("Use a different `userDataDir` or stop the running browser first") ||
    message.includes("The profile appears to be in use by another Chromium process") ||
    message.includes("Chromium has locked the profile") ||
    message.includes("Failed to launch the browser process: Code: 21")
  );
}

function clearChromiumProfileLocks(sessionClientId: string) {
  const sessionPath = getSessionAuthPath(sessionClientId);

  if (!existsSync(sessionPath)) {
    return;
  }

  const lockNames = new Set(["SingletonLock", "SingletonSocket", "SingletonCookie", "lockfile"]);
  const stack = [sessionPath];

  while (stack.length) {
    const currentPath = stack.pop();
    if (!currentPath) {
      continue;
    }

    let entries: string[] = [];
    try {
      entries = readdirSync(currentPath);
    } catch {
      continue;
    }

    for (const entry of entries) {
      const entryPath = path.join(currentPath, entry);

      if (lockNames.has(entry)) {
        rmSync(entryPath, { force: true, recursive: true });
        continue;
      }

      try {
        const childEntries = readdirSync(entryPath);
        if (childEntries.length >= 0) {
          stack.push(entryPath);
        }
      } catch {
        continue;
      }
    }
  }
}

function clearChromiumSessionProfile(sessionClientId: string) {
  rmSync(getSessionAuthPath(sessionClientId), { recursive: true, force: true });
}

function buildPlainTextListFallback(body: string, buttonText: string, options: string[]) {
  const normalizedBody = body.trim();
  const normalizedButtonText = buttonText.trim() || "Choose option";
  const normalizedOptions = options
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, 10);

  if (!normalizedOptions.length) {
    return normalizedBody;
  }

  return [normalizedBody, `[${normalizedButtonText}]`, ...normalizedOptions.map((label, index) => `${index + 1}. ${label}`)]
    .filter(Boolean)
    .join("\n\n")
    .replace(/\n\n(\d+\.)/g, "\n$1");
}

function buildPlainTextButtonsFallback(body: string, buttons: string[]) {
  const normalizedBody = body.trim();
  const normalizedButtons = buttons
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, 3);

  if (!normalizedButtons.length) {
    return normalizedBody;
  }

  return [normalizedBody, "[Buttons]", ...normalizedButtons.map((label, index) => `${index + 1}. ${label}`)]
    .filter(Boolean)
    .join("\n\n")
    .replace(/\n\n(\d+\.)/g, "\n$1");
}

function toPhoneNumber(serializedId?: string | null) {
  return serializedId?.split("@")[0] ?? null;
}

function normalizeChatPhone(value?: string | null) {
  return value ? normalizeStoredPhone(value) : "";
}

function toStoredPhone(serializedId?: string | null, fallbackNumber?: string | null) {
  const normalizedFallback = normalizeChatPhone(fallbackNumber);
  if (normalizedFallback) {
    return normalizedFallback;
  }

  if (serializedId?.endsWith("@c.us") || serializedId?.endsWith("@g.us")) {
    const serializedPhone = normalizeChatPhone(toPhoneNumber(serializedId));
    return serializedPhone || null;
  }

  return null;
}

function isGroupRemoteId(serializedId?: string | null) {
  return Boolean(serializedId?.trim().endsWith("@g.us"));
}

function buildDirectChatId(phone: string) {
  const normalizedPhone = normalizeChatPhone(phone);
  return normalizedPhone ? `${normalizedPhone}@c.us` : null;
}

function isUsableWhatsAppPhone(serializedId?: string | null) {
  const phone = toPhoneNumber(serializedId);
  return Boolean(phone && /\d/.test(phone));
}

function isStatusLikeRemoteId(serializedId?: string | null) {
  const normalized = serializedId?.trim().toLowerCase() ?? "";
  return normalized === "status@broadcast" || normalized.endsWith("@broadcast");
}

function isStatusLikeMessage(message: Message) {
  const candidateMessage = message as Message & {
    isStatus?: boolean | null;
    broadcast?: boolean | null;
    from?: string | null;
    to?: string | null;
  };

  return (
    candidateMessage.isStatus === true ||
    candidateMessage.broadcast === true ||
    isStatusLikeRemoteId(candidateMessage.from) ||
    isStatusLikeRemoteId(candidateMessage.to)
  );
}

function canImportChat(chat: {
  isGroup?: boolean;
  isChannel?: boolean;
  id?: {
    user?: string;
    _serialized?: string;
  };
}) {
  if (chat.isChannel) {
    return false;
  }

  const user = chat.id?.user?.trim();
  const serialized = chat.id?._serialized?.trim();

  if (isStatusLikeRemoteId(serialized)) {
    return false;
  }

  if (user) {
    return true;
  }

  return Boolean(serialized && serialized.includes("@"));
}

function getChatIdentifier(chat: {
  id?: {
    _serialized?: string;
  };
}) {
  return chat.id?._serialized?.trim() || null;
}

function serializeWhatsAppContactSnapshot(contact?: {
  id?: {
    _serialized?: string | null;
  } | null;
  name?: string | null;
  pushname?: string | null;
  number?: string | null;
} | null) {
  return {
    id: contact?.id?._serialized?.trim() || null,
    name: contact?.name?.trim() || null,
    pushname: contact?.pushname?.trim() || null,
    number: contact?.number?.trim() || null
  };
}

function mergeRawPayloadContactSnapshot(rawPayload: unknown, contact?: ReturnType<typeof serializeWhatsAppContactSnapshot>) {
  if (rawPayload && typeof rawPayload === "object" && !Array.isArray(rawPayload)) {
    return {
      ...(rawPayload as Record<string, unknown>),
      contact: contact ?? null
    };
  }

  return rawPayload;
}

async function resolveIncomingContactIdentity(input: {
  workspaceId: string;
  client: WhatsAppClient;
  remoteId: string;
  notifyName?: string | null;
  fallbackId?: string | null;
  contact?: {
    pushname?: string | null;
    name?: string | null;
    number?: string | null;
    getProfilePicUrl?: () => Promise<string | null>;
  } | null;
  chat?: {
    name?: string | null;
  } | null;
}) {
  const isGroup = isGroupRemoteId(input.remoteId);
  const phone = isGroup ? toStoredPhone(input.remoteId) : toStoredPhone(input.remoteId, input.contact?.number ?? null);
  const primaryPhotoUrl = isGroup ? null : await input.contact?.getProfilePicUrl?.().catch(() => null);
  const fallbackPhotoUrl = await input.client.getProfilePicUrl(input.remoteId).catch(() => null);
  const bridgePhotoUrl =
    primaryPhotoUrl || fallbackPhotoUrl
      ? null
      : await getBridgeProfilePhotoUrl(input.client, input.remoteId);
  const livePhotoUrl = primaryPhotoUrl ?? fallbackPhotoUrl ?? bridgePhotoUrl ?? null;
  const photoUrl = await cacheProfilePhoto({
    client: input.client,
    workspaceId: input.workspaceId,
    remoteId: input.remoteId,
    phone,
    photoUrl: livePhotoUrl
  });
  const displayName = resolveIncomingDisplayName({
    notifyName: isGroup ? null : input.notifyName,
    pushname: isGroup ? null : input.contact?.pushname,
    contactName: isGroup ? null : input.contact?.name,
    chatName: input.chat?.name,
    phone: isGroup ? phone : input.contact?.number ?? phone,
    fallbackId: input.fallbackId
  });

  console.info(
    `[whatsapp-web][avatar-resolve] remote=${input.remoteId} phone=${phone ?? "unknown"} primary=${
      primaryPhotoUrl ? "yes" : "no"
    } fallback=${fallbackPhotoUrl ? "yes" : "no"} bridge=${bridgePhotoUrl ? "yes" : "no"} cached=${
      photoUrl ? "yes" : "no"
    }`
  );

  return {
    displayName,
    phone,
    photoUrl,
    primaryPhotoUrl,
    fallbackPhotoUrl,
    bridgePhotoUrl
  };
}

function getChatSortTimestamp(chat: {
  timestamp?: number | null;
  lastMessage?: {
    timestamp?: number | null;
  } | null;
}) {
  return chat.lastMessage?.timestamp ?? chat.timestamp ?? 0;
}

function buildFallbackSyncPayload(chat: {
  id?: {
    user?: string;
    _serialized?: string;
  };
  name?: string | null;
  timestamp?: number | null;
  unreadCount?: number | null;
  lastMessage?: {
    id?: {
      _serialized?: string;
    } | null;
    body?: string | null;
    fromMe?: boolean | null;
    timestamp?: number | null;
    type?: string | null;
    hasMedia?: boolean | null;
  } | null;
}) {
  const phone = toStoredPhone(chat.id?._serialized);
  const lastMessageId = chat.lastMessage?.id?._serialized?.trim();

  if (!phone || !lastMessageId) {
    return null;
  }

  return {
    phone,
    displayName: chat.name?.trim() || phone,
    unreadCount: chat.unreadCount ?? 0,
    messages: [
      {
        id: lastMessageId,
        body: chat.lastMessage?.body,
        fromMe: Boolean(chat.lastMessage?.fromMe),
        timestamp: chat.lastMessage?.timestamp ?? chat.timestamp ?? null,
        type: chat.lastMessage?.type ?? null,
        hasMedia: chat.lastMessage?.hasMedia ?? undefined,
        rawPayload: {
          source: "chat-fallback",
          chatId: chat.id?._serialized ?? null,
          body: chat.lastMessage?.body ?? null,
          timestamp: chat.lastMessage?.timestamp ?? chat.timestamp ?? null,
          type: chat.lastMessage?.type ?? null,
          fromMe: Boolean(chat.lastMessage?.fromMe)
        }
      }
    ]
  };
}

function buildResolvedFallbackSyncPayload(input: {
  serializedId?: string | null;
  fallbackNumber?: string | null;
  displayName?: string | null;
  contact?: ReturnType<typeof serializeWhatsAppContactSnapshot> | null;
  unreadCount?: number | null;
  timestamp?: number | null;
  lastMessage?: {
    id?: {
      _serialized?: string;
    } | null;
    body?: string | null;
    fromMe?: boolean | null;
    timestamp?: number | null;
    type?: string | null;
    hasMedia?: boolean | null;
  } | null;
}) {
  const phone = toStoredPhone(input.serializedId, input.fallbackNumber);
  const lastMessageId = input.lastMessage?.id?._serialized?.trim();

  if (!phone || !lastMessageId) {
    return null;
  }

  return {
    phone,
    displayName: input.displayName?.trim() || phone,
    unreadCount: input.unreadCount ?? 0,
    messages: [
      {
        id: lastMessageId,
        body: input.lastMessage?.body,
        fromMe: Boolean(input.lastMessage?.fromMe),
        timestamp: input.lastMessage?.timestamp ?? input.timestamp ?? null,
        type: input.lastMessage?.type ?? null,
        hasMedia: input.lastMessage?.hasMedia ?? undefined,
        rawPayload: {
          source: "chat-fallback",
          chatId: input.serializedId ?? null,
          contact: input.contact ?? null,
          body: input.lastMessage?.body ?? null,
          timestamp: input.lastMessage?.timestamp ?? input.timestamp ?? null,
          type: input.lastMessage?.type ?? null,
          fromMe: Boolean(input.lastMessage?.fromMe)
        }
      }
    ]
  };
}

function isTransientExecutionContextError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  return (
    message.includes("Attempted to use detached Frame") ||
    message.includes("Execution context was destroyed") ||
    message.includes("Cannot find context with specified id") ||
    message.includes("Target closed") ||
    message.includes("Session closed") ||
    message.includes("Protocol error") ||
    message.includes("Runtime.callFunctionOn timed out") ||
    message.includes("Increase the 'protocolTimeout' setting")
  );
}

function isTransientChatLoadingError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  return (
    message.includes("waitForChatLoading") ||
    message.includes("Cannot read properties of undefined (reading 'waitForChatLoading')")
  );
}

function isTransientWhatsAppSyncError(error: unknown) {
  return isTransientExecutionContextError(error) || isTransientChatLoadingError(error);
}

function getMessageMentionMetadata(message: Message) {
  const record = message as Message & {
    mentionedIds?: unknown;
    mentionedJidList?: unknown;
    mentionedJids?: unknown;
    groupMentions?: unknown;
    links?: unknown;
  };

  return {
    mentionedIds: normalizeStringArray(record.mentionedIds),
    mentionedJidList: normalizeStringArray(record.mentionedJidList),
    mentionedJids: normalizeStringArray(record.mentionedJids),
    groupMentions: Array.isArray(record.groupMentions) ? record.groupMentions : [],
    links: Array.isArray(record.links) ? record.links : []
  };
}

function normalizeStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean)
    : [];
}

function getMentionIdsFromGroupMentions(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as string[];
  }

  return value
    .map((entry) => {
      if (typeof entry === "string") {
        return entry.trim();
      }

      if (!entry || typeof entry !== "object") {
        return null;
      }

      const record = entry as Record<string, unknown>;
      const candidates = [record.id, record.jid, record.mentionId, record.participant];

      for (const candidate of candidates) {
        if (typeof candidate === "string" && candidate.trim()) {
          return candidate.trim();
        }
      }

      return null;
    })
    .filter((value): value is string => Boolean(value));
}

function extractMentionTokensFromBody(body?: string | null) {
  const matches = body?.match(/@[\dA-Za-z._-]+/g) ?? [];
  return matches
    .map((match) => match.slice(1).trim())
    .filter(Boolean)
    .map((value) => (/^\d+$/.test(value) ? `${value}@lid` : value));
}

function collectMentionIdsFromBodyAndMetadata(input: {
  body?: string | null;
  metadata?: {
    mentionedIds?: string[];
    mentionedJidList?: string[];
    mentionedJids?: string[];
    groupMentions?: unknown[];
  } | null;
}) {
  return Array.from(
    new Set(
      [
        ...(input.metadata?.mentionedIds ?? []),
        ...(input.metadata?.mentionedJidList ?? []),
        ...(input.metadata?.mentionedJids ?? []),
        ...getMentionIdsFromGroupMentions(input.metadata?.groupMentions ?? []),
        ...extractMentionTokensFromBody(input.body)
      ]
        .map((value) => value.trim())
        .filter(Boolean)
    )
  );
}

function asPlainRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseJsonRecord(value?: string | null) {
  if (!value) {
    return null;
  }

  try {
    return asPlainRecord(JSON.parse(value));
  } catch {
    return null;
  }
}

function collectMentionIdsFromRecord(record: Record<string, unknown> | null) {
  if (!record) {
    return [] as string[];
  }

  const author = typeof record.author === "string" ? record.author.trim() : "";
  const contactId = typeof record.contactId === "string" ? record.contactId.trim() : "";
  const storedMentionIds = Array.isArray(record.mentions)
    ? record.mentions
        .map((entry) => {
          if (!entry || typeof entry !== "object") {
            return "";
          }

          const mentionRecord = entry as Record<string, unknown>;
          return typeof mentionRecord.id === "string" ? mentionRecord.id.trim() : "";
        })
        .filter(Boolean)
    : [];

  return Array.from(
    new Set(
      [
        ...collectMentionIdsFromBodyAndMetadata({
          body: typeof record.body === "string" ? record.body : null,
          metadata: {
            mentionedIds: normalizeStringArray(record.mentionedIds),
            mentionedJidList: normalizeStringArray(record.mentionedJidList),
            mentionedJids: normalizeStringArray(record.mentionedJids),
            groupMentions: Array.isArray(record.groupMentions) ? record.groupMentions : []
          }
        }),
        author,
        contactId,
        ...storedMentionIds
      ]
        .map((value) => value.trim())
        .filter(Boolean)
    )
  );
}

function collectStoredMentionCandidates(record: Record<string, unknown> | null) {
  const candidates: Array<{
    id: string;
    label: string;
    token: string;
    phone: string | null;
    name: string | null;
    pushname: string | null;
  }> = [];

  if (!record || !Array.isArray(record.mentions)) {
    return candidates;
  }

  for (const entry of record.mentions) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const mentionRecord = entry as Record<string, unknown>;
    const id = typeof mentionRecord.id === "string" ? mentionRecord.id.trim() : "";
    const label = typeof mentionRecord.label === "string" ? mentionRecord.label.trim() : "";
    const token = typeof mentionRecord.token === "string" ? mentionRecord.token.trim() : "";

    if (!id || !label || !token) {
      continue;
    }

    candidates.push({
      id,
      label,
      token,
      phone: token.replace(/[^\d]/g, "") || null,
      name: label,
      pushname: label
    });
  }

  return candidates;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function prefixMentionLabel(value: string) {
  const normalized = value.trim();
  if (!normalized) {
    return normalized;
  }

  return normalized.startsWith("@") ? normalized : `@${normalized}`;
}

function formatFallbackMentionLabel(mentionId: string) {
  const normalized = mentionId.replace(/@(?:lid|c\.us|g\.us)$/i, "").trim();
  return normalized ? prefixMentionLabel(normalized) : mentionId;
}

function replaceMentionTokens(body: string, mentionIds: string[], mentionLabels: Map<string, string>) {
  if (!body.trim() || !mentionIds.length) {
    return body;
  }

  let nextBody = body;

  for (const mentionId of mentionIds) {
    const numericId = mentionId.replace(/@(?:lid|c\.us|g\.us)$/i, "").trim();
    if (!numericId) {
      continue;
    }

    const label = mentionLabels.get(mentionId) ?? formatFallbackMentionLabel(mentionId);
    nextBody = nextBody.replace(new RegExp(`@${escapeRegExp(numericId)}\\b`, "g"), label);
  }

  return nextBody;
}

function formatMentionLabel(contact: {
  id: string;
  phone: string | null;
  name: string | null;
  pushname: string | null;
}) {
  const label = contact.name?.trim() || contact.pushname?.trim() || contact.phone?.trim() || null;
  return label ? prefixMentionLabel(label) : formatFallbackMentionLabel(contact.id);
}

async function resolveMentionLabels(input: {
  client: WhatsAppClient;
  mentionIds: string[];
}) {
  const contacts = await Promise.all(
    Array.from(new Set(input.mentionIds.map((value) => value.trim()).filter(Boolean))).map((mentionId) =>
      resolveMentionContact(input.client, mentionId)
    )
  );

  return new Map<string, string>(
    contacts.map((contact) => [contact.id, formatMentionLabel(contact)])
  );
}

async function resolveMentionContact(client: WhatsAppClient, mentionId: string) {
  const browserResolved = await resolveMentionContactViaBrowser(client, mentionId);
  const primaryContact = await client.getContactById(mentionId).catch(() => null);
  const fallbackContact =
    browserResolved?.resolvedId && browserResolved.resolvedId !== mentionId
      ? await client.getContactById(browserResolved.resolvedId).catch(() => null)
      : null;

  return {
    id: mentionId,
    phone:
      toStoredPhone(mentionId, primaryContact?.number ?? null) ||
      toStoredPhone(browserResolved?.resolvedId ?? null, fallbackContact?.number ?? null) ||
      toStoredPhone(browserResolved?.phone ?? null) ||
      browserResolved?.phone ||
      null,
    name:
      primaryContact?.name?.trim() ||
      fallbackContact?.name?.trim() ||
      browserResolved?.name?.trim() ||
      null,
    pushname:
      primaryContact?.pushname?.trim() ||
      fallbackContact?.pushname?.trim() ||
      browserResolved?.pushname?.trim() ||
      null,
    resolvedId: browserResolved?.resolvedId?.trim() || primaryContact?.id?._serialized?.trim() || null,
    target: primaryContact ?? fallbackContact ?? null
  };
}

function formatMentionToken(contact: {
  id: string;
  phone: string | null;
}) {
  const normalizedPhone = contact.phone?.replace(/[^\d]/g, "") ?? "";
  if (normalizedPhone) {
    return normalizedPhone;
  }

  return contact.id.replace(/@(?:lid|c\.us|g\.us)$/i, "").trim();
}

async function normalizeSyncedMessagesWithMentions<
  T extends {
    body?: string | null;
    rawPayload?: unknown;
  }
>(input: {
  client: WhatsAppClient;
  messages: T[];
}) {
  const mentionIds = Array.from(
    new Set(
      input.messages.flatMap((message) =>
        collectMentionIdsFromBodyAndMetadata({
          body: message.body,
          metadata: message.rawPayload && typeof message.rawPayload === "object"
            ? {
                mentionedIds: normalizeStringArray((message.rawPayload as Record<string, unknown>).mentionedIds),
                mentionedJidList: normalizeStringArray((message.rawPayload as Record<string, unknown>).mentionedJidList),
                mentionedJids: normalizeStringArray((message.rawPayload as Record<string, unknown>).mentionedJids),
                groupMentions: Array.isArray((message.rawPayload as Record<string, unknown>).groupMentions)
                  ? ((message.rawPayload as Record<string, unknown>).groupMentions as unknown[])
                  : []
              }
            : null
        })
      )
    )
  );
  const mentionLabels = mentionIds.length
    ? await resolveMentionLabels({
        client: input.client,
        mentionIds
      }).catch(() => new Map<string, string>())
    : new Map<string, string>();

  return input.messages.map((message) => {
    const mentionIdsForMessage = collectMentionIdsFromBodyAndMetadata({
      body: message.body,
      metadata: message.rawPayload && typeof message.rawPayload === "object"
        ? {
            mentionedIds: normalizeStringArray((message.rawPayload as Record<string, unknown>).mentionedIds),
            mentionedJidList: normalizeStringArray((message.rawPayload as Record<string, unknown>).mentionedJidList),
            mentionedJids: normalizeStringArray((message.rawPayload as Record<string, unknown>).mentionedJids),
            groupMentions: Array.isArray((message.rawPayload as Record<string, unknown>).groupMentions)
              ? ((message.rawPayload as Record<string, unknown>).groupMentions as unknown[])
              : []
          }
        : null
    });
    const rawBody = message.body ?? "";
    const resolvedBody = replaceMentionTokens(rawBody, mentionIdsForMessage, mentionLabels);

    return {
      ...message,
      body: resolvedBody,
      rawPayload:
        message.rawPayload && typeof message.rawPayload === "object"
          ? {
              ...(message.rawPayload as Record<string, unknown>),
              rawBody,
              body: resolvedBody
            }
          : message.rawPayload
    };
  });
}

function getTransientSyncMessage() {
  return "WhatsApp is still preparing chat history. Connexa will retry automatically in the background.";
}

function getDeferredHistoryMessage() {
  return "Historical chat import has been deferred. Connexa will keep live messaging active and retry history later.";
}

function isTransientSetupMessage(message: string) {
  return (
    message.includes("WhatsApp is still finalizing the browser session") ||
    message.includes("WhatsApp is still preparing chat history") ||
    message.includes("Attempted to use detached Frame") ||
    message.includes("Execution context was destroyed") ||
    message.includes("Protocol error (Runtime.callFunctionOn)") ||
    message.includes("Runtime.callFunctionOn timed out")
  );
}

function clearBackgroundSyncTimer(state: RuntimeState) {
  if (state.backgroundSyncTimer) {
    clearTimeout(state.backgroundSyncTimer);
    state.backgroundSyncTimer = null;
  }
}

function clearStallRecoveryTimer(state: RuntimeState) {
  if (state.stallRecoveryTimer) {
    clearTimeout(state.stallRecoveryTimer);
    state.stallRecoveryTimer = null;
  }
}

function clearReconnectTimer(state: RuntimeState) {
  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }
}

function clearIdleEvictionTimer(state: RuntimeState) {
  if (state.idleEvictionTimer) {
    clearTimeout(state.idleEvictionTimer);
    state.idleEvictionTimer = null;
  }
}

function canEvictIdleRuntime(state: RuntimeState) {
  return (
    WHATSAPP_IDLE_EVICT_MS > 0 &&
    state.hasCompletedInitialSync &&
    state.deferredHistoryChatIds.length === 0 &&
    !state.isSyncingHistory &&
    (state.connectionStatus === "CONNECTED" || state.connectionStatus === "READY")
  );
}

async function evictIdleRuntime(state: RuntimeState, expectedActivityAt: number) {
  const currentRuntime = runtimeStates.get(buildRuntimeKey(state.workspaceId));
  if (
    currentRuntime !== state ||
    state.lastActivityAt !== expectedActivityAt ||
    !canEvictIdleRuntime(state)
  ) {
    return;
  }

  console.info(
    `[whatsapp-web][runtime] workspace=${state.workspaceId} session=${state.sessionClientId} idle-evict after ${WHATSAPP_IDLE_EVICT_MS}ms`
  );
  void logWhatsAppRuntimeEvent({
    workspaceId: state.workspaceId,
    sessionClientId: state.sessionClientId,
    eventType: WHATSAPP_RUNTIME_EVENT_TYPES.IDLE_EVICTED,
    message: `Idle browser runtime evicted after ${WHATSAPP_IDLE_EVICT_MS}ms.`,
    metadata: {
      idleEvictMs: WHATSAPP_IDLE_EVICT_MS,
      lastActivityAt: new Date(expectedActivityAt).toISOString()
    }
  });

  await teardownRuntimeState(state.workspaceId);
}

function scheduleIdleEviction(state: RuntimeState) {
  clearIdleEvictionTimer(state);

  if (!canEvictIdleRuntime(state)) {
    return;
  }

  const expectedActivityAt = state.lastActivityAt;
  state.idleEvictionTimer = setTimeout(() => {
    void evictIdleRuntime(state, expectedActivityAt).catch((error) => {
      console.error(
        `[whatsapp-web][runtime] workspace=${state.workspaceId} session=${state.sessionClientId} idle-evict:error ${
          error instanceof Error ? error.message : "Unknown idle eviction error."
        }`
      );
    });
  }, WHATSAPP_IDLE_EVICT_MS);
}

function touchRuntimeActivity(state: RuntimeState) {
  state.lastActivityAt = Date.now();
  scheduleIdleEviction(state);
}

function shouldWatchForStalledRuntime(state: RuntimeState) {
  return state.connectionStatus === "INITIALIZING" || state.connectionStatus === "AUTHENTICATED";
}

function isActiveRuntimeState(state: RuntimeState) {
  return runtimeStates.get(buildRuntimeKey(state.workspaceId)) === state;
}

function updateRuntimeStatus(state: RuntimeState, status: string) {
  state.connectionStatus = status;
  state.statusUpdatedAt = Date.now();
  recordRuntimeStatusMetric({
    workspaceId: state.workspaceId,
    sessionClientId: state.sessionClientId,
    runtimeStatus: status
  });
  clearStallRecoveryTimer(state);

  if (!shouldWatchForStalledRuntime(state)) {
    return;
  }

  const statusUpdatedAt = state.statusUpdatedAt;
  const expectedStatus = status;
  state.stallRecoveryTimer = setTimeout(() => {
    void recoverStalledRuntime(state, expectedStatus, statusUpdatedAt).catch((error) => {
      console.error(
        `[whatsapp-web][runtime] workspace=${state.workspaceId} session=${state.sessionClientId} stall-recovery:error ${
          error instanceof Error ? error.message : "Unknown stall recovery error."
        }`
      );
    });
  }, WHATSAPP_CONNECTION_STALL_MS);
}

async function teardownRuntimeState(workspaceId: string) {
  const runtimeKey = buildRuntimeKey(workspaceId);
  const runtime = runtimeStates.get(runtimeKey);

  if (!runtime) {
    runtimeStates.delete(runtimeKey);
    return;
  }

  clearBackgroundSyncTimer(runtime);
  clearStallRecoveryTimer(runtime);
  clearReconnectTimer(runtime);
  clearIdleEvictionTimer(runtime);
  runtimeStates.delete(runtimeKey);
  await runtime.client.destroy().catch(() => null);
}

function isSessionInvalidationDisconnectReason(reason: unknown) {
  const message = String(reason ?? "").toLowerCase();

  return (
    message.includes("logout") ||
    message.includes("logged out") ||
    message.includes("invalid session") ||
    message.includes("auth") ||
    message.includes("multidevice mismatch")
  );
}

function isTransientDisconnectReason(reason: unknown) {
  const message = String(reason ?? "").toLowerCase();

  return (
    !message ||
    message.includes("navigation") ||
    message.includes("protocol error") ||
    message.includes("execution context") ||
    message.includes("target closed") ||
    message.includes("session closed") ||
    message.includes("connection closed") ||
    message.includes("timeout") ||
    message.includes("restart")
  );
}

async function scheduleRuntimeReconnect(state: RuntimeState, delayMs = 5000) {
  const recoveryAttempt = registerAutomaticRecoveryAttempt({
    workspaceId: state.workspaceId
  });

  if (!recoveryAttempt.allowed) {
    void logWhatsAppRuntimeEvent({
      workspaceId: state.workspaceId,
      sessionClientId: state.sessionClientId,
      eventType: WHATSAPP_RUNTIME_EVENT_TYPES.SUPERVISOR_PAUSED,
      message: recoveryAttempt.status.manualAttentionReason
    });
    await markWorkspaceWhatsAppChannelDisconnected({
      workspaceId: state.workspaceId,
      connectionStatus: "ERROR",
      lastError: recoveryAttempt.status.manualAttentionReason
    });
    return;
  }

  clearReconnectTimer(state);
  void logWhatsAppRuntimeEvent({
    workspaceId: state.workspaceId,
    sessionClientId: state.sessionClientId,
    eventType: WHATSAPP_RUNTIME_EVENT_TYPES.RECONNECT_SCHEDULED,
    message: `Transient disconnect detected. Reconnect scheduled in ${delayMs}ms.`,
    metadata: {
      delayMs
    }
  });
  state.reconnectTimer = setTimeout(() => {
    void ensureWorkspaceWhatsAppClient({
      workspaceId: state.workspaceId,
      agentId: state.agentId
    }).catch((error) => {
      console.error(
        `[whatsapp-web][runtime] workspace=${state.workspaceId} session=${state.sessionClientId} reconnect:error ${
          error instanceof Error ? error.message : "Unknown reconnect error."
        }`
      );
    });
  }, delayMs);
}

async function recoverStalledRuntime(
  state: RuntimeState,
  expectedStatus: string,
  statusUpdatedAt: number
) {
  const currentRuntime = runtimeStates.get(buildRuntimeKey(state.workspaceId));
  if (
    currentRuntime !== state ||
    state.connectionStatus !== expectedStatus ||
    state.statusUpdatedAt !== statusUpdatedAt
  ) {
    return;
  }

  const recoveryAttempt = registerAutomaticRecoveryAttempt({
    workspaceId: state.workspaceId
  });

  if (!recoveryAttempt.allowed) {
    console.warn(
      `[whatsapp-web][runtime] workspace=${state.workspaceId} session=${state.sessionClientId} stall-recovery:paused ${recoveryAttempt.status.manualAttentionReason}`
    );
    void logWhatsAppRuntimeEvent({
      workspaceId: state.workspaceId,
      sessionClientId: state.sessionClientId,
      eventType: WHATSAPP_RUNTIME_EVENT_TYPES.SUPERVISOR_PAUSED,
      message: recoveryAttempt.status.manualAttentionReason,
      metadata: {
        expectedStatus
      }
    });
    await teardownRuntimeState(state.workspaceId);
    await saveWorkspaceWhatsAppChannelConnection({
      workspaceId: state.workspaceId,
      agentId: state.agentId,
      sessionClientId: state.sessionClientId,
      connectionStatus: "ERROR",
      lastError: recoveryAttempt.status.manualAttentionReason
    });
    return;
  }

  const reason =
    expectedStatus === "AUTHENTICATED"
      ? "WhatsApp authenticated but never became ready. Connexa restarted the runtime and kept the saved session."
      : "WhatsApp initialization stalled before the session became ready. Connexa restarted the runtime and kept the saved session.";

  console.warn(
    `[whatsapp-web][runtime] workspace=${state.workspaceId} session=${state.sessionClientId} stall-recovery ${expectedStatus}: ${reason}`
  );
  void logWhatsAppRuntimeEvent({
    workspaceId: state.workspaceId,
    sessionClientId: state.sessionClientId,
    eventType: WHATSAPP_RUNTIME_EVENT_TYPES.STALL_RECOVERY,
    message: reason,
    metadata: {
      expectedStatus
    }
  });

  await restartRuntimePreservingSession(state, reason, {
    expectedStatus,
    trigger: "stall-recovery"
  });
}

async function restartRuntimePreservingSession(
  state: RuntimeState,
  lastError: string,
  metadata?: Record<string, unknown>
) {
  await teardownRuntimeState(state.workspaceId);
  await saveWorkspaceWhatsAppChannelConnection({
    workspaceId: state.workspaceId,
    agentId: state.agentId,
    sessionClientId: state.sessionClientId,
    connectionStatus: "INITIALIZING",
    qrCodeDataUrl: null,
    qrCodeUpdatedAt: null,
    lastError
  });
  void logWhatsAppRuntimeEvent({
    workspaceId: state.workspaceId,
    sessionClientId: state.sessionClientId,
    eventType: WHATSAPP_RUNTIME_EVENT_TYPES.RECONNECT_SCHEDULED,
    message: "Transient WhatsApp runtime failure detected. Restarting runtime while preserving the saved session.",
    metadata
  });
  await ensureWorkspaceWhatsAppClient({
    workspaceId: state.workspaceId,
    agentId: state.agentId
  });
}

function scheduleBackgroundSync(state: RuntimeState, delayMs: number) {
  clearBackgroundSyncTimer(state);
  state.backgroundSyncTimer = setTimeout(() => {
    void syncWorkspaceHistory(state.workspaceId, { triggeredBy: "background" }).catch(() => null);
  }, delayMs);
}

function resetHistoryRetryState(state: RuntimeState) {
  state.historySyncStartedAt = null;
  state.historyRetryDelayMs = WHATSAPP_HISTORY_RETRY_BASE_MS;
}

function getNextHistoryRetryDelay(state: RuntimeState) {
  const nextDelay = state.historyRetryDelayMs
    ? Math.min(state.historyRetryDelayMs * 2, WHATSAPP_HISTORY_RETRY_MAX_MS)
    : WHATSAPP_HISTORY_RETRY_BASE_MS;

  state.historyRetryDelayMs = nextDelay;
  return nextDelay;
}

function deferHistoryImport(state: RuntimeState) {
  state.connectionStatus = state.hasCompletedInitialSync ? "READY" : "CONNECTED";
  state.lastError = getDeferredHistoryMessage();
  state.historyRetryDelayMs = WHATSAPP_HISTORY_DEFERRED_RETRY_MS;
  state.historySyncStartedAt = Date.now();
  return WHATSAPP_HISTORY_DEFERRED_RETRY_MS;
}

function isConnectedRuntimeStatus(status: string) {
  return ["CONNECTED", "READY", "SYNCING_HISTORY"].includes(status);
}

async function fetchChatMessagesWithRecovery(input: {
  client: WhatsAppClient;
  chat: {
    id: {
      _serialized?: string | null;
    };
    syncHistory: () => Promise<unknown>;
    fetchMessages: (options: { limit: number }) => Promise<Message[]>;
  };
  limit: number;
}) {
  const chatId = input.chat.id?._serialized?.trim() || null;
  let activeChat = input.chat;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await retryWhatsAppOperation(() => activeChat.syncHistory().then(() => true), 2).catch(() => false);
      return await retryWhatsAppOperation(() => activeChat.fetchMessages({ limit: input.limit }));
    } catch (error) {
      lastError = error;

      if (!isTransientWhatsAppSyncError(error) || !chatId || attempt === 3) {
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
      const refreshedChat = await retryWhatsAppOperation(
        () => input.client.getChatById(chatId) as Promise<typeof activeChat>,
        2
      ).catch(() => null);

      if (!refreshedChat) {
        throw error;
      }

      activeChat = refreshedChat;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Unable to recover WhatsApp chat history.");
}

async function retryWhatsAppOperation<T>(operation: () => Promise<T>, attempts = 3, delayMs = 500): Promise<T> {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (!isTransientExecutionContextError(error) || attempt === attempts) {
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("WhatsApp operation failed.");
}

function bindClientEvents(state: RuntimeState) {
  state.client.on("qr", async (qr) => {
    if (!isActiveRuntimeState(state)) {
      return;
    }

    console.info(
      `[whatsapp-web][event] workspace=${state.workspaceId} session=${state.sessionClientId} qr`
    );
    state.qrCodeDataUrl = await QRCode.toDataURL(qr);
    updateRuntimeStatus(state, "QR_READY");
    state.lastError = null;
    void logWhatsAppRuntimeEvent({
      workspaceId: state.workspaceId,
      sessionClientId: state.sessionClientId,
      eventType: WHATSAPP_RUNTIME_EVENT_TYPES.QR_READY,
      message: "QR code generated and ready to scan."
    });

    await saveWorkspaceWhatsAppChannelConnection({
      workspaceId: state.workspaceId,
      agentId: state.agentId,
      sessionClientId: state.sessionClientId,
      connectionStatus: "QR_READY",
      displayName: null,
      phoneNumber: null,
      qrCodeDataUrl: state.qrCodeDataUrl,
      qrCodeUpdatedAt: new Date(),
      lastError: null,
      connectedAt: null
    });
  });

  state.client.on("authenticated", async () => {
    if (!isActiveRuntimeState(state)) {
      return;
    }

    console.info(
      `[whatsapp-web][event] workspace=${state.workspaceId} session=${state.sessionClientId} authenticated`
    );
    updateRuntimeStatus(state, "AUTHENTICATED");
    state.lastError = null;
    void logWhatsAppRuntimeEvent({
      workspaceId: state.workspaceId,
      sessionClientId: state.sessionClientId,
      eventType: WHATSAPP_RUNTIME_EVENT_TYPES.AUTHENTICATED,
      message: "WhatsApp session authenticated."
    });

    await saveWorkspaceWhatsAppChannelConnection({
      workspaceId: state.workspaceId,
      agentId: state.agentId,
      sessionClientId: state.sessionClientId,
      connectionStatus: "AUTHENTICATED",
      qrCodeDataUrl: state.qrCodeDataUrl,
      qrCodeUpdatedAt: state.qrCodeDataUrl ? new Date() : null,
      lastError: null
    });
  });

  state.client.on("ready", async () => {
    if (!isActiveRuntimeState(state)) {
      return;
    }

    console.info(
      `[whatsapp-web][event] workspace=${state.workspaceId} session=${state.sessionClientId} ready`
    );
    clearBackgroundSyncTimer(state);
    state.qrCodeDataUrl = null;
    updateRuntimeStatus(state, "CONNECTED");
    state.lastError = null;
    state.historySyncStartedAt = Date.now();
    state.historyRetryDelayMs = WHATSAPP_HISTORY_RETRY_BASE_MS;
    touchRuntimeActivity(state);
    const previousSupervisorState = getRuntimeSupervisorStatus(state.workspaceId);
    recordRuntimeReady(state.workspaceId);
    recordRuntimeReadyMetric({
      workspaceId: state.workspaceId,
      sessionClientId: state.sessionClientId,
      wasColdStart: true
    });
    void logWhatsAppRuntimeEvent({
      workspaceId: state.workspaceId,
      sessionClientId: state.sessionClientId,
      eventType: WHATSAPP_RUNTIME_EVENT_TYPES.READY,
      message: "WhatsApp runtime became ready."
    });
    if (previousSupervisorState.requiresManualAttention || previousSupervisorState.recentAutoRecoveryCount > 0) {
      void logWhatsAppRuntimeEvent({
        workspaceId: state.workspaceId,
        sessionClientId: state.sessionClientId,
        eventType: WHATSAPP_RUNTIME_EVENT_TYPES.SUPERVISOR_RESUMED,
        message: "WhatsApp runtime recovered and cleared the supervisor attention state."
      });
    }

    await saveWorkspaceWhatsAppChannelConnection({
      workspaceId: state.workspaceId,
      agentId: state.agentId,
      sessionClientId: state.sessionClientId,
      connectionStatus: "CONNECTED",
      displayName: state.client.info?.pushname ?? null,
      phoneNumber: toPhoneNumber(state.client.info?.wid?._serialized),
      qrCodeDataUrl: null,
      qrCodeUpdatedAt: null,
      lastError: null,
      connectedAt: new Date()
    });

    scheduleBackgroundSync(state, 8000);
  });

  state.client.on("auth_failure", async (message) => {
    if (!isActiveRuntimeState(state)) {
      return;
    }

    console.warn(
      `[whatsapp-web][event] workspace=${state.workspaceId} session=${state.sessionClientId} auth_failure: ${message}`
    );
    clearBackgroundSyncTimer(state);
    updateRuntimeStatus(state, "AUTH_FAILED");
    state.lastError = message;
    state.qrCodeDataUrl = null;
    const supervisorStatus = recordRuntimeAuthFailure(state.workspaceId, message);
    void logWhatsAppRuntimeEvent({
      workspaceId: state.workspaceId,
      sessionClientId: state.sessionClientId,
      eventType: WHATSAPP_RUNTIME_EVENT_TYPES.AUTH_FAILURE,
      message
    });
    void logWhatsAppRuntimeEvent({
      workspaceId: state.workspaceId,
      sessionClientId: state.sessionClientId,
      eventType: WHATSAPP_RUNTIME_EVENT_TYPES.SUPERVISOR_PAUSED,
      message: supervisorStatus.manualAttentionReason
    });

    await saveWorkspaceWhatsAppChannelConnection({
      workspaceId: state.workspaceId,
      agentId: state.agentId,
      sessionClientId: state.sessionClientId,
      connectionStatus: "AUTH_FAILED",
      qrCodeDataUrl: null,
      qrCodeUpdatedAt: null,
      lastError: message
    });
  });

  state.client.on("disconnected", async (reason) => {
    if (!isActiveRuntimeState(state)) {
      return;
    }

    console.warn(
      `[whatsapp-web][event] workspace=${state.workspaceId} session=${state.sessionClientId} disconnected: ${String(reason)}`
    );
    clearBackgroundSyncTimer(state);
    updateRuntimeStatus(state, "DISCONNECTED");
    state.lastError = String(reason);
    state.qrCodeDataUrl = null;
    recordRuntimeDisconnected(state.workspaceId);
    void logWhatsAppRuntimeEvent({
      workspaceId: state.workspaceId,
      sessionClientId: state.sessionClientId,
      eventType: WHATSAPP_RUNTIME_EVENT_TYPES.DISCONNECTED,
      message: String(reason)
    });
    await teardownRuntimeState(state.workspaceId);

    if (isSessionInvalidationDisconnectReason(reason)) {
      await clearWorkspaceWhatsAppSession(
        state.workspaceId,
        String(reason),
        getSessionAuthPath(state.sessionClientId)
      );
      return;
    }

    await markWorkspaceWhatsAppChannelDisconnected({
      workspaceId: state.workspaceId,
      connectionStatus: "DISCONNECTED",
      lastError: String(reason)
    });

    if (isTransientDisconnectReason(reason)) {
      await scheduleRuntimeReconnect(state);
    }
  });

  state.client.on("message", async (message) => {
    const messageData = message as Message & {
      _data?: {
        notifyName?: string;
      };
      rawData?: unknown;
    };
    try {
      const contact = await message.getContact().catch(() => null);
      const contactSnapshot = serializeWhatsAppContactSnapshot(contact);
      const remoteId = message.fromMe ? message.to : message.from;
      const chat = await message.getChat().catch(() => null);

      if (
        isStatusLikeMessage(message) ||
        isStatusLikeRemoteId(remoteId) ||
        isStatusLikeRemoteId(chat?.id?._serialized)
      ) {
        return;
      }

      const resolvedIdentity = await resolveIncomingContactIdentity({
        workspaceId: state.workspaceId,
        client: state.client,
        remoteId,
        notifyName: messageData._data?.notifyName ?? null,
        fallbackId: message.fromMe ? message.to : message.from,
        contact,
        chat
      });

      logProfilePhotoResult({
        source: message.fromMe ? "sync" : "inbound",
        displayName: resolvedIdentity.displayName,
        phone: resolvedIdentity.phone,
        photoUrl: resolvedIdentity.primaryPhotoUrl,
        fallbackPhotoUrl: resolvedIdentity.fallbackPhotoUrl,
        bridgePhotoUrl: resolvedIdentity.bridgePhotoUrl
      });

      const body = message.body?.trim();
      const mediaAttachment = await extractIncomingMediaAttachment({
        workspaceId: state.workspaceId,
        providerMessageId: message.id._serialized,
        message
      });
      const messageRawPayload = messageData.rawData
        ? mergeRawPayloadContactSnapshot(messageData.rawData, contactSnapshot)
        : {
            author: (message as Message & { author?: string | null }).author ?? null,
            chatId: remoteId ?? null,
            from: message.from,
            to: message.to,
            fromMe: message.fromMe,
            body: message.body,
            notifyName: messageData._data?.notifyName ?? null,
            contact: contactSnapshot,
            ...getMessageMentionMetadata(message),
            hasMedia: message.hasMedia,
            type: message.type
          };
      let ingestedMessage:
        | Awaited<ReturnType<typeof ingestWhatsAppClientMessage>>
        | null = null;

      if (body || mediaAttachment?.attachmentUrl) {
        try {
          ingestedMessage = await ingestWhatsAppClientMessage({
            workspaceId: state.workspaceId,
            providerMessageId: message.id._serialized,
            direction: message.fromMe ? "OUTBOUND" : "INBOUND",
            attachmentMimeType: mediaAttachment?.attachmentMimeType ?? null,
            attachmentName: mediaAttachment?.attachmentName ?? null,
            attachmentUrl: mediaAttachment?.attachmentUrl ?? null,
            body: body ?? "",
            phone: resolvedIdentity.phone ?? undefined,
            displayName: resolvedIdentity.displayName ?? undefined,
            photoUrl: resolvedIdentity.photoUrl,
            sentAt: message.timestamp ? new Date(message.timestamp * 1000) : new Date(),
            rawPayload: messageRawPayload
          });
        } catch (ingestError) {
          console.warn(
            `[whatsapp-web][message][ingest] skipped business ingest for ${message.id._serialized}: ${
              ingestError instanceof Error ? ingestError.message : "Unknown ingest error."
            }`
          );
        }
      }

      await captureWhatsAppMessageEnvelope({
        workspaceId: state.workspaceId,
        message,
        rawData: messageRawPayload,
        conversationId: ingestedMessage?.conversationId ?? null,
        storedMessageId: ingestedMessage?.messageId ?? null
      });
      touchRuntimeActivity(state);
    } catch (error) {
      console.warn(
        `[whatsapp-web][message] skipped envelope capture ${message.id._serialized} for workspace ${state.workspaceId}: ${
          error instanceof Error ? error.message : "Unknown capture error."
        }`
      );
    }
  });

  state.client.on("message_reaction", async (reaction: Reaction) => {
    try {
      await captureWhatsAppReactionEnvelope({
        workspaceId: state.workspaceId,
        reaction
      });
    } catch (error) {
      console.warn(
        `[whatsapp-web][reaction] skipped envelope capture for workspace ${state.workspaceId}: ${
          error instanceof Error ? error.message : "Unknown capture error."
        }`
      );
    }
  });
}

async function initializeRuntime(state: RuntimeState) {
  if (!state.initializing) {
    state.initializing = (async () => {
      try {
        console.info(
          `[whatsapp-web][runtime] workspace=${state.workspaceId} session=${state.sessionClientId} initialize:start`
        );
        await state.client.initialize();
        console.info(
          `[whatsapp-web][runtime] workspace=${state.workspaceId} session=${state.sessionClientId} initialize:returned`
        );
      } catch (error) {
        if (isChromiumProfileLockError(error)) {
          console.warn(
            `[whatsapp-web][runtime] workspace=${state.workspaceId} session=${state.sessionClientId} initialize:profile-lock`
          );
          clearChromiumProfileLocks(state.sessionClientId);
          try {
            await state.client.initialize();
            console.info(
              `[whatsapp-web][runtime] workspace=${state.workspaceId} session=${state.sessionClientId} initialize:returned-after-lock-clear`
            );
            return;
          } catch (retryError) {
            if (isChromiumProfileLockError(retryError)) {
              const staleSessionClientId = state.sessionClientId;
              const freshSessionClientId = buildFreshSessionClientId(state.workspaceId, state.agentId);

              await state.client.destroy().catch(() => null);
              clearChromiumSessionProfile(staleSessionClientId);

              state.sessionClientId = freshSessionClientId;
              state.client = createWhatsAppClient(freshSessionClientId);
              bindClientEvents(state);

              await saveWorkspaceWhatsAppChannelConnection({
                workspaceId: state.workspaceId,
                agentId: state.agentId,
                sessionClientId: freshSessionClientId,
                connectionStatus: "INITIALIZING",
                lastError: null
              });

              await state.client.initialize();
              console.info(
                `[whatsapp-web][runtime] workspace=${state.workspaceId} session=${state.sessionClientId} initialize:returned-with-fresh-session`
              );
              return;
            }

            throw retryError;
          }
        }

        throw error;
      }
    })().catch(async (error: unknown) => {
      const message =
        error instanceof Error ? error.message : "Unable to initialize WhatsApp client.";
      const shouldResetRestoredRuntime =
        state.restoredFromSession &&
        isTransientExecutionContextError(error) &&
        state.connectionStatus === "AUTHENTICATED";
      const shouldPreserveConnectedState =
        !shouldResetRestoredRuntime &&
        isTransientExecutionContextError(error) &&
        ["AUTHENTICATED", "CONNECTED", "READY", "SYNCING_HISTORY"].includes(state.connectionStatus);

      if (shouldResetRestoredRuntime) {
        console.warn(
          `[whatsapp-web][runtime] workspace=${state.workspaceId} session=${state.sessionClientId} initialize:restart-after-restore ${message}`
        );
        await restartRuntimePreservingSession(state, message, {
          restoredFromSession: state.restoredFromSession,
          connectionStatus: state.connectionStatus,
          trigger: "initialize-after-restore"
        });
        return;
      }

      if (shouldPreserveConnectedState) {
        state.lastError = message;
        console.warn(
          `[whatsapp-web][runtime] workspace=${state.workspaceId} session=${state.sessionClientId} initialize:transient-after-connect ${message}`
        );

        await saveWorkspaceWhatsAppChannelConnection({
          workspaceId: state.workspaceId,
          agentId: state.agentId,
          sessionClientId: state.sessionClientId,
          connectionStatus: state.connectionStatus,
          lastError: state.lastError
        });

        return;
      }

      updateRuntimeStatus(state, "ERROR");
      state.lastError = message;
      console.error(
        `[whatsapp-web][runtime] workspace=${state.workspaceId} session=${state.sessionClientId} initialize:error ${
          state.lastError
        }`
      );
      void logWhatsAppRuntimeEvent({
        workspaceId: state.workspaceId,
        sessionClientId: state.sessionClientId,
        eventType: WHATSAPP_RUNTIME_EVENT_TYPES.INITIALIZE_ERROR,
        message: state.lastError,
        metadata: {
          restoredFromSession: state.restoredFromSession,
          connectionStatus: state.connectionStatus
        }
      });

      await saveWorkspaceWhatsAppChannelConnection({
        workspaceId: state.workspaceId,
        agentId: state.agentId,
        sessionClientId: state.sessionClientId,
        connectionStatus: "ERROR",
        lastError: state.lastError
      });

      throw error;
    });
  }

  await state.initializing;
}

async function waitForConnectedRuntime(
  runtime: RuntimeState,
  timeoutMs = 60000
): Promise<RuntimeState> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (isConnectedRuntimeStatus(runtime.connectionStatus) && runtime.client.info?.wid?._serialized) {
      return runtime;
    }

    if (runtime.connectionStatus === "AUTH_FAILED" || runtime.connectionStatus === "ERROR") {
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error("WhatsApp is still finalizing the browser session. Please try again in a moment.");
}

async function createRuntimeState(input: {
  workspaceId: string;
  agentId: string;
  sessionClientId: string;
  restoredFromSession?: boolean;
}) {
  const state: RuntimeState = {
    client: createWhatsAppClient(input.sessionClientId),
    agentId: input.agentId,
    workspaceId: input.workspaceId,
    sessionClientId: input.sessionClientId,
    restoredFromSession: Boolean(input.restoredFromSession),
    initializing: null,
    qrCodeDataUrl: null,
    connectionStatus: "INITIALIZING",
    lastError: null,
    isSyncingHistory: false,
    hasCompletedInitialSync: false,
    historySyncCursor: 0,
    deferredHistoryChatIds: [],
    historySyncStartedAt: null,
    historyRetryDelayMs: WHATSAPP_HISTORY_RETRY_BASE_MS,
    backgroundSyncTimer: null,
    statusUpdatedAt: Date.now(),
    stallRecoveryTimer: null,
    reconnectTimer: null,
    idleEvictionTimer: null,
    lastActivityAt: Date.now()
  };

  bindClientEvents(state);
  runtimeStates.set(buildRuntimeKey(input.workspaceId), state);
  recordRuntimeStartMetric({
    workspaceId: input.workspaceId,
    sessionClientId: input.sessionClientId,
    runtimeStatus: "INITIALIZING"
  });
  updateRuntimeStatus(state, "INITIALIZING");

    await saveWorkspaceWhatsAppChannelConnection({
      workspaceId: input.workspaceId,
      agentId: input.agentId,
      sessionClientId: input.sessionClientId,
      connectionStatus: "INITIALIZING",
      qrCodeDataUrl: null,
      qrCodeUpdatedAt: null,
      lastError: null
    });

  await initializeRuntime(state);
  return state;
}

async function getOrCreateRuntime(
  workspaceId: string,
  create: () => Promise<RuntimeState | null>
) {
  const runtimeKey = buildRuntimeKey(workspaceId);
  const existing = runtimeStates.get(runtimeKey);

  if (existing?.client) {
    return existing;
  }

  if (existing && !existing.client) {
    runtimeStates.delete(runtimeKey);
  }

  const pending = runtimeCreations.get(runtimeKey);
  if (pending) {
    return pending;
  }

  // Serialize runtime creation per workspace so polling and boot restore do not
  // race each other into duplicate Chromium sessions.
  const creation = create()
    .finally(() => {
      runtimeCreations.delete(runtimeKey);
    });

  runtimeCreations.set(runtimeKey, creation);
  return creation;
}

export async function ensureWorkspaceWhatsAppClient(input: {
  workspaceId: string;
  agentId: string;
  source?: "external" | "auto";
}) {
  return getOrCreateRuntime(input.workspaceId, async () => {
    const channel = await getWorkspaceWhatsAppChannelStatus(input.workspaceId);
    const sessionClientId =
      channel?.sessionClientId && channel.connectedByAgentId === input.agentId
        ? channel.sessionClientId
        : buildSessionClientId(input.workspaceId, input.agentId);

    return createRuntimeState({
      workspaceId: input.workspaceId,
      agentId: input.agentId,
      sessionClientId,
      restoredFromSession: false
    });
  });
}

export async function restoreWorkspaceWhatsAppClient(workspaceId: string) {
  return getOrCreateRuntime(workspaceId, async () => {
    const channel = await getWorkspaceWhatsAppChannelStatus(workspaceId);
    if (!channel?.connectedByAgentId || !channel.sessionClientId) {
      return null;
    }

    return createRuntimeState({
      workspaceId,
      agentId: channel.connectedByAgentId,
      sessionClientId: channel.sessionClientId,
      restoredFromSession: true
    });
  });
}

export async function getWorkspaceWhatsAppRuntimeStatus(input: {
  workspaceId: string;
  agentId: string;
}) {
  const channel = await getWorkspaceWhatsAppChannelStatus(input.workspaceId);
  const hydratedRuntime = runtimeStates.get(buildRuntimeKey(input.workspaceId));
  const supervisor = getRuntimeSupervisorStatus(input.workspaceId);

  return {
    channel,
    runtimeStatus: hydratedRuntime?.connectionStatus ?? channel?.connectionStatus ?? "DISCONNECTED",
    qrCodeDataUrl:
      hydratedRuntime?.qrCodeDataUrl ??
      (channel?.connectionStatus === "QR_READY" || channel?.connectionStatus === "AUTHENTICATED"
        ? channel.qrCodeDataUrl
        : null),
    lastError:
      hydratedRuntime?.lastError ??
      supervisor.manualAttentionReason ??
      channel?.lastError ??
      null,
    connectedByCurrentAgent: channel?.connectedByAgentId === input.agentId,
    isSyncingHistory: hydratedRuntime?.isSyncingHistory ?? false,
    supervisor
  };
}

export async function disconnectWorkspaceWhatsAppClient(workspaceId: string) {
  await teardownRuntimeState(workspaceId);
  clearRuntimeSupervisorState(workspaceId);

  await markWorkspaceWhatsAppChannelDisconnected({
    workspaceId,
    connectionStatus: "DISCONNECTED",
    lastError: null
  });
}

export async function deleteWorkspaceWhatsAppClientSession(workspaceId: string) {
  await teardownRuntimeState(workspaceId);
  clearRuntimeSupervisorState(workspaceId);

  const channel = await prisma.whatsAppChannel.findUnique({
    where: {
      workspaceId
    }
  });

  await deleteWorkspaceWhatsAppSession(
    workspaceId,
    channel?.sessionClientId ? getSessionAuthPath(channel.sessionClientId) : null
  );
}

export async function sendWhatsAppWebMessage(input: {
  workspaceId: string;
  conversationId: string;
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
}) {
  const startedAt = Date.now();
  const wasColdStart = !hasWarmRuntime(input.workspaceId);
  const runtime = await restoreWorkspaceWhatsAppClient(input.workspaceId);

  if (!runtime) {
    throw new Error("WhatsApp channel is not connected for this workspace.");
  }

  const connectedRuntime = await waitForConnectedRuntime(runtime);
  touchRuntimeActivity(connectedRuntime);
  const chatId = await resolveWhatsAppChatId(input);
  const normalizedMentions = Array.from(
    new Map(
      (input.mentions ?? [])
        .map((mention) => ({
          id: mention.id.trim(),
          label: mention.label.trim(),
          token: mention.token.trim()
        }))
        .filter((mention) => mention.id && mention.label && mention.token)
        .map((mention) => [mention.id, mention])
    ).values()
  );
  const mentionContacts = normalizedMentions.length
    ? await Promise.all(
        normalizedMentions.map((mention) =>
          resolveMentionContact(connectedRuntime.client, mention.id).catch(() => null)
        )
      )
    : [];
  const mentionOptions = mentionContacts
    .map((contact) => contact?.target)
    .filter((contact): contact is NonNullable<typeof contact> => Boolean(contact));
  const outgoingBody = normalizedMentions.reduce((body, mention) => {
    const labelPattern = new RegExp(`@${escapeRegExp(mention.label)}\\b`, "g");
    return body.replace(labelPattern, `@${mention.token}`);
  }, input.body);

  try {
    const normalizedButtons = (input.interactiveButtons ?? [])
      .map((entry) => entry.trim())
      .filter(Boolean)
      .slice(0, 3);
    const normalizedListOptions = (input.interactiveListOptions ?? [])
      .map((entry) => entry.trim())
      .filter(Boolean)
      .slice(0, 10);
    const normalizedListButtonText = input.interactiveListButtonText?.trim() || "Choose option";

    if (input.simulateTyping) {
      await simulateChatTyping(connectedRuntime.client, chatId, input);
    }

    if (normalizedButtons.length) {
      if (input.attachmentPath || input.attachmentUrl) {
        throw new Error("Button messages do not support attachments yet.");
      }

      const sentMessage = await connectedRuntime.client.sendMessage(
        chatId,
        buildPlainTextButtonsFallback(outgoingBody, normalizedButtons),
        {
          mentions: mentionOptions.length ? (mentionOptions as never) : undefined,
          quotedMessageId: input.quotedProviderMessageId ?? undefined
        }
      );

      recordSendDurationMetric({
        workspaceId: input.workspaceId,
        durationMs: Date.now() - startedAt,
        wasColdStart
      });
      return {
        providerMessageId: sentMessage.id._serialized,
        status: "accepted" as const
      };
    }

    if (normalizedListOptions.length) {
      if (input.attachmentPath || input.attachmentUrl) {
        throw new Error("List messages do not support attachments yet.");
      }

      const sentMessage = await connectedRuntime.client.sendMessage(
        chatId,
        buildPlainTextListFallback(outgoingBody, normalizedListButtonText, normalizedListOptions),
        {
          mentions: mentionOptions.length ? (mentionOptions as never) : undefined,
          quotedMessageId: input.quotedProviderMessageId ?? undefined
        }
      );

      recordSendDurationMetric({
        workspaceId: input.workspaceId,
        durationMs: Date.now() - startedAt,
        wasColdStart
      });
      return {
        providerMessageId: sentMessage.id._serialized,
        status: "accepted" as const
      };
    }

    if (input.attachmentPath || input.attachmentUrl) {
      const media = input.attachmentPath
        ? MessageMedia.fromFilePath(input.attachmentPath)
        : await MessageMedia.fromUrl(input.attachmentUrl!, {
            filename: input.attachmentName ?? undefined,
            unsafeMime: true
          });
      const sentMessage = await connectedRuntime.client.sendMessage(chatId, media, {
        caption: outgoingBody || undefined,
        mentions: mentionOptions.length ? (mentionOptions as never) : undefined,
        sendMediaAsDocument: !(input.attachmentMimeType ?? "").startsWith("image/"),
        quotedMessageId: input.quotedProviderMessageId ?? undefined
      });

      recordSendDurationMetric({
        workspaceId: input.workspaceId,
        durationMs: Date.now() - startedAt,
        wasColdStart
      });
      return {
        providerMessageId: sentMessage.id._serialized,
        status: "accepted" as const
      };
    }

    const sentMessage = await connectedRuntime.client.sendMessage(chatId, outgoingBody, {
      mentions: mentionOptions.length ? (mentionOptions as never) : undefined,
      quotedMessageId: input.quotedProviderMessageId ?? undefined
    });
    recordSendDurationMetric({
      workspaceId: input.workspaceId,
      durationMs: Date.now() - startedAt,
      wasColdStart
    });
    return {
      providerMessageId: sentMessage.id._serialized,
      status: "accepted" as const
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to send WhatsApp message.";

    if (message.includes("getChat")) {
      await teardownRuntimeState(input.workspaceId);
      throw new Error(
        "WhatsApp client runtime is stale. Disconnect, generate a new QR session, and try sending again."
      );
    }

    throw error;
  }
}

export function getWhatsAppSenderNodeMetrics() {
  return getWhatsAppSenderNodeMetricsSnapshot({
    activeRuntimes: Array.from(runtimeStates.values()).map((runtime) => ({
      workspaceId: runtime.workspaceId,
      sessionClientId: runtime.sessionClientId,
      connectionStatus: runtime.connectionStatus,
      isSyncingHistory: runtime.isSyncingHistory
    })),
    supervisorPausedCount: getRuntimeSupervisorPausedCount()
  });
}

export async function deleteWhatsAppWebMessageForEveryone(input: {
  workspaceId: string;
  providerMessageId: string;
}) {
  const runtime = await restoreWorkspaceWhatsAppClient(input.workspaceId);

  if (!runtime) {
    throw new Error("WhatsApp channel is not connected for this workspace.");
  }

  const connectedRuntime = await waitForConnectedRuntime(runtime);
  touchRuntimeActivity(connectedRuntime);

  try {
    const message = await connectedRuntime.client.getMessageById(input.providerMessageId);

    if (!message) {
      throw new Error("WhatsApp message was not found.");
    }

    await message.delete(true);
    return { status: "deleted" as const };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to delete WhatsApp message.";

    if (message.includes("Could not get the quoted message")) {
      throw new Error("WhatsApp could not resolve the target message.");
    }

    if (message.includes("was not found")) {
      throw error;
    }

    if (message.includes("can only revoke")) {
      throw new Error("WhatsApp can no longer delete this message for everyone.");
    }

    if (message.includes("getMessageById") || message.includes("getChat")) {
      await teardownRuntimeState(input.workspaceId);
      throw new Error(
        "WhatsApp client runtime is stale. Disconnect, generate a new QR session, and try again."
      );
    }

    throw error;
  }
}

async function simulateChatTyping(
  client: WhatsAppClient,
  chatId: string,
  input: {
    body: string;
    attachmentPath?: string | null;
    attachmentUrl?: string | null;
    interactiveButtons?: string[] | null;
    interactiveListOptions?: string[] | null;
  }
) {
  const chat = await client.getChatById(chatId).catch(() => null);
  if (!chat) {
    return;
  }

  try {
    await chat.sendStateTyping();
    await sleep(getTypingDurationMs(input));
  } finally {
    await chat.clearState().catch(() => null);
  }
}

function getTypingDurationMs(input: {
  body: string;
  attachmentPath?: string | null;
  attachmentUrl?: string | null;
  interactiveButtons?: string[] | null;
  interactiveListOptions?: string[] | null;
}) {
  const bodyLength = input.body.trim().length;
  const optionCount = (input.interactiveButtons?.length ?? 0) + (input.interactiveListOptions?.length ?? 0);
  const attachmentBonus = input.attachmentPath || input.attachmentUrl ? 600 : 0;
  const baseReplyMs = bodyLength <= 20 ? 850 : 1000;
  const estimatedMs = baseReplyMs + bodyLength * 35 + optionCount * 250 + attachmentBonus;
  const jitterMs = getRandomTypingJitter();

  return Math.min(WHATSAPP_TYPING_MAX_MS, Math.max(WHATSAPP_TYPING_MIN_MS, estimatedMs + jitterMs));
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getRandomTypingJitter() {
  if (!WHATSAPP_TYPING_JITTER_MS) {
    return 0;
  }

  return Math.round((Math.random() * 2 - 1) * WHATSAPP_TYPING_JITTER_MS);
}

async function resolveWhatsAppChatId(input: {
  workspaceId: string;
  conversationId: string;
  to: string;
}) {
  const normalizedTargetPhone = normalizeChatPhone(input.to);
  const conversation = await prisma.conversation.findFirst({
    where: {
      id: input.conversationId,
      workspaceId: input.workspaceId
    },
    select: {
      id: true,
      whatsAppRemoteId: true,
      contact: {
        select: {
          phone: true
        }
      },
      messages: {
        where: {
          direction: MessageDirection.INBOUND
        },
        orderBy: {
          sentAt: "desc"
        },
        take: 5,
        select: {
          rawPayload: true
        }
      }
    }
  });

  if (conversation?.whatsAppRemoteId?.trim()) {
    const storedRemoteId = conversation.whatsAppRemoteId.trim();
    const storedRemotePhone = toStoredPhone(storedRemoteId);

    if (normalizedTargetPhone && storedRemoteId.endsWith("@lid")) {
      const directChatId = buildDirectChatId(normalizedTargetPhone);
      if (directChatId) {
        await prisma.conversation.update({
          where: {
            id: conversation.id
          },
          data: {
            whatsAppRemoteId: directChatId
          }
        });
        return directChatId;
      }
    }

    if (!storedRemotePhone || !normalizedTargetPhone || storedRemotePhone === normalizedTargetPhone) {
      return storedRemoteId;
    }

    const directChatId = buildDirectChatId(normalizedTargetPhone);
    if (directChatId) {
      await prisma.conversation.update({
        where: {
          id: conversation.id
        },
        data: {
          whatsAppRemoteId: directChatId
        }
      });
      return directChatId;
    }
  }

  if (!conversation) {
    return buildDirectChatId(input.to) ?? `${input.to.replace(/\D/g, "")}@c.us`;
  }

  for (const message of conversation.messages) {
    const remoteId = extractWhatsAppRemoteIdFromStoredPayload(message.rawPayload);
    if (!remoteId) {
      continue;
    }

    const messageRemotePhone = toStoredPhone(remoteId);
    if (messageRemotePhone && normalizedTargetPhone && messageRemotePhone !== normalizedTargetPhone) {
      continue;
    }

    await prisma.conversation.update({
      where: {
        id: conversation.id
      },
      data: {
        whatsAppRemoteId: remoteId
      }
    });
    return remoteId;
  }

  return buildDirectChatId(conversation.contact.phone || input.to) ?? `${input.to.replace(/\D/g, "")}@c.us`;
}

function extractWhatsAppRemoteIdFromStoredPayload(rawPayload: string | null) {
  if (!rawPayload) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawPayload) as Record<string, unknown>;
    const candidates = [
      parsed.chatId,
      parsed.remote,
      parsed.from,
      parsed.author,
      parsed.id && typeof parsed.id === "object" ? (parsed.id as Record<string, unknown>).remote : null,
      parsed.id && typeof parsed.id === "object" ? (parsed.id as Record<string, unknown>)._serialized : null
    ];
    const resolvedCandidates: string[] = [];

    for (const candidate of candidates) {
      if (typeof candidate !== "string") {
        continue;
      }

      const trimmed = candidate.trim();
      if (/@(?:lid|c\.us|g\.us)$/.test(trimmed)) {
        resolvedCandidates.push(trimmed);
        continue;
      }

      const serializedMatch = trimmed.match(/^false_(.+@(?:lid|c\.us|g\.us))_/);
      if (serializedMatch) {
        resolvedCandidates.push(serializedMatch[1]);
      }
    }

    const preferredGroupCandidate = resolvedCandidates.find((candidate) => candidate.endsWith("@g.us"));
    if (preferredGroupCandidate) {
      return preferredGroupCandidate;
    }

    if (resolvedCandidates.length > 0) {
      return resolvedCandidates[0];
    }

    return null;
  } catch {
    return null;
  }
}

export async function syncWorkspaceHistory(
  workspaceId: string,
  options: { triggeredBy?: "manual" | "background" } = {}
) {
  const runtime = await restoreWorkspaceWhatsAppClient(workspaceId);

  if (!runtime) {
    throw new Error("WhatsApp channel is not connected for this workspace.");
  }

  if (!runtime.client) {
    await teardownRuntimeState(workspaceId);
    throw new Error("WhatsApp client runtime is stale. Restart the QR session and try syncing again.");
  }

  const connectedRuntime = await waitForConnectedRuntime(runtime);
  touchRuntimeActivity(connectedRuntime);

  if (runtime.isSyncingHistory) {
    return { importedChats: 0, importedMessages: 0 };
  }

  clearBackgroundSyncTimer(runtime);
  clearIdleEvictionTimer(runtime);
  runtime.isSyncingHistory = true;
  runtime.connectionStatus = "SYNCING_HISTORY";
  if (!runtime.hasCompletedInitialSync && runtime.historySyncStartedAt === null) {
    runtime.historySyncStartedAt = Date.now();
  }
  let syncCompleted = false;
  let shouldRetryInBackground = false;
  let transientSkippedChats = 0;
  let nextRetryDelayMs: number | null = null;

  try {
    const chats = await retryWhatsAppOperation(() => connectedRuntime.client.getChats()).catch(async (error: unknown) => {
      const message = error instanceof Error ? error.message : "Unable to load WhatsApp chats.";

      if (isTransientWhatsAppSyncError(error)) {
        throw new Error(getTransientSyncMessage());
      }

      if (message.includes("getChats")) {
        await teardownRuntimeState(workspaceId);
        throw new Error(
          "WhatsApp client runtime is stale. Disconnect, generate a new QR session, and try syncing again."
        );
      }

      throw error;
    });
    const importableChats = chats
      .filter((chat) => canImportChat(chat))
      .sort((left, right) => getChatSortTimestamp(right) - getChatSortTimestamp(left));
    const batchSize = runtime.hasCompletedInitialSync
      ? WHATSAPP_BACKGROUND_SYNC_CHAT_BATCH
      : WHATSAPP_INITIAL_SYNC_CHAT_BATCH;
    const batchStart = Math.min(runtime.historySyncCursor, importableChats.length);
    const existingDeferredChatIds = new Set(runtime.deferredHistoryChatIds);
    const deferredChats = importableChats.filter((chat) => {
      const chatId = getChatIdentifier(chat);
      return Boolean(chatId && existingDeferredChatIds.has(chatId));
    });
    const isDeferredBatch = batchStart >= importableChats.length && deferredChats.length > 0;
    const chatsToSync = isDeferredBatch
      ? deferredChats.slice(0, batchSize)
      : importableChats.slice(batchStart, batchStart + batchSize);
    let importedChats = 0;
    let importedMessages = 0;
    const resolvedChatIds = new Set<string>();
    const deferredChatIds = new Set(existingDeferredChatIds);
    const deferredCountBeforeBatch = deferredChatIds.size;

    for (const chat of chatsToSync) {
      const chatId = getChatIdentifier(chat);
      const fallbackPayload = buildFallbackSyncPayload(chat);

      try {
        const [messages, contact] = await Promise.all([
          fetchChatMessagesWithRecovery({
            client: connectedRuntime.client,
            chat,
            limit: Math.max(WHATSAPP_HISTORY_SYNC_LIMIT, (chat.unreadCount ?? 0) + 20)
          }),
          retryWhatsAppOperation(() => chat.getContact())
        ]);
        const contactSnapshot = serializeWhatsAppContactSnapshot(contact);
        const resolvedIdentity = await resolveIncomingContactIdentity({
          workspaceId,
          client: connectedRuntime.client,
          remoteId: chat.id._serialized,
          contact,
          chat
        });

        logProfilePhotoResult({
          source: "sync",
          displayName: resolvedIdentity.displayName,
          phone: resolvedIdentity.phone,
          photoUrl: resolvedIdentity.primaryPhotoUrl,
          fallbackPhotoUrl: resolvedIdentity.fallbackPhotoUrl,
          bridgePhotoUrl: resolvedIdentity.bridgePhotoUrl
        });

        if (!resolvedIdentity.phone) {
          continue;
        }

        const syncedMessages = await Promise.all(
          messages.map(async (message) => {
            if (isStatusLikeMessage(message)) {
              return null;
            }

            const mediaAttachment = await extractIncomingMediaAttachment({
              workspaceId,
              providerMessageId: message.id._serialized,
              message
            });

            const rawBody = message.body;
            const mentionMetadata = getMessageMentionMetadata(message);

            return {
              author: (message as Message & { author?: string | null }).author ?? null,
              chatId: chat.id._serialized,
              id: message.id._serialized,
              attachmentMimeType: mediaAttachment?.attachmentMimeType ?? null,
              attachmentName: mediaAttachment?.attachmentName ?? null,
              attachmentUrl: mediaAttachment?.attachmentUrl ?? null,
              body: rawBody,
              fromMe: message.fromMe,
              timestamp: message.timestamp,
              type: message.type,
              hasMedia: message.hasMedia,
              rawPayload: {
                author: (message as Message & { author?: string | null }).author ?? null,
                chatId: chat.id._serialized,
                from: message.from,
                to: message.to,
                type: message.type,
                body: rawBody,
                timestamp: message.timestamp,
                fromMe: message.fromMe,
                contact: contactSnapshot,
                ...mentionMetadata,
                hasMedia: message.hasMedia
              }
            };
          })
        );
        const resolvedSyncedMessages = syncedMessages.filter(
          (message): message is NonNullable<typeof message> => Boolean(message)
        );
        const normalizedMessages = await normalizeSyncedMessagesWithMentions({
          client: connectedRuntime.client,
          messages: resolvedSyncedMessages
        });

        const result = await syncWhatsAppHistoryConversation({
          workspaceId,
          phone: resolvedIdentity.phone,
          displayName: resolvedIdentity.displayName,
          photoUrl: resolvedIdentity.photoUrl,
          unreadCount: chat.unreadCount,
          messages: normalizedMessages
        });

        if (result.conversationId) {
          importedChats += 1;
          importedMessages += result.importedCount;
        }

        if (chatId) {
          resolvedChatIds.add(chatId);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown WhatsApp sync error.";

        if (isTransientWhatsAppSyncError(error)) {
          const fallbackContact = await retryWhatsAppOperation(() => chat.getContact(), 2).catch(() => null);
          const fallbackContactSnapshot = serializeWhatsAppContactSnapshot(fallbackContact);
          const fallbackIdentity = await resolveIncomingContactIdentity({
            workspaceId,
            client: connectedRuntime.client,
            remoteId: chat.id._serialized,
            contact: fallbackContact,
            chat
          }).catch(() => null);
          const resolvedFallbackPayload =
            buildResolvedFallbackSyncPayload({
              serializedId: chat.id?._serialized ?? null,
              fallbackNumber: fallbackContact?.number ?? null,
              displayName:
                fallbackContact?.name || fallbackContact?.pushname || chat.name || fallbackContact?.number || null,
              contact: fallbackContactSnapshot,
              unreadCount: chat.unreadCount,
              timestamp: chat.timestamp ?? null,
              lastMessage: chat.lastMessage ?? null
            }) ?? fallbackPayload;

          if (resolvedFallbackPayload) {
            try {
              const normalizedFallbackMessages = await normalizeSyncedMessagesWithMentions({
                client: connectedRuntime.client,
                messages: resolvedFallbackPayload.messages
              });
              const fallbackResult = await syncWhatsAppHistoryConversation({
                workspaceId,
                phone: resolvedFallbackPayload.phone,
                displayName: resolvedFallbackPayload.displayName,
                photoUrl: fallbackIdentity?.photoUrl ?? undefined,
                unreadCount: resolvedFallbackPayload.unreadCount,
                messages: normalizedFallbackMessages
              });

              if (fallbackResult.conversationId) {
                importedChats += 1;
                importedMessages += fallbackResult.importedCount;
              }

              if (chatId) {
                deferredChatIds.add(chatId);
              }

              console.warn(
                `[whatsapp-web][sync] imported fallback snapshot for chat ${chat.id._serialized} after transient load failure; keeping chat deferred for a full retry: ${message}`
              );
              continue;
            } catch (fallbackError) {
              console.warn(
                `[whatsapp-web][sync] fallback snapshot import failed for chat ${chat.id._serialized}: ${
                  fallbackError instanceof Error ? fallbackError.message : "Unknown fallback import error."
                }`
              );
            }
          }

          transientSkippedChats += 1;
          if (chatId) {
            deferredChatIds.add(chatId);
          }
          console.warn(
            `[whatsapp-web][sync] skipped chat ${chat.id._serialized} because WhatsApp Web reset while loading chat data: ${message}`
          );
          continue;
        }

        throw error;
      }
    }

    for (const resolvedChatId of resolvedChatIds) {
      deferredChatIds.delete(resolvedChatId);
    }

    runtime.deferredHistoryChatIds = [...deferredChatIds];
    const nextCursor = isDeferredBatch
      ? importableChats.length
      : Math.min(batchStart + chatsToSync.length, importableChats.length);

    if (runtime.hasCompletedInitialSync) {
      runtime.historySyncCursor = nextCursor < importableChats.length ? nextCursor : 0;
    } else {
      runtime.historySyncCursor = nextCursor;
    }

    const hasMorePrimaryChats = runtime.hasCompletedInitialSync
      ? nextCursor < importableChats.length
      : runtime.historySyncCursor < importableChats.length;
    const hasDeferredChats = runtime.deferredHistoryChatIds.length > 0;
    const hasMoreChatsToSync = hasMorePrimaryChats || hasDeferredChats;
    const progressedPrimaryCursor = !isDeferredBatch && nextCursor > batchStart;
    const clearedDeferredChats = runtime.deferredHistoryChatIds.length < deferredCountBeforeBatch;
    const madeProgress =
      importedChats > 0 || importedMessages > 0 || progressedPrimaryCursor || clearedDeferredChats;

    if (!hasMoreChatsToSync) {
      syncCompleted = true;
      return {
        importedChats,
        importedMessages
      };
    }

    if (madeProgress) {
      runtime.connectionStatus = runtime.hasCompletedInitialSync ? "READY" : "CONNECTED";
      runtime.lastError = null;
      nextRetryDelayMs = WHATSAPP_HISTORY_RETRY_BASE_MS;
      shouldRetryInBackground = true;
      return {
        importedChats,
        importedMessages
      };
    }

    if (transientSkippedChats > 0 && !runtime.hasCompletedInitialSync) {
      const elapsedMs =
        runtime.historySyncStartedAt === null ? 0 : Date.now() - runtime.historySyncStartedAt;
      nextRetryDelayMs =
        elapsedMs >= WHATSAPP_HISTORY_STUCK_MS
          ? deferHistoryImport(runtime)
          : getNextHistoryRetryDelay(runtime);
      if (elapsedMs < WHATSAPP_HISTORY_STUCK_MS) {
        runtime.connectionStatus = "CONNECTED";
        runtime.lastError = null;
      }
      shouldRetryInBackground = true;
      return {
        importedChats,
        importedMessages
      };
    }

    syncCompleted = true;
    return {
      importedChats,
      importedMessages
    };
  } catch (error) {
    if (isTransientWhatsAppSyncError(error)) {
      if (options.triggeredBy === "background") {
        const elapsedMs =
          runtime.historySyncStartedAt === null ? 0 : Date.now() - runtime.historySyncStartedAt;
        if (!runtime.hasCompletedInitialSync && elapsedMs >= WHATSAPP_HISTORY_STUCK_MS) {
          nextRetryDelayMs = deferHistoryImport(runtime);
        } else {
          runtime.connectionStatus = runtime.hasCompletedInitialSync ? "READY" : "CONNECTED";
          runtime.lastError = null;
          nextRetryDelayMs = getNextHistoryRetryDelay(runtime);
        }
        shouldRetryInBackground = true;
        return { importedChats: 0, importedMessages: 0 };
      }

      throw new Error("WhatsApp is still preparing chat history. Please try again in a moment.");
    }

    if (options.triggeredBy === "background" && isTransientExecutionContextError(error)) {
      runtime.connectionStatus = "CONNECTED";
      nextRetryDelayMs = getNextHistoryRetryDelay(runtime);
      shouldRetryInBackground = true;
      return { importedChats: 0, importedMessages: 0 };
    }

    throw error;
  } finally {
    runtime.isSyncingHistory = false;
    if (syncCompleted) {
      runtime.connectionStatus = "READY";
      runtime.hasCompletedInitialSync = true;
      runtime.lastError = null;
      resetHistoryRetryState(runtime);
      await saveWorkspaceWhatsAppChannelConnection({
        workspaceId: runtime.workspaceId,
        agentId: runtime.agentId,
        sessionClientId: runtime.sessionClientId,
        connectionStatus: "READY",
        lastError: null
      }).catch(() => null);
    }

    if (!syncCompleted) {
      await saveWorkspaceWhatsAppChannelConnection({
        workspaceId: runtime.workspaceId,
        agentId: runtime.agentId,
        sessionClientId: runtime.sessionClientId,
        connectionStatus: runtime.connectionStatus,
        lastError: runtime.lastError
      }).catch(() => null);
    }

    if (shouldRetryInBackground) {
      scheduleBackgroundSync(runtime, nextRetryDelayMs ?? runtime.historyRetryDelayMs);
    }

    touchRuntimeActivity(runtime);
  }
}

export async function resolveWhatsAppContacts(input: {
  workspaceId: string;
  mentionIds: string[];
}) {
  const runtime = await restoreWorkspaceWhatsAppClient(input.workspaceId);

  if (!runtime) {
    return [] as Array<{
      id: string;
      phone: string | null;
      name: string | null;
      pushname: string | null;
    }>;
  }

  const connectedRuntime = await waitForConnectedRuntime(runtime);
  touchRuntimeActivity(connectedRuntime);
  const mentionIds = Array.from(new Set(input.mentionIds.map((value) => value.trim()).filter(Boolean)));
  const contacts = await Promise.all(
    mentionIds.map(async (mentionId) => {
      const resolved = await resolveMentionContact(connectedRuntime.client, mentionId);

      return {
        id: mentionId,
        phone: resolved.phone,
        name: resolved.name || resolved.pushname,
        pushname: resolved.pushname
      };
    })
  );

  return contacts;
}

export async function listWhatsAppMentionCandidates(input: {
  workspaceId: string;
  conversationId: string;
  query?: string | null;
}) {
  const runtime = await restoreWorkspaceWhatsAppClient(input.workspaceId);

  if (!runtime) {
    return [] as Array<{
      id: string;
      label: string;
      token: string;
      phone: string | null;
      name: string | null;
      pushname: string | null;
    }>;
  }

  const connectedRuntime = await waitForConnectedRuntime(runtime);
  touchRuntimeActivity(connectedRuntime);
  const conversation = await prisma.conversation.findFirst({
    where: {
      id: input.conversationId,
      workspaceId: input.workspaceId
    },
    select: {
      id: true,
      contact: {
        select: {
          phone: true
        }
      }
    }
  });

  if (!conversation) {
    return [];
  }

  const chatId = await resolveWhatsAppChatId({
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
    to: conversation.contact.phone
  }).catch(() => null);

  if (!chatId || !chatId.endsWith("@g.us")) {
    return [];
  }

  const chat = (await connectedRuntime.client.getChatById(chatId).catch(() => null)) as
    | {
        participants?: Array<{
          id?: {
            _serialized?: string | null;
          } | null;
        }>;
      }
    | null;

  const participantIds = Array.from(
    new Set(
      (chat?.participants ?? [])
        .map((participant) => participant.id?._serialized?.trim() ?? "")
        .filter(Boolean)
    )
  );
  const fallbackMessageRows = participantIds.length
    ? []
    : await prisma.message.findMany({
        where: {
          conversationId: input.conversationId
        },
        orderBy: {
          sentAt: "desc"
        },
        take: 40,
        select: {
          rawPayload: true
        }
      });
  const fallbackEnvelopeRows = participantIds.length
    ? []
    : await prisma.whatsAppMessageEnvelope.findMany({
        where: {
          workspaceId: input.workspaceId,
          conversationId: input.conversationId
        },
        orderBy: {
          messageTimestamp: "desc"
        },
        take: 40,
        select: {
          from: true,
          author: true,
          contactId: true,
          rawJson: true,
          mentionedIdsJson: true,
          groupMentionsJson: true
        }
      });
  const fallbackParticipantIds = participantIds.length
    ? []
    : Array.from(
        new Set(
          [
            ...fallbackMessageRows.flatMap((message) => collectMentionIdsFromRecord(parseJsonRecord(message.rawPayload))),
            ...fallbackEnvelopeRows.flatMap((envelope) =>
              collectMentionIdsFromRecord({
                from: envelope.from,
                author: envelope.author,
                contactId: envelope.contactId,
                mentionedIds: envelope.mentionedIdsJson,
                groupMentions: envelope.groupMentionsJson,
                ...(asPlainRecord(envelope.rawJson) ?? {})
              })
            )
          ]
            .map((value) => value.trim())
            .filter((value) => value.includes("@"))
        )
      );
  const storedMentionCandidates = participantIds.length
    ? []
    : Array.from(
        new Map(
          fallbackMessageRows
            .flatMap((message) => collectStoredMentionCandidates(parseJsonRecord(message.rawPayload)))
            .map((candidate) => [candidate.id, candidate])
        ).values()
      );
  const resolvedParticipantIds = participantIds.length ? participantIds : fallbackParticipantIds;

  const resolvedParticipants = await Promise.all(
    resolvedParticipantIds.map((mentionId) => resolveMentionContact(connectedRuntime.client, mentionId))
  );
  const query = input.query?.trim().toLowerCase() ?? "";

  return Array.from(
    new Map(
      [
        ...storedMentionCandidates,
        ...resolvedParticipants.map((contact) => {
          const label = contact.name?.trim() || contact.pushname?.trim() || contact.phone?.trim() || null;
          const token = formatMentionToken(contact);

          if (!label || !token) {
            return null;
          }

          return {
            id: contact.id,
            label,
            token,
            phone: contact.phone,
            name: contact.name,
            pushname: contact.pushname
          };
        })
      ]
        .filter((contact): contact is NonNullable<typeof contact> => Boolean(contact))
        .filter((contact) => {
          if (!query) {
            return true;
          }

          return [contact.label, contact.phone ?? "", contact.name ?? "", contact.pushname ?? "", contact.token]
            .join(" ")
            .toLowerCase()
            .includes(query);
        })
        .sort((left, right) => left.label.localeCompare(right.label))
        .map((candidate) => [candidate.id, candidate])
    ).values()
  );
}

async function resolveMentionContactViaBrowser(client: WhatsAppClient, mentionId: string) {
  const pupPage = (client as WhatsAppClient & {
    pupPage?: { evaluate: <T, A>(fn: (arg: A) => Promise<T>, arg: A) => Promise<T> };
  }).pupPage;

  if (!pupPage?.evaluate) {
    return null;
  }

  try {
    return await pupPage.evaluate(async (rawMentionId) => {
      try {
        const runtimeWindow = window as typeof window & {
          Store?: {
            LidUtils?: {
              getPhoneNumber?: (
                wid: { _serialized?: string | null; server?: string | null }
              ) => string | { _serialized?: string | null } | null;
            };
            WidFactory?: {
              createWid?: (value: string) => { _serialized?: string | null; server?: string | null } | null;
            };
          };
          WWebJS?: {
            getContact?: (value: string | null) => Promise<{
              id?: { _serialized?: string | null } | null;
              number?: string | null;
              userid?: string | null;
              name?: string | null;
              pushname?: string | null;
            } | null>;
          };
        };
        const createWid = (value: string) => runtimeWindow.Store?.WidFactory?.createWid?.(value) ?? null;
        const normalizePhoneWid = (value: string | null) => {
          const normalized = value?.trim() ?? "";
          if (!normalized) {
            return null;
          }

          if (normalized.includes("@")) {
            return normalized;
          }

          const digits = normalized.replace(/[^\d]/g, "");
          return digits ? `${digits}@c.us` : null;
        };
        const serializeContact = async (value: string | { _serialized?: string | null } | null) => {
          if (!value || !runtimeWindow.WWebJS?.getContact) {
            return null;
          }

          const contact = await runtimeWindow.WWebJS.getContact(
            typeof value === "string" ? value : value?._serialized ?? null
          ).catch(() => null);

          if (!contact) {
            return null;
          }

          return {
            resolvedId: contact.id?._serialized ?? null,
            phone:
              contact.number?.trim?.() ||
              (typeof contact.userid === "string" ? contact.userid.trim() : null) ||
              null,
            name: contact.name?.trim?.() || null,
            pushname: contact.pushname?.trim?.() || null
          };
        };

        const initialWid = createWid(rawMentionId);
        const rawPhoneWid =
          initialWid?.server === "lid" && runtimeWindow.Store?.LidUtils?.getPhoneNumber
            ? runtimeWindow.Store.LidUtils.getPhoneNumber(initialWid)
            : null;
        const normalizedPhoneWid =
          typeof rawPhoneWid === "string" ? normalizePhoneWid(rawPhoneWid) : rawPhoneWid?._serialized ?? null;
        const directPhone =
          typeof rawPhoneWid === "string" ? rawPhoneWid.replace(/[^\d]/g, "") || null : null;
        const primaryContact = await serializeContact(rawMentionId);
        const normalizedPhoneContact = normalizedPhoneWid
          ? await serializeContact(normalizedPhoneWid)
          : null;

        return primaryContact ||
          normalizedPhoneContact || {
            resolvedId: normalizedPhoneWid,
            phone: directPhone,
            name: null,
            pushname: null
          };
      } catch {
        return null;
      }
    }, mentionId);
  } catch {
    return null;
  }
}
