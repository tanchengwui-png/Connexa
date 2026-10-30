import { accessSync, constants } from "fs";
import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import { spawn } from "child_process";
import { performance } from "node:perf_hooks";
import path from "path";
import { tmpdir } from "os";
import { normalizeStoredPhone } from "@/lib/phone";
import { MediaAssetSource, MessageDirection, OutboundMessageJobStatus } from "@/lib/db-types";
import { registerStoredWorkspaceMediaAsset } from "@/lib/media-library";
import QRCode from "qrcode";
import whatsappWebJs from "whatsapp-web.js";
import type { Chat, Client as WhatsAppClient, Message, Reaction } from "whatsapp-web.js";
import { prisma } from "@/lib/prisma";
import {
  getWhatsAppChannelStatusById,
  deleteWhatsAppSession,
  isWhatsAppChannelIncognitoModeEnabled,
  markWhatsAppChannelDisconnected,
  getWorkspaceWhatsAppChannels,
  getWorkspaceWhatsAppChannelStatus,
  saveWhatsAppChannelConnection,
  saveWhatsAppChannelConnectionIfSessionCurrent,
  saveWorkspaceWhatsAppChannelConnection,
  type WorkspaceWhatsAppChannelStatus
} from "@/lib/whatsapp-channel";
import {
  captureWhatsAppMessageEnvelope,
  captureWhatsAppReactionEnvelope,
  downloadWhatsAppMediaWithRetry,
  persistIncomingMedia
} from "@/lib/whatsapp-message-envelope";
import { persistWhatsAppMessageAck } from "@/lib/whatsapp-ack";
import { logWhatsAppRuntimeEvent, WHATSAPP_RUNTIME_EVENT_TYPES } from "@/lib/whatsapp-runtime-events";
import {
  clearRuntimeSupervisorState,
  getRuntimeSupervisorPausedCount,
  getRuntimeSupervisorStatus,
  recordRuntimeAuthFailure,
  recordRuntimeDisconnected,
  recordRuntimeInterventionRequired,
  recordRuntimeReady,
} from "@/lib/whatsapp-runtime-supervisor";
import {
  getWhatsAppSenderNodeMetricsSnapshot,
  recordRuntimeReadyMetric,
  recordRuntimeStartMetric,
  recordRuntimeStatusMetric,
  recordSendDurationMetric
} from "@/lib/whatsapp-runtime-metrics";
import { ingestWhatsAppClientMessage, syncWhatsAppHistoryConversation } from "@/lib/whatsapp";
import { getWhatsAppProfilePictureUrl } from "@/lib/whatsapp-profile-picture";
import { normalizeWhatsAppPushName } from "@/lib/whatsapp-push-name";
import {
  formatWhatsAppParticipantLabel,
  readWhatsAppGroupNotificationMetadata,
  type WhatsAppGroupNotificationMetadata
} from "@/lib/whatsapp-group-notification";
import { dispatchInboxWebPushForHistoricalUnreadSummary } from "@/lib/inbox-web-push";
import { emitWhatsAppConnectionToInbox } from "@/lib/inbox-realtime";
import { clearStaleChromiumProfileLocks } from "@/lib/chromium-profile-lock";
import {
  createRuntimeGeneration,
  hasRecentLifecycleProgress,
  invalidateRuntimeGeneration,
  isCurrentRuntimeGeneration,
  runSerializedChannelLifecycle
} from "@/lib/whatsapp-runtime-lifecycle";
import { getWhatsAppQrMaxAgeMs, resolveWhatsAppQrPresentation } from "@/lib/whatsapp-qr-state";
import { classifyWhatsAppAuthenticationFailure } from "@/lib/whatsapp-auth-failure";
import {
  classifyNotificationEligibility,
  reservePersonalWhatsAppNotification,
  type PersonalWhatsAppNotificationState
} from "@/lib/personal-whatsapp-notifications";
import {
  acquireWhatsAppHistoryLease,
  createWhatsAppChatSignature,
  finishWhatsAppHistorySyncState,
  getWhatsAppDeepAuditMs,
  getWhatsAppIncrementalSyncMode,
  getWhatsAppRoutineReconciliationMs,
  isStoredHistoryMediaComplete,
  loadStoredHistoryMessages,
  loadWhatsAppHistoryCheckpoints,
  readWhatsAppHistorySyncState,
  recordWhatsAppHistoryCheckpointFailure,
  recordWhatsAppHistoryCheckpointSuccess,
  releaseWhatsAppHistoryLease,
  renewWhatsAppHistoryLease,
  shouldReconcileWhatsAppChat,
  startWhatsAppHistorySyncState,
  type WhatsAppHistorySyncPhase,
  updateWhatsAppHistorySyncProgress
} from "@/lib/whatsapp-history-sync-state";
import {
  getWhatsAppHistoryResourceSnapshot,
  runWithWhatsAppHistoryBudget
} from "@/lib/whatsapp-history-resource-control";
import {
  classifyWhatsAppWebState,
  isWhatsAppRuntimeRecoveryCurrent,
  listDesiredWhatsAppRuntimeChannels,
  markWhatsAppRuntimeHealthy,
  markWhatsAppRuntimeRecovering,
  markWhatsAppRuntimeReauthRequired,
  recordWhatsAppRuntimeHealthFailure,
  resolveWhatsAppUserConnectionState,
  scheduleWhatsAppRuntimeRecovery,
  setWhatsAppRuntimeDesiredState
} from "@/lib/whatsapp-runtime-reliability";

const { Client, LocalAuth, MessageMedia } = whatsappWebJs;
const WhatsAppMessage = (
  whatsappWebJs as typeof whatsappWebJs & {
    Message: new (client: WhatsAppClient, data: unknown) => Message;
  }
).Message;

type RuntimeState = {
  client: WhatsAppClient;
  generationId: string;
  agentId: string;
  workspaceId: string;
  channelId: string;
  sessionClientId: string;
  restoredFromSession: boolean;
  wasPreviouslyConnected: boolean;
  initializing: Promise<void> | null;
  qrCodeDataUrl: string | null;
  qrCodeGeneratedAt: number | null;
  qrVersion: number;
  connectionEventSequence: number;
  connectionUpdatedAt: string;
  lastQrEventPersistedAt: number | null;
  connectionStatus: string;
  lastError: string | null;
  isSyncingHistory: boolean;
  hasCompletedInitialSync: boolean;
  historySyncFullyCaughtUp: boolean;
  historySyncCompletedAt: number | null;
  historySyncCursor: number;
  historySyncTotal: number | null;
  historySyncProgressAt: number | null;
  historyChatWorklist: Chat[];
  historyChatWorklistBuiltAt: number | null;
  historyPairingPriorityDeferredAt: number | null;
  historyAttemptedUnseenChatIds: Set<string>;
  historyTimedOutChatIds: Set<string>;
  deferredHistoryChatIds: string[];
  historySyncStartedAt: number | null;
  historyRetryDelayMs: number;
  browserStoreHydrationFailures: number;
  backgroundSyncTimer: NodeJS.Timeout | null;
  historyRecoveryTimer: NodeJS.Timeout | null;
  historySyncWatchdogTimer: NodeJS.Timeout | null;
  historySyncAttemptId: number;
  historyOperationFence: number;
  statusUpdatedAt: number;
  stallRecoveryTimer: NodeJS.Timeout | null;
  idleEvictionTimer: NodeJS.Timeout | null;
  lastActivityAt: number;
  lifecycleProgressAt: number;
  loadingPercent: number | null;
  notificationState: PersonalWhatsAppNotificationState;
  startupStartedAt: number;
  startupMonotonicAt: number;
  pairingRequestedMonotonicAt: number;
  authenticatedAt: number | null;
  authenticatedMonotonicAt: number | null;
  authenticatedCpuUsage: { user: number; system: number } | null;
  authenticatedResourceUsage: { majorPageFault: number; minorPageFault: number; maxRSS: number } | null;
  authenticatedEventLoopUtilization: { idle: number; active: number; utilization: number } | null;
  wwebjsInjectedMonotonicAt: number | null;
  clientInfoMonotonicAt: number | null;
  postAuthenticationProfileTimer: NodeJS.Timeout | null;
  initializationStages: Record<string, { at: string; elapsedMs: number | null; stageDurationMs: number | null }>;
  bootstrapProfileId: string | null;
  bootstrapStages: Record<
    string,
    {
      at: string;
      elapsedMs: number | null;
      stageDurationMs: number | null;
      metadata?: Record<string, boolean | string | null>;
    }
  >;
  bootstrapPerformance: Record<string, { at: string; elapsedMs: number | null; snapshot: Record<string, unknown> }>;
  authenticationStages: Record<string, { at: string; elapsedMs: number | null }>;
  reconciliationStartedAt: number | null;
  liveWatermarkAt: number | null;
  pendingHistoricalUnreadChats: Map<string, { conversationId: string; unreadCount: number; latestIncomingMessageId: string | null }>;
};

declare global {
  // eslint-disable-next-line no-var
  var whatsAppRuntimeStates: Map<string, RuntimeState> | undefined;
  // eslint-disable-next-line no-var
  var whatsAppRuntimeCreations: Map<string, { generationId: string; promise: Promise<RuntimeState | null> }> | undefined;
  // eslint-disable-next-line no-var
  var whatsAppRuntimeBoundClients: WeakSet<WhatsAppClient> | undefined;
  // eslint-disable-next-line no-var
  var whatsAppRuntimeRecoveryTimers: Map<string, { token: string; timer: NodeJS.Timeout }> | undefined;
  // eslint-disable-next-line no-var
  var whatsAppRuntimeHealthProbes: Map<string, Promise<boolean>> | undefined;
  // eslint-disable-next-line no-var
  var whatsAppIncrementalFallbackChannels: Set<string> | undefined;
}

const runtimeStates = global.whatsAppRuntimeStates ?? new Map<string, RuntimeState>();
const runtimeCreations =
  global.whatsAppRuntimeCreations ??
  new Map<string, { generationId: string; promise: Promise<RuntimeState | null> }>();
const runtimeBoundClients = global.whatsAppRuntimeBoundClients ?? new WeakSet<WhatsAppClient>();
const runtimeRecoveryTimers =
  global.whatsAppRuntimeRecoveryTimers ??
  new Map<string, { token: string; timer: NodeJS.Timeout }>();
const runtimeHealthProbes = global.whatsAppRuntimeHealthProbes ?? new Map<string, Promise<boolean>>();
const incrementalFallbackChannels = global.whatsAppIncrementalFallbackChannels ?? new Set<string>();
global.whatsAppIncrementalFallbackChannels = incrementalFallbackChannels;
let healthWatchdogRunning = false;
let healthWatchdogLastStartedAt: Date | null = null;
let healthWatchdogLastCompletedAt: Date | null = null;
let healthWatchdogLastError: string | null = null;
const profilePhotoCache = new Map<string, { expiresAt: number; photoUrl: string | null }>();
const historyStallRecoveryAttempts = new Map<string, number>();
const PROFILE_PHOTO_CACHE_TTL_MS = Math.max(
  60_000,
  Number.parseInt(process.env.WHATSAPP_PROFILE_PHOTO_CACHE_TTL_MS ?? "300000", 10) || 300_000
);
// WhatsApp can temporarily withhold a profile picture while its Web session is
// still loading. Do not treat that as a durable result: retry it on the next
// sync instead of keeping the contact on initials for the full avatar TTL.
const PROFILE_PHOTO_MISS_CACHE_TTL_MS = Math.max(
  5_000,
  Number.parseInt(process.env.WHATSAPP_PROFILE_PHOTO_MISS_CACHE_TTL_MS ?? "30000", 10) || 30_000
);

const WHATSAPP_HISTORY_SYNC_LIMIT = Math.max(
  1,
  Number.parseInt(process.env.WHATSAPP_HISTORY_SYNC_LIMIT ?? "200", 10) || 200
);

const WHATSAPP_HISTORY_OPERATION_TIMEOUT_MS = Math.max(
  10_000,
  Number.parseInt(process.env.WHATSAPP_HISTORY_OPERATION_TIMEOUT_MS ?? "30000", 10) || 30_000
);

// A chat import can also spend time resolving profiles or downloading media.
// Keep one problematic chat from holding the entire history cursor indefinitely.
const WHATSAPP_HISTORY_CHAT_TIMEOUT_MS = Math.max(
  WHATSAPP_HISTORY_OPERATION_TIMEOUT_MS,
  Number.parseInt(process.env.WHATSAPP_HISTORY_CHAT_TIMEOUT_MS ?? "120000", 10) || 120_000
);

// A batch includes multiple chats and can legitimately take several minutes
// for large accounts. The per-chat timeout is the first line of defence; this
// watchdog is the final guarantee that no unexpected fallback or dependency
// can leave a runtime permanently locked in SYNCING_HISTORY.
const WHATSAPP_HISTORY_SYNC_WATCHDOG_MS = Math.max(
  WHATSAPP_HISTORY_CHAT_TIMEOUT_MS + 60_000,
  Number.parseInt(process.env.WHATSAPP_HISTORY_SYNC_WATCHDOG_MS ?? "1200000", 10) || 1_200_000
);

const WHATSAPP_CLIENT_TEARDOWN_TIMEOUT_MS = Math.max(
  5_000,
  Number.parseInt(process.env.WHATSAPP_CLIENT_TEARDOWN_TIMEOUT_MS ?? "15000", 10) || 15_000
);

const WHATSAPP_PROTOCOL_TIMEOUT_MS = Math.max(
  120000,
  Number.parseInt(process.env.WHATSAPP_PROTOCOL_TIMEOUT_MS ?? "240000", 10) || 240000
);

const WHATSAPP_BOOTSTRAP_CHAT_BATCH = Math.max(
  1,
  Number.parseInt(process.env.WHATSAPP_BOOTSTRAP_CHAT_BATCH ?? "5", 10) || 5
);

const WHATSAPP_BOOTSTRAP_MESSAGE_LIMIT = Math.max(
  1,
  Number.parseInt(process.env.WHATSAPP_BOOTSTRAP_MESSAGE_LIMIT ?? "20", 10) || 20
);

const WHATSAPP_BOOTSTRAP_START_DELAY_MS = Math.max(
  0,
  Number.parseInt(process.env.WHATSAPP_BOOTSTRAP_START_DELAY_MS ?? "0", 10) || 0
);

const WHATSAPP_HISTORY_CHAT_WORKLIST_TTL_MS = Math.max(
  5_000,
  Number.parseInt(process.env.WHATSAPP_HISTORY_CHAT_WORKLIST_TTL_MS ?? "60000", 10) || 60_000
);

const WHATSAPP_PAIRING_HISTORY_DEFERRAL_MS = Math.max(
  1_000,
  Number.parseInt(process.env.WHATSAPP_PAIRING_HISTORY_DEFERRAL_MS ?? "5000", 10) || 5_000
);

const WHATSAPP_PAIRING_HISTORY_MAX_DEFERRAL_MS = Math.max(
  WHATSAPP_PAIRING_HISTORY_DEFERRAL_MS,
  Number.parseInt(process.env.WHATSAPP_PAIRING_HISTORY_MAX_DEFERRAL_MS ?? "30000", 10) || 30_000
);

const WHATSAPP_HISTORY_WORK_UNIT_CHATS = Math.max(
  1,
  Number.parseInt(process.env.WHATSAPP_HISTORY_WORK_UNIT_CHATS ?? "5", 10) || 5
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

const WHATSAPP_INITIALIZE_TIMEOUT_MS = Math.max(
  WHATSAPP_CONNECTION_STALL_MS,
  Number.parseInt(process.env.WHATSAPP_INITIALIZE_TIMEOUT_MS ?? "180000", 10) || 180000
);

const WHATSAPP_RECONNECT_BASE_MS = Math.max(
  1_000,
  Number.parseInt(process.env.WHATSAPP_RECONNECT_BASE_MS ?? "5000", 10) || 5000
);

const WHATSAPP_RUNTIME_HEALTH_TIMEOUT_MS = Math.max(
  2_000,
  Number.parseInt(process.env.WHATSAPP_RUNTIME_HEALTH_TIMEOUT_MS ?? "10000", 10) || 10_000
);

const WHATSAPP_RUNTIME_HEALTH_FAILURE_THRESHOLD = Math.max(
  2,
  Number.parseInt(process.env.WHATSAPP_RUNTIME_HEALTH_FAILURE_THRESHOLD ?? "3", 10) || 3
);

const WHATSAPP_STALE_RUNTIME_MS = Math.max(
  WHATSAPP_CONNECTION_STALL_MS,
  Number.parseInt(process.env.WHATSAPP_STALE_RUNTIME_MS ?? "180000", 10) || 180000
);

const WHATSAPP_HISTORY_DEFERRED_RETRY_MS = Math.max(
  WHATSAPP_HISTORY_RETRY_MAX_MS,
  Number.parseInt(process.env.WHATSAPP_HISTORY_DEFERRED_RETRY_MS ?? "300000", 10) || 300000
);

// A READY client can retain its WebSocket while its browser-side Store has
// become unusable. Retrying history against that same page never recovers;
// recycle the saved session after a small bounded number of failures.
const WHATSAPP_BROWSER_STORE_RECOVERY_THRESHOLD = Math.max(
  2,
  Number.parseInt(process.env.WHATSAPP_BROWSER_STORE_RECOVERY_THRESHOLD ?? "3", 10) || 3
);
const WHATSAPP_BROWSER_STORE_HYDRATION_ERROR_PREFIX = "WHATSAPP_BROWSER_STORE_HYDRATION:";

const WHATSAPP_PERIODIC_SYNC_MS = Math.max(
  60_000,
  Number.parseInt(process.env.WHATSAPP_PERIODIC_SYNC_MS ?? "180000", 10) || 180000
);

const WHATSAPP_INCREMENTAL_OVERLAP_MESSAGES = Math.max(
  10,
  Number.parseInt(process.env.WHATSAPP_INCREMENTAL_OVERLAP_MESSAGES ?? "50", 10) || 50
);

const WHATSAPP_HISTORY_BATCH_WALL_MS = Math.max(
  WHATSAPP_HISTORY_CHAT_TIMEOUT_MS,
  Number.parseInt(process.env.WHATSAPP_HISTORY_BATCH_WALL_MS ?? "180000", 10) || 180_000
);

const WHATSAPP_HISTORY_LEASE_TTL_MS = Math.max(
  WHATSAPP_HISTORY_BATCH_WALL_MS + 60_000,
  Number.parseInt(process.env.WHATSAPP_HISTORY_LEASE_TTL_MS ?? "300000", 10) || 300_000
);

const WHATSAPP_HISTORY_SCHEDULE_JITTER_MS = Math.max(
  0,
  Number.parseInt(process.env.WHATSAPP_HISTORY_SCHEDULE_JITTER_MS ?? "30000", 10) || 30_000
);

function getRoutineHistoryDelayMs() {
  return (
    getWhatsAppRoutineReconciliationMs() +
    (WHATSAPP_HISTORY_SCHEDULE_JITTER_MS > 0
      ? Math.floor(Math.random() * WHATSAPP_HISTORY_SCHEDULE_JITTER_MS)
      : 0)
  );
}

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

const WHATSAPP_CHROMIUM_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-background-networking",
  "--disable-component-extensions-with-background-pages",
  "--disable-default-apps",
  "--disable-extensions",
  "--disable-sync",
  "--disable-breakpad",
  "--disable-crash-reporter",
  "--mute-audio",
  "--password-store=basic",
  "--use-mock-keychain"
];
const WHATSAPP_BROWSER_RETRY_DELAY_MS = 2_000;
const PHONE_PAIRING_CODE_BRIDGE_KEY = "__connexaPhonePairingCode";

if (!global.whatsAppRuntimeStates) {
  global.whatsAppRuntimeStates = runtimeStates;
}

if (!global.whatsAppRuntimeCreations) {
  global.whatsAppRuntimeCreations = runtimeCreations;
}

if (!global.whatsAppRuntimeBoundClients) {
  global.whatsAppRuntimeBoundClients = runtimeBoundClients;
}

if (!global.whatsAppRuntimeRecoveryTimers) {
  global.whatsAppRuntimeRecoveryTimers = runtimeRecoveryTimers;
}

if (!global.whatsAppRuntimeHealthProbes) {
  global.whatsAppRuntimeHealthProbes = runtimeHealthProbes;
}

function buildRuntimeKey(channelId: string) {
  return channelId;
}

function hasWarmRuntime(channelId: string) {
  const runtime = runtimeStates.get(buildRuntimeKey(channelId));
  return Boolean(runtime?.client);
}

function buildSessionClientId(workspaceId: string, channelId: string, agentId: string) {
  return `connexa-${workspaceId}-${channelId}-${agentId}`.replace(/[^a-zA-Z0-9-_]/g, "");
}

function createWhatsAppClient(sessionClientId: string) {
  const configuredUserAgent = process.env.WHATSAPP_WEB_USER_AGENT?.trim();
  const userAgent = configuredUserAgent?.toLowerCase() === "native"
    // whatsapp-web.js treats a falsy value as "do not override Chromium's UA",
    // although its public TypeScript declaration currently only permits strings.
    ? (false as unknown as string)
    : configuredUserAgent || undefined;
  return new Client({
    // Unlimited rotations are intentional. whatsapp-web.js 1.34.7 refreshes
    // UNPAIRED_IDLE itself; Connexa keeps the same client alive and publishes
    // each new QR instead of forcing users through a destructive fresh start.
    qrMaxRetries: 0,
    authStrategy: new LocalAuth({
      clientId: sessionClientId,
      dataPath: getAuthDataPath()
    }),
    ...(userAgent === undefined ? {} : { userAgent }),
    puppeteer: {
      headless: true,
      protocolTimeout: WHATSAPP_PROTOCOL_TIMEOUT_MS,
      executablePath: getBrowserExecutablePath(),
      args: WHATSAPP_CHROMIUM_ARGS
    }
  });
}

function clearPostAuthenticationProfileTimer(state: RuntimeState) {
  if (!state.postAuthenticationProfileTimer) return;
  clearTimeout(state.postAuthenticationProfileTimer);
  state.postAuthenticationProfileTimer = null;
}

function startPostAuthenticationStageProfiler(state: RuntimeState, boundClient: WhatsAppClient) {
  clearPostAuthenticationProfileTimer(state);

  const observe = async () => {
    state.postAuthenticationProfileTimer = null;
    if (
      !isActiveRuntimeState(state) ||
      state.client !== boundClient ||
      state.connectionStatus !== "AUTHENTICATED"
    ) {
      return;
    }

    const now = performance.now();
    if (!state.clientInfoMonotonicAt && state.client.info?.wid?._serialized) {
      state.clientInfoMonotonicAt = now;
      console.info(
        `[whatsapp-web][auth-profile] attempt=${state.generationId} stage=account-metadata elapsedMs=${Math.round(
          now - (state.authenticatedMonotonicAt ?? now)
        )}`
      );
    }

    if (!state.wwebjsInjectedMonotonicAt) {
      const page = (boundClient as WhatsAppClient & {
        pupPage?: {
          isClosed?: () => boolean;
          evaluate?: <T>(fn: () => T) => Promise<T>;
        };
      }).pupPage;
      if (page && !page.isClosed?.() && page.evaluate) {
        const hasHelpers = await page
          .evaluate(() => Boolean((window as Window & { WWebJS?: unknown }).WWebJS))
          .catch(() => false);
        if (hasHelpers && isActiveRuntimeState(state) && state.client === boundClient) {
          state.wwebjsInjectedMonotonicAt = performance.now();
          console.info(
            `[whatsapp-web][auth-profile] attempt=${state.generationId} stage=helpers-injected elapsedMs=${Math.round(
              state.wwebjsInjectedMonotonicAt - (state.authenticatedMonotonicAt ?? state.wwebjsInjectedMonotonicAt)
            )}`
          );
        }
      }
    }

    if (state.wwebjsInjectedMonotonicAt && state.clientInfoMonotonicAt) return;
    state.postAuthenticationProfileTimer = setTimeout(() => void observe(), 200);
  };

  void observe();
}

function logProfilePhotoResult(input: {
  source: "inbound" | "sync";
  displayName?: string | null;
  phone?: string | null;
  photoUrl?: string | null;
  fallbackPhotoUrl?: string | null;
  bridgePhotoUrl?: string | null;
}) {
  console.info(
    `[whatsapp-web][${input.source}] profile-photo resolved=${String(Boolean(input.photoUrl))} fallback=${String(Boolean(input.fallbackPhotoUrl))} bridge=${String(Boolean(input.bridgePhotoUrl))}`
  );
}

function resolveIncomingDisplayName(input: {
  notifyName?: string | null;
  pushname?: string | null;
  contactName?: string | null;
  chatName?: string | null;
  groupSubject?: string | null;
  groupContactName?: string | null;
  formattedTitle?: string | null;
  phone?: string | null;
  fallbackId?: string | null;
}) {
  const isGroup = input.fallbackId?.endsWith("@g.us") ?? false;
  const groupTitle = isGroup
    ? [input.groupSubject, input.formattedTitle, input.chatName, input.groupContactName].find((candidate) =>
        isUsableGroupTitle(candidate, input.fallbackId)
      )
    : null;

  if (isGroup) {
    // A numeric group id is never a useful Inbox title. Metadata can hydrate
    // after the first event, so use a neutral label until a real subject is
    // available instead of persisting the identifier.
    return groupTitle || "Group chat";
  }

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

function isUsableGroupTitle(value?: string | null, remoteId?: string | null) {
  const title = value?.trim();
  if (!title) {
    return false;
  }

  const groupId = remoteId?.replace(/@g\.us$/, "").trim();
  // WhatsApp Web occasionally exposes the group identifier in `name` before
  // group metadata has hydrated. It is an identifier, not a user-visible title.
  return title !== groupId && !/^\d{12,}$/.test(title);
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

        // The bridge expects WhatsApp Web's Chat model. Supplying a Wid here
        // makes the lookup fail silently for most contacts.
        const chat = await runtimeWindow.WWebJS?.getChat(id);
        if (!chat) return null;

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
    return null;
  }

  if (sourceUrl.startsWith("/")) {
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
      console.warn("[whatsapp-web][avatar-cache] unavailable");
      return null;
    }

    const extension = extensionFromContentType(contentType);
    const fileLabel = sanitizeProfilePhotoSegment(input.phone || input.remoteId || "unknown");
    const relativePath = `/uploads/whatsapp-profile/${sanitizeProfilePhotoSegment(input.workspaceId)}/${fileLabel}.${extension}`;
    const absolutePath = path.join(process.cwd(), "public", relativePath.replace(/^\//, ""));

    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, body);

    // Use the upload route rather than a runtime-created `public` path. This
    // remains available when Next middleware/static routing is active.
    return `/api${relativePath}`;
  } catch {
    console.warn("[whatsapp-web][avatar-cache] transient failure");
    return null;
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

  const downloadedMedia = await downloadWhatsAppMediaWithRetry(input.message);

  if (!downloadedMedia) {
    return null;
  }

  const storedMedia = await persistIncomingMedia({
    workspaceId: input.workspaceId,
    providerMessageId: input.providerMessageId,
    media: downloadedMedia
  }).catch(() => null);

  const mediaAsset =
    storedMedia && typeof downloadedMedia.filesize === "number" && downloadedMedia.filesize > 0
      ? await registerStoredWorkspaceMediaAsset({
          workspaceId: input.workspaceId,
          originalName: downloadedMedia.filename ?? input.providerMessageId,
          title: downloadedMedia.filename ?? input.providerMessageId,
          storagePath: storedMedia.storagePath,
          publicUrl: storedMedia.url,
          mimeType: downloadedMedia.mimetype ?? "application/octet-stream",
          sizeBytes: downloadedMedia.filesize,
          sourceModule: MediaAssetSource.WHATSAPP_INBOUND,
          skipStorageLimitCheck: true
        }).catch(() => null)
      : null;

  return {
    mediaAssetId: mediaAsset?.id ?? null,
    attachmentMimeType: downloadedMedia.mimetype ?? null,
    attachmentName: downloadedMedia.filename ?? null,
    attachmentUrl: storedMedia?.url ?? null,
    downloadedBytes:
      typeof downloadedMedia.filesize === "number" && downloadedMedia.filesize > 0
        ? downloadedMedia.filesize
        : Buffer.byteLength(downloadedMedia.data, "base64")
  };
}

function getAuthDataPath() {
  return path.join(process.cwd(), ".wwebjs_auth");
}

function getBrowserExecutablePath() {
  const configuredPaths = [
    process.env.WHATSAPP_WEB_EXECUTABLE_PATH?.trim(),
    process.env.PUPPETEER_EXECUTABLE_PATH?.trim()
  ].filter((value): value is string => Boolean(value));

  const candidates = [
    ...configuredPaths,
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome-stable",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
  ];

  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
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

function isChromiumLaunchError(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error ?? "").toLowerCase();

  return (
    message.includes("failed to launch the browser process") ||
    message.includes("failed to launch the browser") ||
    message.includes("error while launching the browser")
  );
}

function isTransientBrowserExecutableError(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error ?? "").toLowerCase();

  // Container startup can briefly race the browser package/filesystem mount.
  // Retry this without discarding the saved QR session instead of permanently
  // marking an otherwise valid Web channel as unsupported.
  return (
    message.includes("tried to find the browser at the configured path") ||
    message.includes("browser executable") ||
    message.includes("executable path")
  );
}

function createProfileLockInterventionError(sessionClientId: string, state: "active" | "unverifiable") {
  const reason =
    state === "active"
      ? "another Chromium process still owns the saved WhatsApp profile"
      : "the saved WhatsApp profile lock owner could not be verified";
  return new Error(
    `WHATSAPP_CHROMIUM_PROFILE_LOCK_REQUIRES_INTERVENTION: ${reason}. ` +
      `The LocalAuth session ${sessionClientId} was preserved.`
  );
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

async function resolveContactPhoneFromRemoteId(input: {
  client: WhatsAppClient;
  remoteId?: string | null;
  fallbackNumber?: string | null;
}) {
  const remoteId = input.remoteId?.trim() ?? "";

  if (remoteId.endsWith("@lid")) {
    const resolved = await resolveMentionContactViaBrowser(input.client, remoteId);
    // A LID is a WhatsApp-local identifier, not a phone number. Only accept a
    // browser-resolved @c.us identity, never the LID's numeric portion.
    return toStoredPhone(resolved?.resolvedId);
  }

  return toStoredPhone(remoteId, input.fallbackNumber);
}

function isConnectedAccountIdentity(input: {
  client: WhatsAppClient;
  remoteId?: string | null;
  phone?: string | null;
  isSelfContact?: boolean | null;
}) {
  const ownRemoteId = input.client.info?.wid?._serialized?.trim() ?? "";
  const ownPhone = toStoredPhone(ownRemoteId);
  const remoteId = input.remoteId?.trim() ?? "";
  const phone = normalizeChatPhone(input.phone);

  return Boolean(
    input.isSelfContact ||
      (ownRemoteId && remoteId && ownRemoteId === remoteId) ||
      (ownPhone && phone && ownPhone === phone)
  );
}

function isGroupRemoteId(serializedId?: string | null) {
  return Boolean(serializedId?.trim().endsWith("@g.us"));
}

function buildDirectChatId(phone: string) {
  const normalizedPhone = normalizeChatPhone(phone);
  return normalizedPhone ? `${normalizedPhone}@c.us` : null;
}

function isVoiceNoteMimeType(mimeType?: string | null) {
  const normalized = `${mimeType ?? ""}`.trim().toLowerCase();
  return normalized === "audio/ogg" || normalized === "audio/opus";
}

function assertValidVoiceNoteRequest(input: {
  attachmentPath?: string | null;
  attachmentMimeType?: string | null;
  sendAudioAsVoice?: boolean;
}) {
  if (input.sendAudioAsVoice !== true) {
    return;
  }

  if (!input.attachmentPath) {
    throw new Error("Voice notes require a local audio file before sending.");
  }

  if (!`${input.attachmentMimeType ?? ""}`.trim().toLowerCase().startsWith("audio/")) {
    throw new Error("Voice notes only support audio attachments.");
  }
}

function shouldSendAsVoiceNote(input: {
  attachmentPath?: string | null;
  attachmentMimeType?: string | null;
  sendAudioAsVoice?: boolean;
}) {
  return Boolean(
    input.sendAudioAsVoice === true &&
      input.attachmentPath &&
      `${input.attachmentMimeType ?? ""}`.trim().toLowerCase().startsWith("audio/")
  );
}

async function prepareVoiceNoteAttachment(input: {
  attachmentPath: string;
  attachmentMimeType?: string | null;
  attachmentName?: string | null;
}) {
  const tempDir = await mkdtemp(path.join(tmpdir(), "connexa-voice-note-"));
  const outputPath = path.join(tempDir, `${path.parse(input.attachmentName ?? "voice-note").name || "voice-note"}.ogg`);

  await convertAudioToVoiceNoteOgg(input.attachmentPath, outputPath);

  return {
    path: outputPath,
    mimeType: "audio/ogg",
    cleanup: async () => {
      await rm(tempDir, { recursive: true, force: true });
    }
  };
}

async function convertAudioToVoiceNoteOgg(inputPath: string, outputPath: string) {
  await new Promise<void>((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", [
      "-y",
      "-i",
      inputPath,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "48000",
      "-c:a",
      "libopus",
      "-b:a",
      "48k",
      "-application",
      "voip",
      "-f",
      "ogg",
      outputPath
    ]);

    let stderr = "";

    ffmpeg.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    ffmpeg.on("error", (error) => {
      reject(
        new Error(
          error instanceof Error && "code" in error && error.code === "ENOENT"
            ? "ffmpeg is not installed on the WhatsApp Personal sender runtime."
            : error instanceof Error
              ? error.message
              : "Unable to start ffmpeg for voice note conversion."
        )
      );
    });

    ffmpeg.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(stderr.trim() || `ffmpeg exited with code ${code}`));
    });
  });
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

function readMessageIdPart(value: unknown, key: string) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const part = (value as Record<string, unknown>)[key];
  return typeof part === "string" && part.trim() ? part.trim() : null;
}

function getWhatsAppMessageProviderId(message: Message | null | undefined) {
  const messageId = message?.id as
    | {
        _serialized?: string | null;
        id?: string | null;
        remote?: string | null;
        participant?: string | null;
        fromMe?: boolean | null;
      }
    | null
    | undefined;
  const remote = readMessageIdPart(messageId, "remote") ?? message?.to ?? message?.from ?? null;
  const participant =
    readMessageIdPart(messageId, "participant") ??
    (remote?.endsWith("@g.us")
      ? ((message as Message & { author?: string | null } | null | undefined)?.author?.trim() || null)
      : null);
  const serialized = readMessageIdPart(messageId, "_serialized");
  if (serialized) {
    return participant && !serialized.endsWith(`_${participant}`)
      ? `${serialized}_${participant}`
      : serialized;
  }

  const id = readMessageIdPart(messageId, "id");

  if (!id || !remote) {
    return null;
  }

  const fromMe = typeof messageId?.fromMe === "boolean" ? messageId.fromMe : Boolean(message?.fromMe);
  return `${String(fromMe)}_${remote}_${id}${participant ? `_${participant}` : ""}`;
}

function getAcceptedWhatsAppMessageProviderId(message: Message) {
  return getWhatsAppMessageProviderId(message);
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
    isMe?: boolean | null;
    pushname?: string | null;
    name?: string | null;
    number?: string | null;
    getProfilePicUrl?: () => Promise<string | null>;
  } | null;
  profileContact?: {
    number?: string | null;
    getProfilePicUrl?: () => Promise<string | null>;
    profilePicThumb?: { eurl?: string | null } | null;
    _data?: { profilePicThumb?: { eurl?: string | null } | null } | null;
  } | null;
  profileContactId?: string | null;
  resolveProfilePhoto?: boolean;
  groupContactName?: string | null;
  chat?: {
    name?: string | null;
    formattedTitle?: string | null;
    groupMetadata?: { subject?: string | null } | null;
  } | null;
}) {
  const isGroup = isGroupRemoteId(input.remoteId);
  const phone = isGroup
    ? toStoredPhone(input.remoteId)
    : await resolveContactPhoneFromRemoteId({
        client: input.client,
        remoteId: input.remoteId,
        fallbackNumber: input.contact?.number ?? null
      });
  // A group message's `author` identifies its sender, not the group chat.
  // Never use that contact to resolve or cache the group's avatar: doing so
  // makes the Inbox avatar change to the most recent participant's picture.
  const profileContact = isGroup ? input.contact : input.profileContact ?? input.contact;
  const profileContactId = isGroup ? input.remoteId : input.profileContactId?.trim() || input.remoteId;
  const profileContactPhone = profileContact?.number?.trim() || null;
  const profileContactIds = [
    profileContactId,
    profileContactPhone && /^\d+$/.test(profileContactPhone) ? `${profileContactPhone}@c.us` : null
  ];
  const profileCacheKey = `${input.workspaceId}:${profileContactId}`;
  const cachedProfilePhoto = profilePhotoCache.get(profileCacheKey);
  const isCachedProfilePhoto = Boolean(cachedProfilePhoto && cachedProfilePhoto.expiresAt > Date.now());
  const cachedPhotoUrl = isCachedProfilePhoto ? cachedProfilePhoto?.photoUrl ?? null : null;
  if (cachedProfilePhoto && !isCachedProfilePhoto) {
    profilePhotoCache.delete(profileCacheKey);
  }
  const shouldResolveProfilePhoto = input.resolveProfilePhoto !== false;
  const primaryPhotoUrl = !shouldResolveProfilePhoto || isCachedProfilePhoto
    ? null
    : await getWhatsAppProfilePictureUrl({
        client: input.client,
        contact: profileContact,
        contactId: profileContactId,
        contactIds: profileContactIds
      });
  const fallbackPhotoUrl = null;
  const bridgePhotoUrl =
    !shouldResolveProfilePhoto || isCachedProfilePhoto || primaryPhotoUrl || fallbackPhotoUrl
      ? null
      : (await getBridgeProfilePhotoUrl(input.client, profileContactId)) ??
        (profileContactIds[1]
          ? await getBridgeProfilePhotoUrl(input.client, profileContactIds[1])
          : null);
  const livePhotoUrl = primaryPhotoUrl ?? fallbackPhotoUrl ?? bridgePhotoUrl ?? null;
  const photoUrl = !shouldResolveProfilePhoto
    ? null
    : isCachedProfilePhoto
    ? cachedPhotoUrl
    : await cacheProfilePhoto({
        client: input.client,
        workspaceId: input.workspaceId,
        remoteId: profileContactId,
        phone,
        photoUrl: livePhotoUrl
      });
  if (shouldResolveProfilePhoto && !isCachedProfilePhoto) {
    profilePhotoCache.set(profileCacheKey, {
      expiresAt: Date.now() + (photoUrl ? PROFILE_PHOTO_CACHE_TTL_MS : PROFILE_PHOTO_MISS_CACHE_TTL_MS),
      photoUrl
    });
  }
  const displayName = resolveIncomingDisplayName({
    notifyName: isGroup ? null : input.notifyName,
    pushname: isGroup ? null : input.contact?.pushname,
    contactName: isGroup ? null : input.contact?.name,
    chatName: input.chat?.name,
    groupSubject: input.chat?.groupMetadata?.subject,
    groupContactName: isGroup ? input.groupContactName : null,
    formattedTitle: input.chat?.formattedTitle,
    phone: isGroup ? phone : input.contact?.number ?? phone,
    fallbackId: input.fallbackId ?? input.remoteId
  });

  return {
    displayName,
    whatsappPushName: isGroup ? null : normalizeWhatsAppPushName(input.contact?.pushname),
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
  formattedTitle?: string | null;
  groupMetadata?: { subject?: string | null } | null;
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
    displayName: resolveIncomingDisplayName({
      chatName: chat.name,
      groupSubject: chat.groupMetadata?.subject,
      formattedTitle: chat.formattedTitle,
      phone,
      fallbackId: chat.id?._serialized
    }) || phone,
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

async function buildResolvedFallbackSyncPayload(input: {
  client: WhatsAppClient;
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
  const phone = await resolveContactPhoneFromRemoteId({
    client: input.client,
    remoteId: input.serializedId,
    fallbackNumber: input.fallbackNumber
  });
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
    message.includes("WhatsApp history operation timed out") ||
    message.includes("WhatsApp history chat import timed out") ||
    message.includes("Runtime.callFunctionOn timed out") ||
    message.includes("Increase the 'protocolTimeout' setting")
  );
}

async function runWhatsAppHistoryOperation<T>(
  operation: () => Promise<T>,
  label: string,
  timeoutMs = WHATSAPP_HISTORY_OPERATION_TIMEOUT_MS
): Promise<T> {
  let timeoutHandle: NodeJS.Timeout | null = null;

  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Error(`WhatsApp history operation timed out while ${label}.`));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

function isWhatsAppHistoryOperationTimeout(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.includes("WhatsApp history operation timed out");
}

async function fetchWhatsAppChatsWithRecovery(client: WhatsAppClient) {
  // whatsapp-web.js `client.getChats()` can remain pending indefinitely while
  // WhatsApp Web hydrates a large account. That leaves the initial sync locked
  // in SYNCING_HISTORY and prevents every older message from reaching Inbox.
  // Read the browser chat store directly instead; this path is timeout-bound
  // and still exposes the complete set of chat models in the loaded session.
  const browserPage = client.pupPage;
  if (!browserPage) {
    throw new Error("WhatsApp browser page is unavailable while listing chat identifiers.");
  }

  const chatCandidates = await runWhatsAppHistoryOperation(
    () =>
      browserPage.evaluate(() => {
        type BrowserChatCandidate = {
          id?: { _serialized?: string | null; toString?: () => string } | null;
          name?: string | null;
          formattedTitle?: string | null;
          groupMetadata?: { subject?: string | null } | null;
          t?: number | null;
          unreadCount?: number | null;
          archive?: boolean | null;
          pin?: number | null;
          mute?: { expiration?: number | null } | null;
          attributes?: {
            id?: { _serialized?: string | null; toString?: () => string } | null;
            name?: string | null;
            formattedTitle?: string | null;
            groupMetadata?: { subject?: string | null } | null;
            t?: number | null;
            unreadCount?: number | null;
            archive?: boolean | null;
            pin?: number | null;
            mute?: { expiration?: number | null } | null;
          } | null;
        };
        type BrowserChatCollection = {
          getModelsArray?: () => BrowserChatCandidate[];
        };
        const browserGlobal = globalThis as unknown as {
          Store?: {
            Chat?: BrowserChatCollection;
          };
          require?: (moduleName: string) => {
            Chat?: BrowserChatCollection;
          };
        };
        const chatCollection =
          browserGlobal.Store?.Chat ??
          browserGlobal.require?.("WAWebCollections")?.Chat;
        const browserChats = chatCollection?.getModelsArray?.() ?? [];

        return browserChats
          .map((chat) => {
            try {
              // Some WhatsApp Web model getters throw the minified hydration
              // rejection `r`. Prefer the Backbone attributes snapshot and
              // isolate extraction per model so one bad chat cannot abort the
              // entire workspace's history discovery.
              const snapshot = chat.attributes ?? chat;
              const id = snapshot.id?._serialized ?? snapshot.id?.toString?.() ?? null;

              return {
                id,
                // `name` can temporarily be the raw group id. Prefer the hydrated
                // group subject (then formatted title) so Inbox gets the real title.
                name:
                  snapshot.groupMetadata?.subject ??
                  snapshot.formattedTitle ??
                  snapshot.name ??
                  null,
                timestamp: snapshot.t ?? null,
                unreadCount: snapshot.unreadCount ?? 0,
                archived: Boolean(snapshot.archive),
                pinned: Boolean(snapshot.pin),
                muteExpiration: snapshot.mute?.expiration ?? null
              };
            } catch {
              // Reading optional metadata must never discard an otherwise
              // importable chat. Fall back to the stable id and hydrate the
              // remaining details during that chat's isolated import.
              try {
                const id = chat.id?._serialized ?? chat.id?.toString?.() ?? null;
                return {
                  id,
                  name: null,
                  timestamp: null,
                  unreadCount: 0,
                  archived: false,
                  pinned: false,
                  muteExpiration: null
                };
              } catch {
                return {
                  id: null,
                  name: null,
                  timestamp: null,
                  unreadCount: 0,
                  archived: false,
                  pinned: false,
                  muteExpiration: null
                };
              }
            }
          })
          .filter((chat): chat is typeof chat & { id: string } => Boolean(chat.id));
      }),
    "listing chat identifiers"
  );
  const importableChatCandidates = chatCandidates.filter(
    (chat) => chat.id.includes("@") && !isStatusLikeRemoteId(chat.id) && !chat.id.endsWith("@newsletter")
  );
  if (importableChatCandidates.length === 0) {
    // The browser store can be temporarily unavailable after a WhatsApp Web
    // update. Do not mark history complete with an empty store; let the normal
    // client API provide hydrated Chat objects (including groupMetadata).
    const hydratedChats = await runWhatsAppHistoryOperation(
      () => client.getChats(),
      "listing chats through the WhatsApp client fallback"
    );
    if (hydratedChats.length > 0) {
      return hydratedChats;
    }
  }
  const chats = importableChatCandidates.map((chatCandidate) => {
    const chatId = chatCandidate.id;
    return {
      id: {
        _serialized: chatId,
        user: chatId.split("@")[0]
      },
      name: chatCandidate.name,
      timestamp: chatCandidate.timestamp,
      unreadCount: chatCandidate.unreadCount,
      archived: chatCandidate.archived,
      isPinned: chatCandidate.pinned,
      isMuted: Boolean(chatCandidate.muteExpiration),
      muteExpiration: chatCandidate.muteExpiration,
      isGroup: chatId.endsWith("@g.us"),
      isChannel: false,
      getContact: () => client.getContactById(chatId),
      syncHistory: () => client.syncHistory(chatId),
      fetchMessages: async ({ limit }: { limit: number }) =>
        (await fetchChatMessagesDirectly({ client, chatId, limit })).messages
    } as unknown as Awaited<ReturnType<WhatsAppClient["getChatById"]>>;
  });

  return chats;
}

function isTransientChatLoadingError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  return (
    message.includes("waitForChatLoading") ||
    message.includes("Cannot read properties of undefined (reading 'waitForChatLoading')")
  );
}

function isTransientWhatsAppSyncError(error: unknown) {
  // WhatsApp Web occasionally rejects the first post-ready store request with
  // a minified one-letter reason (currently `r`). It is a browser-store
  // hydration race, not a durable history error. Treat it like the other
  // transient startup failures so the bounded background recovery can retry
  // instead of persisting SYNCING_HISTORY after a process restart.
  const message = error instanceof Error ? error.message.trim() : typeof error === "string" ? error.trim() : "";

  return (
    message.startsWith(WHATSAPP_BROWSER_STORE_HYDRATION_ERROR_PREFIX) ||
    message === "r" ||
    isTransientSetupMessage(message) ||
    isTransientExecutionContextError(error) ||
    isTransientChatLoadingError(error)
  );
}

function createBrowserStoreHydrationError(message: string) {
  return new Error(`${WHATSAPP_BROWSER_STORE_HYDRATION_ERROR_PREFIX}${message}`);
}

function isBrowserStoreHydrationError(error: unknown) {
  return error instanceof Error && error.message.startsWith(WHATSAPP_BROWSER_STORE_HYDRATION_ERROR_PREFIX);
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

async function resolveWhatsAppGroupNotificationMetadata(
  client: WhatsAppClient,
  message: Message,
  knownActorContact?: {
    name?: string | null;
    pushname?: string | null;
    number?: string | null;
  } | null
): Promise<WhatsAppGroupNotificationMetadata | null> {
  const metadata = readWhatsAppGroupNotificationMetadata(message);
  if (!metadata) {
    return null;
  }

  const actorContact = metadata.authorId
    ? await resolveMentionContact(client, metadata.authorId)
    : null;
  const recipientContacts = await Promise.all(
    metadata.recipientIds.map((recipientId) =>
      resolveMentionContact(client, recipientId)
    )
  );

  return {
    ...metadata,
    actorLabel: getWhatsAppGroupParticipantLabel(
      {
        name: knownActorContact?.name ?? actorContact?.name,
        pushname: knownActorContact?.pushname ?? actorContact?.pushname,
        number: actorContact?.phone ?? knownActorContact?.number
      },
      metadata.authorId
    ),
    recipientLabels: metadata.recipientIds.map((recipientId, index) =>
      getWhatsAppGroupParticipantLabel(recipientContacts[index], recipientId)
    )
  };
}

function getWhatsAppGroupParticipantLabel(
  contact: {
    name?: string | null;
    pushname?: string | null;
    number?: string | null;
  } | null | undefined,
  fallbackId?: string | null
) {
  return (
    contact?.name?.trim() ||
    contact?.pushname?.trim() ||
    formatWhatsAppParticipantLabel(contact?.number) ||
    formatWhatsAppParticipantLabel(fallbackId) ||
    "Unknown participant"
  );
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
    phone: mentionId.endsWith("@lid")
      ? toStoredPhone(browserResolved?.resolvedId ?? null, fallbackContact?.number ?? null) ||
        (browserResolved?.resolvedId?.endsWith("@c.us")
          ? normalizeChatPhone(browserResolved.phone)
          : null)
      : toStoredPhone(mentionId, primaryContact?.number ?? null) ||
        toStoredPhone(browserResolved?.resolvedId ?? null, fallbackContact?.number ?? null) ||
        normalizeChatPhone(browserResolved?.phone) ||
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

function clearHistoryRecoveryTimer(state: RuntimeState) {
  if (state.historyRecoveryTimer) {
    clearTimeout(state.historyRecoveryTimer);
    state.historyRecoveryTimer = null;
  }
}

function clearHistorySyncWatchdogTimer(state: RuntimeState) {
  if (state.historySyncWatchdogTimer) {
    clearTimeout(state.historySyncWatchdogTimer);
    state.historySyncWatchdogTimer = null;
  }
}

function clearStallRecoveryTimer(state: RuntimeState) {
  if (state.stallRecoveryTimer) {
    clearTimeout(state.stallRecoveryTimer);
    state.stallRecoveryTimer = null;
  }
}

function clearReconnectTimer(channelId: string) {
  const recovery = runtimeRecoveryTimers.get(channelId);
  if (recovery) {
    clearTimeout(recovery.timer);
    runtimeRecoveryTimers.delete(channelId);
  }
}

function clearIdleEvictionTimer(state: RuntimeState) {
  if (state.idleEvictionTimer) {
    clearTimeout(state.idleEvictionTimer);
    state.idleEvictionTimer = null;
  }
}

function isUnrecoverableRuntimeStatus(status: string) {
  return status === "AUTH_FAILED" || status === "DISCONNECTED" || status === "ERROR";
}

function shouldRecycleRuntimeState(state: RuntimeState) {
  if (!state.client) {
    return true;
  }

  if (runtimeRecoveryTimers.has(state.channelId) || isUnrecoverableRuntimeStatus(state.connectionStatus)) {
    return true;
  }

  if (
    (state.connectionStatus === "INITIALIZING" || state.connectionStatus === "AUTHENTICATED") &&
    Date.now() - state.statusUpdatedAt > WHATSAPP_STALE_RUNTIME_MS
  ) {
    return true;
  }

  if (
    ["CONNECTED", "READY", "SYNCING_HISTORY"].includes(state.connectionStatus) &&
    !state.client.info?.wid?._serialized &&
    Date.now() - state.statusUpdatedAt > WHATSAPP_STALE_RUNTIME_MS
  ) {
    return true;
  }

  if (
    state.connectionStatus === "SYNCING_HISTORY" &&
    state.isSyncingHistory &&
    Date.now() - state.statusUpdatedAt >= WHATSAPP_HISTORY_SYNC_WATCHDOG_MS
  ) {
    return true;
  }

  return false;
}

async function replaceRuntimeClient(state: RuntimeState, sessionClientId = state.sessionClientId) {
  const previousClient = state.client;

  // Detach Connexa listeners before destroying a retired client. Chromium can
  // finish authentication after an initialization retry has already replaced
  // the client; without this fence, several old clients can emit READY against
  // the same state and compete for one WhatsApp linked-device session.
  previousClient.removeAllListeners();
  try {
    await runWhatsAppHistoryOperation(
      () => previousClient.destroy(),
      `replacing runtime client ${state.channelId}`,
      WHATSAPP_CLIENT_TEARDOWN_TIMEOUT_MS
    );
  } catch (error) {
    const browserProcess = (
      previousClient as WhatsAppClient & {
        pupBrowser?: {
          process?: () => { kill: (signal?: string) => unknown } | null;
        };
      }
    ).pupBrowser?.process?.();
    browserProcess?.kill("SIGKILL");
    console.warn(
      `[whatsapp-web][runtime] workspace=${state.workspaceId} forced retired-client termination: ${
        error instanceof Error ? error.message : "Unknown replacement teardown error."
      }`
    );
  }
  state.client = createWhatsAppClient(sessionClientId);
  state.initializationStages = {};
  state.bootstrapProfileId = null;
  state.bootstrapStages = {};
  state.bootstrapPerformance = {};
  state.authenticationStages = {};
  bindClientEvents(state);
}

function createInitializeTimeoutError(timeoutMs: number) {
  return new Error(`WhatsApp client initialization timed out after ${timeoutMs}ms.`);
}

async function initializeClientWithTimeout(state: RuntimeState) {
  let timeoutHandle: NodeJS.Timeout | null = null;

  try {
    await Promise.race([
      state.client.initialize(),
      new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(createInitializeTimeoutError(WHATSAPP_INITIALIZE_TIMEOUT_MS));
        }, WHATSAPP_INITIALIZE_TIMEOUT_MS);
      })
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

function shouldRetryInitializeError(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error ?? "").toLowerCase();

  return (
    isTransientExecutionContextError(error) ||
    isChromiumProfileLockError(error) ||
    isChromiumLaunchError(error) ||
    isTransientBrowserExecutableError(error) ||
    message.includes("timed out") ||
    message.includes("timeout") ||
    message.includes("navigation") ||
    message.includes("target closed") ||
    message.includes("session closed")
  );
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
  const currentRuntime = runtimeStates.get(buildRuntimeKey(state.channelId));
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

  await teardownRuntimeState(state.channelId);
}

function scheduleIdleEviction(state: RuntimeState) {
  clearIdleEvictionTimer(state);

  if (!canEvictIdleRuntime(state)) {
    return;
  }

  const expectedActivityAt = state.lastActivityAt;
  state.idleEvictionTimer = setTimeout(() => {
    void runSerializedChannelLifecycle(state.channelId, () =>
      evictIdleRuntime(state, expectedActivityAt)
    ).catch((error) => {
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

function getLifecycleStallTimeoutMs(status: string) {
  return status === "INITIALIZING"
    ? WHATSAPP_INITIALIZE_TIMEOUT_MS
    : WHATSAPP_CONNECTION_STALL_MS;
}

function isActiveRuntimeState(state: RuntimeState) {
  return (
    runtimeStates.get(buildRuntimeKey(state.channelId)) === state &&
    isCurrentRuntimeGeneration(state.channelId, state.generationId)
  );
}

function scheduleLifecycleWatchdog(state: RuntimeState) {
  clearStallRecoveryTimer(state);
  if (!shouldWatchForStalledRuntime(state)) return;

  const expectedStatus = state.connectionStatus;
  const expectedGenerationId = state.generationId;
  const timeoutMs = getLifecycleStallTimeoutMs(expectedStatus);
  const checkProgress = () => {
    if (
      !isActiveRuntimeState(state) ||
      state.generationId !== expectedGenerationId ||
      state.connectionStatus !== expectedStatus
    ) {
      return;
    }

    const now = Date.now();
    if (
      hasRecentLifecycleProgress({
        now,
        lastProgressAt: state.lifecycleProgressAt,
        timeoutMs
      })
    ) {
      const remainingMs = Math.max(
        1,
        timeoutMs - (now - state.lifecycleProgressAt)
      );
      state.stallRecoveryTimer = setTimeout(checkProgress, remainingMs);
      return;
    }

    const expectedStatusUpdatedAt = state.statusUpdatedAt;
    const expectedProgressAt = state.lifecycleProgressAt;
    void runSerializedChannelLifecycle(state.channelId, () =>
      recoverStalledRuntime(
        state,
        expectedStatus,
        expectedStatusUpdatedAt,
        expectedProgressAt
      )
    ).catch((error) => {
      console.error(
        `[whatsapp-web][runtime] workspace=${state.workspaceId} session=${state.sessionClientId} lifecycle-watchdog:error ${
          error instanceof Error ? error.message : "Unknown lifecycle watchdog error."
        }`
      );
    });
  };

  state.stallRecoveryTimer = setTimeout(checkProgress, timeoutMs);
}

function recordLifecycleProgress(state: RuntimeState, loadingPercent?: number) {
  if (!isActiveRuntimeState(state)) return;
  state.lifecycleProgressAt = Date.now();
  if (typeof loadingPercent === "number" && Number.isFinite(loadingPercent)) {
    state.loadingPercent = loadingPercent;
  }
  scheduleLifecycleWatchdog(state);
}

function updateRuntimeStatus(state: RuntimeState, status: string) {
  state.connectionStatus = status;
  state.statusUpdatedAt = Date.now();
  state.lifecycleProgressAt = state.statusUpdatedAt;
  recordRuntimeStatusMetric({
    workspaceId: state.workspaceId,
    sessionClientId: state.sessionClientId,
    runtimeStatus: status
  });
  scheduleLifecycleWatchdog(state);
}

function scheduleHistorySyncWatchdog(state: RuntimeState) {
  clearHistorySyncWatchdogTimer(state);
  state.historySyncAttemptId = (state.historySyncAttemptId ?? 0) + 1;
  const attemptId = state.historySyncAttemptId;
  const startedAt = Date.now();

  state.historySyncWatchdogTimer = setTimeout(() => {
    state.historySyncWatchdogTimer = null;
    if (
      !isActiveRuntimeState(state) ||
      !state.isSyncingHistory ||
      state.historySyncAttemptId !== attemptId
    ) {
      return;
    }

    const elapsedMs = Date.now() - startedAt;
    const reason =
      `Historical import exceeded the ${WHATSAPP_HISTORY_SYNC_WATCHDOG_MS}ms safety limit. ` +
      "Restarting the WhatsApp runtime while preserving the linked session.";
    console.warn(
      `[whatsapp-web][sync] workspace=${state.workspaceId} watchdog-recovery attempt=${attemptId} elapsedMs=${elapsedMs}`
    );
    void logWhatsAppRuntimeEvent({
      workspaceId: state.workspaceId,
      sessionClientId: state.sessionClientId,
      eventType: WHATSAPP_RUNTIME_EVENT_TYPES.STALL_RECOVERY,
      message: reason,
      metadata: {
        trigger: "history-sync-watchdog",
        attemptId,
        elapsedMs,
        historySyncCursor: state.historySyncCursor,
        historySyncTotal: state.historySyncTotal
      }
    });
    void runSerializedChannelLifecycle(state.channelId, async () => {
      if (
        !isActiveRuntimeState(state) ||
        !state.isSyncingHistory ||
        state.historySyncAttemptId !== attemptId
      ) {
        return;
      }
      await restartRuntimePreservingSession(state, reason, {
        trigger: "history-sync-watchdog",
        attemptId,
        elapsedMs
      });
    }).catch((error) => {
      console.error(
        `[whatsapp-web][sync] workspace=${state.workspaceId} watchdog-recovery:error ${
          error instanceof Error ? error.message : "Unknown watchdog recovery error."
        }`
      );
    });
  }, WHATSAPP_HISTORY_SYNC_WATCHDOG_MS);
}

async function teardownRuntimeState(channelId: string, options: { invalidateSession?: boolean } = {}) {
  const runtimeKey = buildRuntimeKey(channelId);
  const runtime = runtimeStates.get(runtimeKey);

  if (!runtime) {
    runtimeStates.delete(runtimeKey);
    return;
  }

  clearBackgroundSyncTimer(runtime);
  clearHistoryRecoveryTimer(runtime);
  clearHistorySyncWatchdogTimer(runtime);
  clearStallRecoveryTimer(runtime);
  clearReconnectTimer(runtime.channelId);
  clearIdleEvictionTimer(runtime);
  clearPostAuthenticationProfileTimer(runtime);
  runtimeStates.delete(runtimeKey);
  invalidateRuntimeGeneration(channelId, runtime.generationId);
  const pendingCreation = runtimeCreations.get(runtimeKey);
  if (pendingCreation?.generationId === runtime.generationId) {
    runtimeCreations.delete(runtimeKey);
  }
  if (options.invalidateSession) {
    await runWhatsAppHistoryOperation(
      () => runtime.client.logout(),
      `logging out runtime ${runtime.channelId}`,
      WHATSAPP_CLIENT_TEARDOWN_TIMEOUT_MS
    ).catch(() => null);
  }
  try {
    await runWhatsAppHistoryOperation(
      () => runtime.client.destroy(),
      `destroying runtime ${runtime.channelId}`,
      WHATSAPP_CLIENT_TEARDOWN_TIMEOUT_MS
    );
  } catch (error) {
    console.warn(
      `[whatsapp-web][runtime] workspace=${runtime.workspaceId} forced browser termination after teardown timeout: ${
        error instanceof Error ? error.message : "Unknown teardown error."
      }`
    );
    const browserProcess = (
      runtime.client as WhatsAppClient & {
        pupBrowser?: {
          process?: () => { kill: (signal?: string) => unknown } | null;
        };
      }
    ).pupBrowser?.process?.();
    browserProcess?.kill("SIGKILL");
  }
}

async function teardownActiveRuntimeStateSerialized(
  state: RuntimeState,
  options: { invalidateSession?: boolean } = {}
) {
  return runSerializedChannelLifecycle(state.channelId, async () => {
    if (!isActiveRuntimeState(state)) return;
    await teardownRuntimeState(state.channelId, options);
  });
}

function isSessionInvalidationDisconnectReason(reason: unknown) {
  const message = String(reason ?? "").toLowerCase();

  return (
    message.includes("logout") ||
    message.includes("logged out") ||
    message.includes("invalid session") ||
    message.includes("unpaired") ||
    message.includes("device removed") ||
    message.includes("multidevice mismatch")
  );
}

async function scheduleRuntimeReconnect(state: RuntimeState, delayMs = 5000) {
  clearReconnectTimer(state.channelId);
  const scheduled = await scheduleWhatsAppRuntimeRecovery({
    workspaceId: state.workspaceId,
    channelId: state.channelId,
    errorCode: "TRANSIENT_RUNTIME_FAILURE",
    minimumDelayMs: delayMs
  });
  if (!scheduled) return;
  if (!scheduled.allowed) {
    void logWhatsAppRuntimeEvent({
      workspaceId: state.workspaceId,
      sessionClientId: state.sessionClientId,
      eventType: WHATSAPP_RUNTIME_EVENT_TYPES.SUPERVISOR_PAUSED,
      message: `Automatic recovery circuit is cooling down until ${scheduled.nextRecoveryAt.toISOString()}.`
    });
    return;
  }
  const resolvedDelayMs = scheduled.delayMs;
  void logWhatsAppRuntimeEvent({
    workspaceId: state.workspaceId,
    sessionClientId: state.sessionClientId,
    eventType: WHATSAPP_RUNTIME_EVENT_TYPES.RECONNECT_SCHEDULED,
    message: `Transient disconnect detected. Reconnect scheduled in ${resolvedDelayMs}ms.`,
    metadata: {
      attempt: scheduled.attempt,
      delayMs: resolvedDelayMs
    }
  });
  const token = scheduled.token;
  const timer = setTimeout(() => {
    const registered = runtimeRecoveryTimers.get(state.channelId);
    if (!registered || registered.token !== token) return;
    runtimeRecoveryTimers.delete(state.channelId);
    void isWhatsAppRuntimeRecoveryCurrent({
      workspaceId: state.workspaceId,
      channelId: state.channelId,
      token
    }).then(async (isCurrent) => {
      if (!isCurrent) return;
      await restoreWorkspaceWhatsAppClient(state.workspaceId, state.channelId);
    }).catch((error) => {
      console.error(
        `[whatsapp-web][runtime] workspace=${state.workspaceId} channel=${state.channelId} reconnect:error ${
          error instanceof Error ? error.message : "Unknown reconnect error."
        }`
      );
    });
  }, resolvedDelayMs);
  runtimeRecoveryTimers.set(state.channelId, { token, timer });
}

async function recoverStalledRuntime(
  state: RuntimeState,
  expectedStatus: string,
  statusUpdatedAt: number,
  lifecycleProgressAt: number
) {
  const currentRuntime = runtimeStates.get(buildRuntimeKey(state.channelId));
  if (
    currentRuntime !== state ||
    !isCurrentRuntimeGeneration(state.channelId, state.generationId) ||
    state.connectionStatus !== expectedStatus ||
    state.statusUpdatedAt !== statusUpdatedAt ||
    state.lifecycleProgressAt !== lifecycleProgressAt
  ) {
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
  await teardownRuntimeState(state.channelId);
  await saveWhatsAppChannelConnection({
    channelId: state.channelId,
    workspaceId: state.workspaceId,
    agentId: state.agentId,
    sessionClientId: state.sessionClientId,
    connectionStatus: "ERROR",
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
  await scheduleRuntimeReconnect(state);
}

function scheduleBackgroundSync(
  state: RuntimeState,
  delayMs: number,
  priority: "bootstrap" | "incremental" | "routine" | "media" = state.hasCompletedInitialSync ? "routine" : "bootstrap"
) {
  clearBackgroundSyncTimer(state);
  void logWhatsAppRuntimeEvent({
    workspaceId: state.workspaceId,
    sessionClientId: state.sessionClientId,
    eventType: WHATSAPP_RUNTIME_EVENT_TYPES.HISTORY_JOB_QUEUED,
    message: "WhatsApp history work was queued.",
    metadata: { channelId: state.channelId, delayMs, priority, queuedAt: new Date().toISOString() }
  });
  state.backgroundSyncTimer = setTimeout(() => {
    void syncWorkspaceHistory(state.workspaceId, state.channelId, {
      triggeredBy: "background",
      priority
    }).catch(() => null);
  }, delayMs);
}

function hasInteractiveWhatsAppPairing(excludeChannelId?: string | null) {
  return Array.from(runtimeStates.values()).some(
    (runtime) =>
      runtime.channelId !== excludeChannelId &&
      isActiveRuntimeState(runtime) &&
      ["INITIALIZING", "QR_READY", "AUTHENTICATED"].includes(runtime.connectionStatus)
  );
}

function shouldDeferHistoryForPairing(runtime: RuntimeState) {
  if (!hasInteractiveWhatsAppPairing(runtime.channelId)) {
    runtime.historyPairingPriorityDeferredAt = null;
    return false;
  }

  const now = Date.now();
  runtime.historyPairingPriorityDeferredAt ??= now;
  return now - runtime.historyPairingPriorityDeferredAt < WHATSAPP_PAIRING_HISTORY_MAX_DEFERRAL_MS;
}

function mergeHistoryChatIntoWorklist(runtime: RuntimeState, chat: Chat | null | undefined) {
  const chatId = chat ? getChatIdentifier(chat) : null;
  if (!chat || !chatId || runtime.historyChatWorklistBuiltAt === null) return;

  const existingIndex = runtime.historyChatWorklist.findIndex((candidate) => getChatIdentifier(candidate) === chatId);
  if (existingIndex >= 0) {
    runtime.historyChatWorklist[existingIndex] = chat;
  } else {
    runtime.historyChatWorklist.unshift(chat);
  }
}

async function getHistoryChatWorklist(runtime: RuntimeState, client: WhatsAppClient) {
  const now = Date.now();
  if (
    runtime.historyChatWorklistBuiltAt !== null &&
    now - runtime.historyChatWorklistBuiltAt < WHATSAPP_HISTORY_CHAT_WORKLIST_TTL_MS
  ) {
    return runtime.historyChatWorklist;
  }

  const freshChats = await fetchWhatsAppChatsWithRecovery(client);
  const merged = new Map<string, Chat>();
  for (const chat of runtime.historyChatWorklist) {
    const chatId = getChatIdentifier(chat);
    if (chatId) merged.set(chatId, chat);
  }
  for (const chat of freshChats) {
    const chatId = getChatIdentifier(chat);
    if (chatId) merged.set(chatId, chat);
  }

  runtime.historyChatWorklist = Array.from(merged.values());
  runtime.historyChatWorklistBuiltAt = now;
  return runtime.historyChatWorklist;
}

function resetHistoryRetryState(state: RuntimeState) {
  state.historySyncStartedAt = null;
  state.historyRetryDelayMs = WHATSAPP_HISTORY_RETRY_BASE_MS;
  historyStallRecoveryAttempts.delete(state.channelId);
  clearHistoryRecoveryTimer(state);
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
  const recoveryAttempts = historyStallRecoveryAttempts.get(state.channelId) ?? 0;
  if (recoveryAttempts < 2 && !state.historyRecoveryTimer) {
    historyStallRecoveryAttempts.set(state.channelId, recoveryAttempts + 1);
    state.historyRecoveryTimer = setTimeout(() => {
      state.historyRecoveryTimer = null;
      if (!isActiveRuntimeState(state) || state.isSyncingHistory) return;

      void runSerializedChannelLifecycle(state.channelId, async () => {
        if (!isActiveRuntimeState(state) || state.isSyncingHistory) return;
        await restartRuntimePreservingSession(
          state,
          "Historical import stalled. Restarting the WhatsApp runtime automatically while preserving the linked session.",
          { expectedStatus: "CONNECTED", trigger: "history-stall-recovery" }
        );
      }).catch(() => null);
    }, 5_000);
  }
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
      await retryWhatsAppOperation(
        () => runWhatsAppHistoryOperation(() => activeChat.syncHistory().then(() => true), `requesting history for ${chatId ?? "chat"}`),
        2
      ).catch(() => false);
      if (!chatId) {
        throw new Error("Unable to fetch WhatsApp history without a chat id.");
      }

      return await retryWhatsAppOperation(() =>
        fetchChatMessagesDirectly({
          client: input.client,
          chatId,
          limit: input.limit
        })
      );
    } catch (error) {
      lastError = error;

      if (chatId && attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
        const refreshedChat = await retryWhatsAppOperation(
          () => input.client.getChatById(chatId) as Promise<typeof activeChat>,
          2
        ).catch(() => null);

        if (refreshedChat) {
          activeChat = refreshedChat;
          continue;
        }
      }

      break;
    }
  }

  // WhatsApp Web can throw an opaque minified error after loadEarlierMsgs has
  // already populated the browser-side chat store. A zero limit intentionally
  // skips loading another page and returns everything currently available, so
  // partial history is not discarded and the chat can be retried later.
  const snapshotMessages = await retryWhatsAppOperation(
    () => (chatId ? fetchChatMessagesDirectly({ client: input.client, chatId, limit: 0 }) : Promise.reject(lastError)),
    2
  ).then((result) => result.messages).catch(() => [] as Message[]);
  const recoveryError =
    lastError instanceof Error ? lastError.message : String(lastError ?? "Unable to recover WhatsApp chat history.");

  return {
    messages: snapshotMessages,
    needsRetry: true,
    recoveryError
  };
}

async function fetchChatMessagesDirectly(input: {
  client: WhatsAppClient;
  chatId: string;
  limit: number;
}) {
  const browserPage = input.client.pupPage;
  if (!browserPage) {
    throw new Error(`WhatsApp browser page is unavailable while loading chat ${input.chatId}.`);
  }

  const result = await runWhatsAppHistoryOperation(
    () =>
      browserPage.evaluate(
        async ({ chatId, limit }) => {
          type BrowserMessage = {
            id?: { fromMe?: boolean | null } | null;
            isNotification?: boolean | null;
            t?: number | null;
          };
          type BrowserChat = {
            msgs: {
              getModelsArray: () => BrowserMessage[];
            };
          };
          type BrowserChatCollection = {
            get?: (id: unknown) => BrowserChat | null | undefined;
            find?: (id: unknown) => Promise<BrowserChat | null | undefined>;
          };
          type BrowserHistoryLoader = {
            loadEarlierMsgs?: (
              input: { chat: BrowserChat } | BrowserChat,
              messages?: BrowserChat["msgs"]
            ) => Promise<BrowserMessage[] | null>;
          };
          type BrowserWidFactory = {
            createWid?: (id: string) => unknown;
          };
          const browserGlobal = globalThis as unknown as {
            Store?: {
              Chat?: BrowserChatCollection;
              ConversationMsgs?: BrowserHistoryLoader;
              WidFactory?: BrowserWidFactory;
            };
            WWebJS?: { getMessageModel?: (message: BrowserMessage) => unknown };
            require?: (moduleName: string) => {
              Chat?: BrowserChatCollection;
              createWid?: BrowserWidFactory["createWid"];
              loadEarlierMsgs?: BrowserHistoryLoader["loadEarlierMsgs"];
            };
          };
          const collections = browserGlobal.require?.("WAWebCollections");
          const widFactory =
            browserGlobal.Store?.WidFactory ??
            browserGlobal.require?.("WAWebWidFactory");
          const chatCollection = browserGlobal.Store?.Chat ?? collections?.Chat;
          const historyLoader =
            browserGlobal.Store?.ConversationMsgs ??
            browserGlobal.require?.("WAWebChatLoadMessages");
          const wid = widFactory?.createWid?.(chatId);
          const chat = wid
            ? chatCollection?.get?.(wid) ??
              (chatCollection?.find ? await chatCollection.find(wid) : null)
            : null;

          if (!chat) {
            return {
              messageModels: [] as unknown[],
              needsRetry: true,
              recoveryError: `Chat ${chatId} is not available in the WhatsApp browser store.`
            };
          }

          const filterMessage = (message: BrowserMessage) => !message.isNotification;
          let messages = chat.msgs.getModelsArray().filter(filterMessage);
          let needsRetry = false;
          let recoveryError: string | null = null;

          if (limit > 0) {
            while (messages.length < limit) {
              try {
                const earlierMessages = browserGlobal.Store?.ConversationMsgs
                  ? await historyLoader?.loadEarlierMsgs?.(chat, chat.msgs)
                  : await historyLoader?.loadEarlierMsgs?.({ chat });
                if (!earlierMessages?.length) {
                  break;
                }
                messages = [...earlierMessages.filter(filterMessage), ...messages];
              } catch (error) {
                const paginationError =
                  error instanceof Error ? error.message : String(error ?? "History pagination failed.");
                const isUnsupportedHistoryLoader = paginationError.includes("waitForChatLoading");
                needsRetry = !isUnsupportedHistoryLoader;
                recoveryError = isUnsupportedHistoryLoader ? null : paginationError;
                break;
              }
            }

            if (messages.length > limit) {
              messages.sort((left, right) => (left.t ?? 0) - (right.t ?? 0));
              messages = messages.slice(messages.length - limit);
            }
          }

          const getMessageModel = browserGlobal.WWebJS?.getMessageModel;
          const messageModels = getMessageModel
            ? messages.map((message) => getMessageModel(message)).filter(Boolean)
            : [];

          return {
            messageModels,
            needsRetry: needsRetry || !getMessageModel,
            recoveryError: getMessageModel ? recoveryError : "WhatsApp message serializer is unavailable."
          };
        },
        { chatId: input.chatId, limit: input.limit }
      ),
    `fetching messages directly for ${input.chatId}`
  );
  const messages = result.messageModels.map(
    (messageData) => new WhatsAppMessage(input.client, messageData as never)
  );

  return {
    messages,
    needsRetry: result.needsRetry,
    recoveryError: result.recoveryError
  };
}

async function retryWhatsAppOperation<T>(operation: () => Promise<T>, attempts = 3, delayMs = 500): Promise<T> {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (!isTransientWhatsAppSyncError(error) || attempt === attempts) {
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("WhatsApp operation failed.");
}

function emitActiveRuntimeConnection(
  state: RuntimeState,
  boundClient: WhatsAppClient,
  input: {
    connectionStatus: string;
    displayName?: string | null;
    phoneNumber?: string | null;
    connectedAt?: Date | null;
    lastError?: string | null;
    qrCodeDataUrl?: string | null;
    qrCodeGeneratedAt?: Date | null;
    qrCodeExpiresAt?: Date | null;
    qrCodeExpired?: boolean;
    qrVersion?: number;
  }
) {
  if (!isActiveRuntimeState(state) || state.client !== boundClient) return null;
  state.connectionEventSequence += 1;
  const updatedAt = new Date().toISOString();
  state.connectionUpdatedAt = updatedAt;
  emitWhatsAppConnectionToInbox({
    workspaceId: state.workspaceId,
    channelId: state.channelId,
    connectionStatus: input.connectionStatus,
    updatedAt,
    displayName: input.displayName,
    phoneNumber: input.phoneNumber,
    connectedAt: input.connectedAt?.toISOString(),
    lastError: input.lastError,
    connectionAttemptId: state.generationId,
    eventSequence: state.connectionEventSequence,
    qrVersion: input.qrVersion,
    qrCodeDataUrl: input.qrCodeDataUrl,
    qrCodeGeneratedAt: input.qrCodeGeneratedAt?.toISOString(),
    qrCodeExpiresAt: input.qrCodeExpiresAt?.toISOString(),
    qrCodeExpired: input.qrCodeExpired
  });
  return { updatedAt, eventSequence: state.connectionEventSequence };
}

async function saveActiveRuntimeConnection(
  state: RuntimeState,
  boundClient: WhatsAppClient,
  input: {
    connectionStatus: string;
    displayName?: string | null;
    phoneNumber?: string | null;
    qrCodeDataUrl?: string | null;
    qrCodeUpdatedAt?: Date | null;
    lastError?: string | null;
    connectedAt?: Date | null;
    emitRealtime?: boolean;
  }
) {
  const { emitRealtime = true, ...connectionInput } = input;
  const savedChannel = await runSerializedChannelLifecycle(state.channelId, async () => {
    if (!isActiveRuntimeState(state) || state.client !== boundClient) return null;
    return saveWhatsAppChannelConnectionIfSessionCurrent({
      channelId: state.channelId,
      workspaceId: state.workspaceId,
      agentId: state.agentId,
      expectedSessionClientId: state.sessionClientId,
      ...connectionInput
    });
  });

  if (savedChannel && emitRealtime) {
    emitActiveRuntimeConnection(state, boundClient, connectionInput);
  }

  return savedChannel;
}

async function runRuntimeHealthProbe(state: RuntimeState) {
  if (!isActiveRuntimeState(state)) return false;

  try {
    const browser = (state.client as WhatsAppClient & {
      pupBrowser?: { isConnected?: () => boolean };
      pupPage?: { isClosed?: () => boolean; evaluate?: <T>(fn: () => T) => Promise<T> };
    }).pupBrowser;
    const page = (state.client as WhatsAppClient & {
      pupPage?: { isClosed?: () => boolean; evaluate?: <T>(fn: () => T) => Promise<T> };
    }).pupPage;

    if (!browser?.isConnected?.() || !page || page.isClosed?.() || !page.evaluate) {
      throw new Error("WhatsApp browser is not responsive.");
    }

    const [providerState, pageResponsive] = await runWhatsAppHistoryOperation(
      () => Promise.all([state.client.getState(), page.evaluate(() => true)]),
      `probing runtime ${state.channelId}`,
      WHATSAPP_RUNTIME_HEALTH_TIMEOUT_MS
    );
    if (!isActiveRuntimeState(state)) return false;
    if (!pageResponsive) throw new Error("WhatsApp page probe failed.");

    const classification = classifyWhatsAppWebState(providerState);
    if (classification === "reauth-required") {
      await markWhatsAppRuntimeReauthRequired({
        workspaceId: state.workspaceId,
        channelId: state.channelId,
        errorCode: `PROVIDER_${String(providerState ?? "UNPAIRED")}`
      });
      await teardownActiveRuntimeStateSerialized(state);
      return false;
    }
    if (classification !== "healthy") {
      throw new Error(`WhatsApp provider state is ${String(providerState ?? "unknown")}.`);
    }

    await markWhatsAppRuntimeHealthy({
      workspaceId: state.workspaceId,
      channelId: state.channelId
    });
    return true;
  } catch (error) {
    if (!isActiveRuntimeState(state)) return false;
    const failures = await recordWhatsAppRuntimeHealthFailure({
      workspaceId: state.workspaceId,
      channelId: state.channelId,
      errorCode: "RUNTIME_HEALTH_PROBE_FAILED"
    });
    if (failures < WHATSAPP_RUNTIME_HEALTH_FAILURE_THRESHOLD) return false;

    await runSerializedChannelLifecycle(state.channelId, async () => {
      if (!isActiveRuntimeState(state)) return;
      await teardownRuntimeState(state.channelId);
      await markWhatsAppChannelDisconnected({
        channelId: state.channelId,
        workspaceId: state.workspaceId,
        connectionStatus: "ERROR",
        lastError: "WhatsApp runtime stopped responding. Connexa is recovering it automatically."
      });
      await scheduleRuntimeReconnect(state);
    });
    console.warn(
      `[whatsapp-web][health] workspace=${state.workspaceId} channel=${state.channelId} probe-failed failures=${failures} reason=${
        error instanceof Error ? error.message : "Unknown health probe error."
      }`
    );
    return false;
  }
}

async function probeRuntimeHealth(state: RuntimeState) {
  const existing = runtimeHealthProbes.get(state.channelId);
  if (existing) return existing;

  const probe = runRuntimeHealthProbe(state).finally(() => {
    if (runtimeHealthProbes.get(state.channelId) === probe) {
      runtimeHealthProbes.delete(state.channelId);
    }
  });
  runtimeHealthProbes.set(state.channelId, probe);
  return probe;
}

function bindClientEvents(state: RuntimeState) {
  const boundClient = state.client;
  if (runtimeBoundClients.has(boundClient)) {
    return;
  }

  runtimeBoundClients.add(boundClient);
  const isCurrentClient = () => isActiveRuntimeState(state) && state.client === boundClient;

  type DiagnosticStagePayload = {
    bootstrapId?: unknown;
    stage?: unknown;
    at?: unknown;
    elapsedMs?: unknown;
    stageDurationMs?: unknown;
    metadata?: unknown;
    snapshot?: unknown;
  };
  const diagnosticClient = boundClient as unknown as {
    on(eventName: string, listener: (payload: DiagnosticStagePayload) => void): void;
  };
  diagnosticClient.on("connexa:initialize-stage", (payload) => {
    if (!isCurrentClient() || typeof payload?.stage !== "string") return;
    const at = typeof payload.at === "string" ? payload.at : new Date().toISOString();
    const elapsedMs = typeof payload.elapsedMs === "number" && Number.isFinite(payload.elapsedMs)
      ? Math.max(0, Math.round(payload.elapsedMs))
      : null;
    const stageDurationMs = typeof payload.stageDurationMs === "number" && Number.isFinite(payload.stageDurationMs)
      ? Math.max(0, Math.round(payload.stageDurationMs))
      : null;
    state.initializationStages[payload.stage] = { at, elapsedMs, stageDurationMs };
    console.info(
      `[whatsapp-web][initialize-profile] attempt=${state.generationId} stage=${payload.stage} elapsedMs=${String(elapsedMs)} stageDurationMs=${String(stageDurationMs)}`
    );
  });
  diagnosticClient.on("connexa:bootstrap-stage", (payload) => {
    if (
      !isCurrentClient() ||
      typeof payload?.bootstrapId !== "string" ||
      typeof payload?.stage !== "string"
    ) {
      return;
    }
    if (!state.bootstrapProfileId) {
      state.bootstrapProfileId = payload.bootstrapId;
    }
    if (state.bootstrapProfileId !== payload.bootstrapId) return;

    const at = typeof payload.at === "string" ? payload.at : new Date().toISOString();
    const elapsedMs = typeof payload.elapsedMs === "number" && Number.isFinite(payload.elapsedMs)
      ? Math.max(0, Math.round(payload.elapsedMs))
      : null;
    const stageDurationMs = typeof payload.stageDurationMs === "number" && Number.isFinite(payload.stageDurationMs)
      ? Math.max(0, Math.round(payload.stageDurationMs))
      : null;
    const rawMetadata = payload.metadata && typeof payload.metadata === "object"
      ? payload.metadata as Record<string, unknown>
      : null;
    const metadata: Record<string, boolean | string | null> = {};
    for (const key of ["ready", "state", "needAuthentication", "failed", "restart"] as const) {
      const value = rawMetadata?.[key];
      if (typeof value === "boolean" || typeof value === "string" || value === null) {
        metadata[key] = value;
      }
    }
    state.bootstrapStages[payload.stage] = {
      at,
      elapsedMs,
      stageDurationMs,
      ...(Object.keys(metadata).length > 0 ? { metadata } : {})
    };
    console.info(
      `[whatsapp-web][bootstrap-profile] attempt=${state.generationId} bootstrap=${payload.bootstrapId} stage=${payload.stage} elapsedMs=${String(elapsedMs)} stageDurationMs=${String(stageDurationMs)}`
    );
  });
  diagnosticClient.on("connexa:bootstrap-performance", (payload) => {
    if (
      !isCurrentClient() ||
      typeof payload?.bootstrapId !== "string" ||
      typeof payload?.stage !== "string" ||
      !payload.snapshot ||
      typeof payload.snapshot !== "object" ||
      state.bootstrapProfileId !== payload.bootstrapId
    ) {
      return;
    }
    const at = typeof payload.at === "string" ? payload.at : new Date().toISOString();
    const elapsedMs = typeof payload.elapsedMs === "number" && Number.isFinite(payload.elapsedMs)
      ? Math.max(0, Math.round(payload.elapsedMs))
      : null;
    state.bootstrapPerformance[payload.stage] = {
      at,
      elapsedMs,
      snapshot: payload.snapshot as Record<string, unknown>
    };
    console.info(
      `[whatsapp-web][bootstrap-performance] attempt=${state.generationId} bootstrap=${payload.bootstrapId} stage=${payload.stage} elapsedMs=${String(elapsedMs)}`
    );
  });
  diagnosticClient.on("connexa:authentication-stage", (payload) => {
    if (!isCurrentClient() || typeof payload?.stage !== "string") return;
    const at = typeof payload.at === "string" ? payload.at : new Date().toISOString();
    const elapsedMs = state.authenticatedMonotonicAt
      ? Math.max(0, Math.round(performance.now() - state.authenticatedMonotonicAt))
      : null;
    state.authenticationStages[payload.stage] = { at, elapsedMs };
    console.info(
      `[whatsapp-web][authentication-profile] attempt=${state.generationId} stage=${payload.stage} elapsedMs=${String(elapsedMs)}`
    );
  });

  boundClient.on("qr", async (qr) => {
    if (!isCurrentClient()) {
      return;
    }

    // QR references can arrive late while the browser switches out of the
    // unpaired state. Authentication is monotonic for a runtime generation:
    // never let a late QR resurrect an expired/scannable UI after acceptance.
    if (["AUTHENTICATED", "CONNECTED", "READY", "SYNCING_HISTORY"].includes(state.connectionStatus)) {
      return;
    }

    if (state.restoredFromSession && state.wasPreviouslyConnected) {
      await markWhatsAppRuntimeReauthRequired({
        workspaceId: state.workspaceId,
        channelId: state.channelId,
        errorCode: "RESTORED_SESSION_REQUIRES_REAUTH"
      });
      await teardownActiveRuntimeStateSerialized(state);
      return;
    }

    const qrReceivedMonotonicAt = performance.now();
    console.info(`[whatsapp-web][event] workspace=${state.workspaceId} channel=${state.channelId} qr`);
    state.qrCodeDataUrl = await QRCode.toDataURL(qr);
    if (!isCurrentClient()) return;
    state.qrCodeGeneratedAt = Date.now();
    state.qrVersion += 1;
    updateRuntimeStatus(state, "QR_READY");
    state.lastError = null;
    const qrGeneratedAt = new Date(state.qrCodeGeneratedAt);
    const qrExpiresAt = new Date(state.qrCodeGeneratedAt + getWhatsAppQrMaxAgeMs());
    const requestToQrMs = Math.max(0, Math.round(qrReceivedMonotonicAt - state.pairingRequestedMonotonicAt));
    const runtimeToQrMs = Math.max(0, Math.round(qrReceivedMonotonicAt - state.startupMonotonicAt));
    const qrEncodeMs = Math.max(0, Math.round(performance.now() - qrReceivedMonotonicAt));

    // Runtime state is already authoritative here. Publish first so QR render
    // is independent of PostgreSQL latency; the durable snapshot follows and
    // remains the SSE reconnect/polling fallback.
    emitActiveRuntimeConnection(state, boundClient, {
      connectionStatus: "QR_READY",
      displayName: null,
      phoneNumber: null,
      lastError: null,
      qrCodeDataUrl: state.qrCodeDataUrl,
      qrCodeGeneratedAt: qrGeneratedAt,
      qrCodeExpiresAt: qrExpiresAt,
      qrCodeExpired: false,
      qrVersion: state.qrVersion
    });
    console.info(
      `[whatsapp-web][qr-profile] attempt=${state.generationId} version=${state.qrVersion} requestToQrMs=${requestToQrMs} runtimeToQrMs=${runtimeToQrMs} encodeMs=${qrEncodeMs}`
    );
    if (!state.lastQrEventPersistedAt || Date.now() - state.lastQrEventPersistedAt >= 5 * 60_000) {
      state.lastQrEventPersistedAt = Date.now();
      void logWhatsAppRuntimeEvent({
        workspaceId: state.workspaceId,
        sessionClientId: state.sessionClientId,
        eventType: WHATSAPP_RUNTIME_EVENT_TYPES.QR_READY,
        message: "QR code generated and ready to scan.",
        metadata: {
          channelId: state.channelId,
          connectionAttemptId: state.generationId,
          qrVersion: state.qrVersion,
          generatedAt: qrGeneratedAt.toISOString(),
          requestToQrMs,
          runtimeToQrMs,
          qrEncodeMs,
          initializationStages: state.initializationStages,
          bootstrapStages: state.bootstrapStages,
          bootstrapPerformance: state.bootstrapPerformance
        }
      });
    }

    await saveActiveRuntimeConnection(state, boundClient, {
      connectionStatus: "QR_READY",
      displayName: null,
      phoneNumber: null,
      qrCodeDataUrl: state.qrCodeDataUrl,
      qrCodeUpdatedAt: qrGeneratedAt,
      lastError: null,
      connectedAt: null,
      emitRealtime: false
    });
  });

  boundClient.on("authenticated", async () => {
    if (!isCurrentClient()) {
      return;
    }

    // whatsapp-web.js can repeat lifecycle signals while its browser store is
    // settling. Treat them as level-triggered state, not separate transitions,
    // so rapid UI requests cannot fan out duplicate persistence/sync work.
    if (["AUTHENTICATED", "CONNECTED", "READY", "SYNCING_HISTORY"].includes(state.connectionStatus)) {
      return;
    }

    console.info(
      `[whatsapp-web][event] workspace=${state.workspaceId} session=${state.sessionClientId} authenticated`
    );
    state.qrCodeDataUrl = null;
    state.qrCodeGeneratedAt = null;
    state.authenticatedAt = Date.now();
    state.authenticatedMonotonicAt = performance.now();
    state.authenticatedCpuUsage = process.cpuUsage();
    const authenticatedResourceUsage = process.resourceUsage();
    state.authenticatedResourceUsage = {
      majorPageFault: authenticatedResourceUsage.majorPageFault,
      minorPageFault: authenticatedResourceUsage.minorPageFault,
      maxRSS: authenticatedResourceUsage.maxRSS
    };
    state.authenticatedEventLoopUtilization = performance.eventLoopUtilization();
    state.wwebjsInjectedMonotonicAt = null;
    state.clientInfoMonotonicAt = null;
    updateRuntimeStatus(state, "AUTHENTICATED");
    startPostAuthenticationStageProfiler(state, boundClient);
    state.lastError = null;
    void logWhatsAppRuntimeEvent({
      workspaceId: state.workspaceId,
      sessionClientId: state.sessionClientId,
      eventType: WHATSAPP_RUNTIME_EVENT_TYPES.AUTHENTICATED,
      message: "WhatsApp session authenticated.",
      metadata: {
        channelId: state.channelId,
        authenticatedAt: new Date(state.authenticatedAt).toISOString(),
        eventLoopLagP95Ms: getWhatsAppSenderNodeMetrics().process.eventLoopLagP95Ms,
        activeHistoryJobs: getWhatsAppHistoryResourceSnapshot().active
      }
    });

    emitActiveRuntimeConnection(state, boundClient, {
      connectionStatus: "AUTHENTICATED",
      qrCodeDataUrl: null,
      qrCodeGeneratedAt: null,
      qrCodeExpiresAt: null,
      qrCodeExpired: false,
      qrVersion: state.qrVersion,
      lastError: null
    });

    await saveActiveRuntimeConnection(state, boundClient, {
      connectionStatus: "AUTHENTICATED",
      qrCodeDataUrl: null,
      qrCodeUpdatedAt: null,
      lastError: null,
      emitRealtime: false
    });
  });

  boundClient.on("loading_screen", (percent) => {
    if (!isCurrentClient()) return;
    recordLifecycleProgress(state, typeof percent === "number" ? percent : Number(percent));
    console.info(
      `[whatsapp-web][event] workspace=${state.workspaceId} session=${state.sessionClientId} loading_screen=${String(percent)}`
    );
  });

  boundClient.on("change_state", (providerState) => {
    if (!isCurrentClient()) return;
    const classification = classifyWhatsAppWebState(providerState);
    if (classification === "healthy") {
      recordLifecycleProgress(state);
      return;
    }

    if (classification === "reauth-required") {
      void runSerializedChannelLifecycle(state.channelId, async () => {
        if (!isCurrentClient()) return;
        await markWhatsAppRuntimeReauthRequired({
          workspaceId: state.workspaceId,
          channelId: state.channelId,
          errorCode: `PROVIDER_${String(providerState ?? "UNPAIRED")}`
        });
        await teardownRuntimeState(state.channelId);
      }).catch((error) => {
        console.warn(
          `[whatsapp-web][state] workspace=${state.workspaceId} channel=${state.channelId} reauth-transition-failed ${
            error instanceof Error ? error.message : "Unknown state transition error."
          }`
        );
      });
      return;
    }

    // Provider transition events can be noisy during a healthy reconnect.
    // Surface recovery immediately, but reserve the consecutive-failure
    // counter for bounded compound health probes so one slow response cannot
    // inherit event noise and trigger a restart.
    void markWhatsAppRuntimeRecovering({
      workspaceId: state.workspaceId,
      channelId: state.channelId,
      errorCode: `PROVIDER_STATE_${String(providerState ?? "UNKNOWN")}`
    }).catch((error) => {
      console.warn(
        `[whatsapp-web][state] workspace=${state.workspaceId} channel=${state.channelId} health-write-failed ${
          error instanceof Error ? error.message : "Unknown health persistence error."
        }`
      );
    });
  });

  boundClient.on("ready", async () => {
    if (!isCurrentClient()) {
      return;
    }

    if (["CONNECTED", "READY", "SYNCING_HISTORY"].includes(state.connectionStatus)) {
      return;
    }

    clearPostAuthenticationProfileTimer(state);
    const readyMonotonicAt = performance.now();
    if (!state.clientInfoMonotonicAt && state.client.info?.wid?._serialized) {
      state.clientInfoMonotonicAt = readyMonotonicAt;
    }
    const cpuSinceAuthenticated = state.authenticatedCpuUsage
      ? process.cpuUsage(state.authenticatedCpuUsage)
      : null;
    const readyResourceUsage = process.resourceUsage();
    const eventLoopSinceAuthenticated = state.authenticatedEventLoopUtilization
      ? performance.eventLoopUtilization(state.authenticatedEventLoopUtilization)
      : null;
    console.info(
      `[whatsapp-web][event] workspace=${state.workspaceId} session=${state.sessionClientId} ready`
    );
    clearBackgroundSyncTimer(state);
    state.qrCodeDataUrl = null;
    state.qrCodeGeneratedAt = null;
    updateRuntimeStatus(state, "CONNECTED");
    state.lastError = null;
    state.historySyncStartedAt = Date.now();
    state.historySyncProgressAt = Date.now();
    // Notification reconciliation is intentionally separate from QR/client state.
    state.notificationState = "RECONCILING";
    state.reconciliationStartedAt = Date.now();
    state.liveWatermarkAt = null;
    state.historyRetryDelayMs = WHATSAPP_HISTORY_RETRY_BASE_MS;
    touchRuntimeActivity(state);
    const previousSupervisorState = getRuntimeSupervisorStatus(state.workspaceId, state.channelId);
    recordRuntimeReady(state.workspaceId, state.channelId);
    recordRuntimeReadyMetric({
      workspaceId: state.workspaceId,
      sessionClientId: state.sessionClientId,
      wasColdStart: true
    });
    const readyAt = Date.now();
    const readyMetrics = getWhatsAppSenderNodeMetrics();
    void logWhatsAppRuntimeEvent({
      workspaceId: state.workspaceId,
      sessionClientId: state.sessionClientId,
      eventType: WHATSAPP_RUNTIME_EVENT_TYPES.READY,
      message: "WhatsApp runtime became ready.",
      metadata: {
        readyAt: new Date(readyAt).toISOString(),
        channelId: state.channelId,
        connectionAttemptId: state.generationId,
        authenticatedToReadyMs: state.authenticatedAt ? Math.max(0, readyAt - state.authenticatedAt) : null,
        authenticatedToReadyMonotonicMs: state.authenticatedMonotonicAt
          ? Math.max(0, Math.round(readyMonotonicAt - state.authenticatedMonotonicAt))
          : null,
        helperInjectionAfterAuthenticatedMs:
          state.authenticatedMonotonicAt && state.wwebjsInjectedMonotonicAt
            ? Math.max(0, Math.round(state.wwebjsInjectedMonotonicAt - state.authenticatedMonotonicAt))
            : null,
        accountMetadataAfterAuthenticatedMs:
          state.authenticatedMonotonicAt && state.clientInfoMonotonicAt
            ? Math.max(0, Math.round(state.clientInfoMonotonicAt - state.authenticatedMonotonicAt))
            : null,
        listenerAttachmentApproximationMs: state.clientInfoMonotonicAt
          ? Math.max(0, Math.round(readyMonotonicAt - state.clientInfoMonotonicAt))
          : null,
        eventLoopUtilization: eventLoopSinceAuthenticated
          ? Math.round(eventLoopSinceAuthenticated.utilization * 10_000) / 10_000
          : null,
        cpuUserMs: cpuSinceAuthenticated ? Math.round(cpuSinceAuthenticated.user / 1000) : null,
        cpuSystemMs: cpuSinceAuthenticated ? Math.round(cpuSinceAuthenticated.system / 1000) : null,
        majorPageFaults: state.authenticatedResourceUsage
          ? Math.max(0, readyResourceUsage.majorPageFault - state.authenticatedResourceUsage.majorPageFault)
          : null,
        minorPageFaults: state.authenticatedResourceUsage
          ? Math.max(0, readyResourceUsage.minorPageFault - state.authenticatedResourceUsage.minorPageFault)
          : null,
        maxRssKb: readyResourceUsage.maxRSS,
        eventLoopLagP95Ms: readyMetrics.process.eventLoopLagP95Ms,
        activeHistoryJobs: readyMetrics.historySynchronization.active,
        activeChromiumProcesses: readyMetrics.runtimes.activeChromiumProcesses,
        rssMb: readyMetrics.process.rssMb,
        initializationStages: state.initializationStages,
        bootstrapStages: state.bootstrapStages,
        bootstrapPerformance: state.bootstrapPerformance,
        authenticationStages: state.authenticationStages
      }
    });
    if (previousSupervisorState.requiresManualAttention || previousSupervisorState.recentAutoRecoveryCount > 0) {
      void logWhatsAppRuntimeEvent({
        workspaceId: state.workspaceId,
        sessionClientId: state.sessionClientId,
        eventType: WHATSAPP_RUNTIME_EVENT_TYPES.SUPERVISOR_RESUMED,
        message: "WhatsApp runtime recovered and cleared the supervisor attention state."
      });
    }

    const connectedAt = new Date(readyAt);
    emitActiveRuntimeConnection(state, boundClient, {
      connectionStatus: "CONNECTED",
      displayName: state.client.info?.pushname ?? null,
      phoneNumber: toPhoneNumber(state.client.info?.wid?._serialized),
      connectedAt,
      qrCodeDataUrl: null,
      qrCodeGeneratedAt: null,
      qrCodeExpiresAt: null,
      qrCodeExpired: false,
      qrVersion: state.qrVersion,
      lastError: null
    });

    await saveActiveRuntimeConnection(state, boundClient, {
      connectionStatus: "CONNECTED",
      displayName: state.client.info?.pushname ?? null,
      phoneNumber: toPhoneNumber(state.client.info?.wid?._serialized),
      qrCodeDataUrl: null,
      qrCodeUpdatedAt: null,
      lastError: null,
      connectedAt,
      emitRealtime: false
    });

    await setWhatsAppRuntimeDesiredState({
      workspaceId: state.workspaceId,
      channelId: state.channelId,
      desiredState: "RUNNING",
      healthStatus: "RECOVERING"
    });
    void probeRuntimeHealth(state);

    scheduleBackgroundSync(state, WHATSAPP_BOOTSTRAP_START_DELAY_MS, "bootstrap");
  });

  boundClient.on("auth_failure", async (message) => {
    if (!isCurrentClient()) {
      return;
    }

    console.warn(
      `[whatsapp-web][event] workspace=${state.workspaceId} session=${state.sessionClientId} auth_failure: ${message}`
    );
    if (classifyWhatsAppAuthenticationFailure(message) === "temporary-runtime") {
      const temporaryError = `Temporary WhatsApp authentication interruption: ${message}`;
      clearBackgroundSyncTimer(state);
      state.qrCodeDataUrl = null;
      state.qrCodeGeneratedAt = null;
      state.lastError = temporaryError;
      updateRuntimeStatus(state, "INITIALIZING");
      await saveActiveRuntimeConnection(state, boundClient, {
        connectionStatus: "INITIALIZING",
        qrCodeDataUrl: null,
        qrCodeUpdatedAt: null,
        lastError: temporaryError
      });
      await runSerializedChannelLifecycle(state.channelId, async () => {
        if (!isCurrentClient()) return;
        await restartRuntimePreservingSession(state, temporaryError, {
          trigger: "temporary-authentication-failure"
        });
      });
      return;
    }

    clearBackgroundSyncTimer(state);
    updateRuntimeStatus(state, "AUTH_FAILED");
    state.lastError = message;
    state.qrCodeDataUrl = null;
    state.qrCodeGeneratedAt = null;
    const supervisorStatus = recordRuntimeAuthFailure(state.workspaceId, message, state.channelId);
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

    await saveActiveRuntimeConnection(state, boundClient, {
      connectionStatus: "AUTH_FAILED",
      qrCodeDataUrl: null,
      qrCodeUpdatedAt: null,
      lastError: message
    });
    await markWhatsAppRuntimeReauthRequired({
      workspaceId: state.workspaceId,
      channelId: state.channelId,
      errorCode: "AUTHENTICATION_FAILED"
    });
    await teardownActiveRuntimeStateSerialized(state);
  });

  boundClient.on("disconnected", async (reason) => {
    await runSerializedChannelLifecycle(state.channelId, async () => {
      if (!isCurrentClient()) {
        return;
      }

      console.warn(
        `[whatsapp-web][event] workspace=${state.workspaceId} session=${state.sessionClientId} disconnected: ${String(reason)}`
      );
      clearBackgroundSyncTimer(state);
      updateRuntimeStatus(state, "DISCONNECTED");
      state.lastError = String(reason);
      state.qrCodeDataUrl = null;
      state.qrCodeGeneratedAt = null;
      state.notificationState = "DISCONNECTED";
      recordRuntimeDisconnected(state.workspaceId, state.channelId);
      void logWhatsAppRuntimeEvent({
        workspaceId: state.workspaceId,
        sessionClientId: state.sessionClientId,
        eventType: WHATSAPP_RUNTIME_EVENT_TYPES.DISCONNECTED,
        message: String(reason)
      });
      await teardownRuntimeState(state.channelId);

      if (isSessionInvalidationDisconnectReason(reason)) {
        // A provider LOGOUT/UNPAIRED signal is not sufficient authority to erase
        // LocalAuth. WhatsApp Web can emit it during transient state changes, and
        // deleting the directory here turns a recoverable browser reconnect into
        // a mandatory QR relink. Preserve credentials, retry within the existing
        // supervisor budget, and reserve credential deletion for the explicit
        // disconnect/reset actions initiated by a user or platform admin.
        await markWhatsAppRuntimeReauthRequired({
          channelId: state.channelId,
          workspaceId: state.workspaceId,
          errorCode: "SESSION_INVALIDATED"
        });
        return;
      }

      await markWhatsAppChannelDisconnected({
        channelId: state.channelId,
        workspaceId: state.workspaceId,
        connectionStatus: "DISCONNECTED",
        lastError: String(reason)
      });

      // Everything not explicitly classified as invalid authentication is a
      // recoverable disconnect. Unknown provider wording must not strand a
      // valid LocalAuth session in DISCONNECTED forever.
      await scheduleRuntimeReconnect(state);
    });
  });

  boundClient.on("message", async (message) => {
    if (!isCurrentClient()) {
      return;
    }
    await persistLiveWhatsAppWebMessage(state, message, "message");
  });

  boundClient.on("message_create", async (message) => {
    if (!isCurrentClient() || !message.fromMe) {
      return;
    }

    await persistLiveWhatsAppWebMessage(state, message, "message_create");
  });

  boundClient.on("message_ack", async (message, ack) => {
    if (!isCurrentClient()) {
      return;
    }
    await persistLiveWhatsAppWebMessageAck(state, message, ack);
  });

  boundClient.on("message_reaction", async (reaction: Reaction) => {
    if (!isCurrentClient()) {
      return;
    }
    try {
      await captureWhatsAppReactionEnvelope({
        workspaceId: state.workspaceId,
        channelId: state.channelId,
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

async function persistLiveWhatsAppWebMessageAck(state: RuntimeState, message: Message, ack: number) {
  const providerMessageId = getWhatsAppMessageProviderId(message);
    console.info(
      `[whatsapp-web][message_ack] received workspace=${state.workspaceId} channel=${state.channelId} hasProviderId=${String(Boolean(providerMessageId))} ack=${ack} fromMe=${String(message.fromMe)}`
    );

  if (!providerMessageId || !isActiveRuntimeState(state) || !message.fromMe || isStatusLikeMessage(message)) {
    console.info(
      `[whatsapp-web][message_ack] skipped workspace=${state.workspaceId} active=${String(isActiveRuntimeState(state))} fromMe=${String(message.fromMe)} statusLike=${String(isStatusLikeMessage(message))}`
    );
    return;
  }

  try {
    const result = await persistWhatsAppMessageAck({
      workspaceId: state.workspaceId,
      channelId: state.channelId,
      providerMessageId,
      ack,
      occurredAt: new Date()
    });

    if (result?.changed) {
      console.info(
        `[whatsapp-web][message_ack] workspace=${state.workspaceId} ack=${result.ack} status=${result.deliveryStatus}`
      );
    } else {
      console.info(
        `[whatsapp-web][message_ack] unchanged workspace=${state.workspaceId} ack=${ack}`
      );
    }
    touchRuntimeActivity(state);
  } catch (error) {
    console.warn(
      `[whatsapp-web][message_ack] failed workspace=${state.workspaceId}: ${
        error instanceof Error ? error.message : "Unknown ack persistence error."
      }`
    );
  }
}

async function persistLiveWhatsAppWebMessage(
  state: RuntimeState,
  message: Message,
  eventName: "message" | "message_create"
) {
  const messageData = message as Message & {
    _data?: {
      notifyName?: string;
      subtype?: string;
      recipients?: unknown[];
    };
    rawData?: unknown;
  };

  try {
    const providerMessageId = getWhatsAppMessageProviderId(message);
    const remoteId = message.fromMe ? message.to : message.from;
    const chat = await message.getChat().catch(() => null);
    mergeHistoryChatIntoWorklist(state, chat);
    const messageContact = await message.getContact().catch(() => null);
    const remoteContact =
      message.fromMe && remoteId
        ? await state.client.getContactById(remoteId).catch(() => null)
        : null;
    const contact = message.fromMe ? remoteContact ?? messageContact : messageContact;
    // For an inbound group message, `message.getContact()` is its sender.
    // Read the chat contact separately so avatar resolution targets the group.
    const groupChatContact =
      isGroupRemoteId(remoteId) && chat ? await chat.getContact().catch(() => null) : null;
    const groupAuthorId =
      isGroupRemoteId(remoteId) ? (message as Message & { author?: string | null }).author?.trim() || null : null;
    const groupAuthorContact = groupAuthorId
      ? await state.client.getContactById(groupAuthorId).catch(() => null)
      : null;
    const contactSnapshot = serializeWhatsAppContactSnapshot(contact);

    if (
      isStatusLikeMessage(message) ||
      isStatusLikeRemoteId(remoteId) ||
      isStatusLikeRemoteId(chat?.id?._serialized)
    ) {
      return;
    }

    if (!providerMessageId) {
      console.warn(
        `[whatsapp-web][${eventName}] skipped malformed WhatsApp message without provider id workspace=${state.workspaceId}`
      );
      return;
    }
    // Only a message first observed on the live `message` path can notify.
    // This is evaluated before persistence so replayed history keeps syncing
    // normally while its realtime event is explicitly notification-suppressed.
    const notificationDecision = classifyNotificationEligibility({
      provider: "personal-whatsapp-web",
      state: state.notificationState,
      eventPath: eventName,
      providerMessageId,
      fromMe: message.fromMe,
      messageType: message.type,
      messageTimestampMs: message.timestamp ? message.timestamp * 1000 : null,
      liveWatermarkAt: state.liveWatermarkAt
    });
    const notificationEligible = notificationDecision.eligible
      ? await reservePersonalWhatsAppNotification({
          workspaceId: state.workspaceId,
          channelId: state.channelId,
          chatId: remoteId ?? "unknown",
          fingerprint: notificationDecision.deduplicationKey!,
          kind: "LIVE_MESSAGE"
        }).catch(() => false)
      : false;

    const resolvedIdentity = await resolveIncomingContactIdentity({
      workspaceId: state.workspaceId,
      client: state.client,
      remoteId,
      notifyName: messageData._data?.notifyName ?? null,
      fallbackId: message.fromMe ? message.to : message.from,
      contact: groupChatContact ?? contact,
      profileContact: groupAuthorContact,
      profileContactId: groupAuthorId,
      // Only the separately resolved chat contact is safe here. The ordinary
      // message contact is a participant for inbound group messages.
      groupContactName: groupChatContact?.name,
      chat
    });
    if (
      isConnectedAccountIdentity({
        client: state.client,
        remoteId,
        phone: resolvedIdentity.phone,
        isSelfContact: contact?.isMe
      })
    ) {
      console.info(
        `[whatsapp-web][${eventName}] skipped self-chat workspace=${state.workspaceId} remoteId=${remoteId ?? "unknown"}`
      );
      return;
    }
    const existingRemoteIdentity = message.fromMe
      ? await findExistingConversationIdentityForRemote({
          workspaceId: state.workspaceId,
          channelId: state.channelId,
          remoteId
        })
      : null;
    const isGroupConversation = isGroupRemoteId(remoteId);
    const shouldRefreshGroupTitle =
      isGroupConversation && isUsableGroupTitle(resolvedIdentity.displayName, remoteId);
    const storedGroupTitle =
      isGroupConversation && isUsableGroupTitle(existingRemoteIdentity?.displayName, remoteId)
        ? existingRemoteIdentity?.displayName
        : null;
    const effectiveIdentity = existingRemoteIdentity
      ? {
          ...resolvedIdentity,
          // A previously stored numeric group id must not mask a title that
          // becomes available with a later live message or metadata refresh.
          displayName: shouldRefreshGroupTitle
            ? resolvedIdentity.displayName
            : storedGroupTitle ?? resolvedIdentity.displayName,
          phone: existingRemoteIdentity.phone ?? resolvedIdentity.phone,
          // Group avatars belong to the chat. Do not retain a previously
          // stored participant avatar when the chat avatar cannot be read.
          photoUrl: isGroupConversation ? resolvedIdentity.photoUrl : existingRemoteIdentity.photoUrl ?? resolvedIdentity.photoUrl
        }
      : resolvedIdentity;

    logProfilePhotoResult({
      source: message.fromMe ? "sync" : "inbound",
      displayName: effectiveIdentity.displayName,
      phone: effectiveIdentity.phone,
      photoUrl: resolvedIdentity.primaryPhotoUrl,
      fallbackPhotoUrl: resolvedIdentity.fallbackPhotoUrl,
      bridgePhotoUrl: resolvedIdentity.bridgePhotoUrl
    });

    const groupNotification = await resolveWhatsAppGroupNotificationMetadata(
      state.client,
      message,
      groupAuthorContact
    );
    const mediaAttachment = await extractIncomingMediaAttachment({
      workspaceId: state.workspaceId,
      providerMessageId,
      message
    });
    const baseMessageRawPayload = messageData.rawData
      ? mergeRawPayloadContactSnapshot(messageData.rawData, contactSnapshot)
      : {
          source: eventName,
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
    const messageRawPayload =
      baseMessageRawPayload && typeof baseMessageRawPayload === "object" && !Array.isArray(baseMessageRawPayload)
        ? {
            ...(baseMessageRawPayload as Record<string, unknown>),
            ...(groupNotification ? { groupNotification } : {})
          }
        : groupNotification
          ? { rawPayload: baseMessageRawPayload ?? null, groupNotification }
          : baseMessageRawPayload;
    const body = message.body?.trim();
    let ingestedMessage:
      | Awaited<ReturnType<typeof ingestWhatsAppClientMessage>>
      | null = null;
    let existingStoredMessage:
      | Awaited<ReturnType<typeof findStoredWhatsAppWebMessageLink>>
      | null = null;

    if (message.fromMe) {
      existingStoredMessage = await linkRunningOutboundWhatsAppMessage({
        workspaceId: state.workspaceId,
        channelId: state.channelId,
        conversationId: existingRemoteIdentity?.conversationId,
        providerMessageId,
        body: body ?? "",
        attachmentName: mediaAttachment?.attachmentName ?? null,
        hasUnresolvedMedia: Boolean(
          !mediaAttachment?.attachmentUrl &&
            (message.hasMedia || ["audio", "document", "image", "ptt", "video"].includes(message.type))
        )
      });
    }

    if (!existingStoredMessage && (body || mediaAttachment?.attachmentUrl || groupNotification)) {
      try {
        ingestedMessage = await ingestWhatsAppClientMessage({
          workspaceId: state.workspaceId,
          channelId: state.channelId,
          providerMessageId,
          direction: message.fromMe ? "OUTBOUND" : "INBOUND",
          mediaAssetId: mediaAttachment?.mediaAssetId ?? null,
          attachmentMimeType: mediaAttachment?.attachmentMimeType ?? null,
          attachmentName: mediaAttachment?.attachmentName ?? null,
          attachmentUrl: mediaAttachment?.attachmentUrl ?? null,
          body: body ?? "",
          phone: effectiveIdentity.phone ?? undefined,
          displayName: effectiveIdentity.displayName ?? undefined,
          whatsappPushName: effectiveIdentity.whatsappPushName ?? undefined,
          // A group must never inherit its latest sender's avatar. Clearing an
          // unavailable group photo is safer than retaining a stale one.
          photoUrl: isGroupConversation ? effectiveIdentity.photoUrl : effectiveIdentity.photoUrl ?? undefined,
          sentAt: message.timestamp ? new Date(message.timestamp * 1000) : new Date(),
          notificationEligible,
          rawPayload: messageRawPayload
        });
      } catch (ingestError) {
        if (
          ingestError instanceof Error &&
          ingestError.message === "This inbound message has already been processed."
        ) {
          existingStoredMessage = await findStoredWhatsAppWebMessageLink({
            workspaceId: state.workspaceId,
            providerMessageId
          });
        } else {
          console.warn(
            `[whatsapp-web][${eventName}][ingest] skipped business ingest: ${
              ingestError instanceof Error ? ingestError.message : "Unknown ingest error."
            }`
          );
        }
      }
    }

    await captureWhatsAppMessageEnvelope({
      workspaceId: state.workspaceId,
      channelId: state.channelId,
      message,
      providerMessageId,
      rawData: messageRawPayload,
      conversationId: ingestedMessage?.conversationId ?? existingStoredMessage?.conversationId ?? null,
      storedMessageId: ingestedMessage?.messageId ?? existingStoredMessage?.messageId ?? null
    });
    if (message.fromMe && typeof message.ack === "number") {
      console.info(
        `[whatsapp-web][${eventName}] bootstrap-ack workspace=${state.workspaceId} ack=${message.ack}`
      );
      await persistWhatsAppMessageAck({
        workspaceId: state.workspaceId,
        channelId: state.channelId,
        providerMessageId,
        ack: message.ack,
        occurredAt: message.timestamp ? new Date(message.timestamp * 1000) : new Date()
      }).catch(() => null);
    }
    touchRuntimeActivity(state);
  } catch (error) {
    console.warn(
      `[whatsapp-web][${eventName}] skipped envelope capture ${getWhatsAppMessageProviderId(message) ?? "unknown"} for workspace ${state.workspaceId}: ${
        error instanceof Error ? error.message : "Unknown capture error."
      }`
    );
  }
}

async function findStoredWhatsAppWebMessageLink(input: {
  workspaceId: string;
  providerMessageId: string;
}) {
  const existingMessage = await prisma.message.findFirst({
    where: {
      providerMessageId: input.providerMessageId,
      conversation: {
        workspaceId: input.workspaceId
      }
    },
    select: {
      id: true,
      conversationId: true
    }
  });

  return existingMessage
    ? {
        conversationId: existingMessage.conversationId,
        messageId: existingMessage.id
    }
    : null;
}

async function findExistingConversationIdentityForRemote(input: {
  workspaceId: string;
  channelId?: string | null;
  remoteId?: string | null;
}) {
  const remoteId = input.remoteId?.trim();
  if (!remoteId) {
    return null;
  }

  const conversation = await prisma.conversation.findFirst({
    where: {
      workspaceId: input.workspaceId,
      ...(input.channelId ? { channelId: input.channelId } : {}),
      whatsAppRemoteId: remoteId
    },
    select: {
      id: true,
      contact: {
        select: {
          displayName: true,
          phone: true,
          photoUrl: true
        }
      }
    },
    orderBy: {
      updatedAt: "desc"
    }
  });

  return conversation
    ? {
        conversationId: conversation.id,
        ...conversation.contact
      }
    : null;
}

async function linkRunningOutboundWhatsAppMessage(input: {
  workspaceId: string;
  channelId: string;
  conversationId?: string | null;
  providerMessageId: string;
  body: string;
  attachmentName: string | null;
  hasUnresolvedMedia: boolean;
}) {
  const recentlyCreatedAfter = new Date(Date.now() - 2 * 60 * 1000);
  const recentlyDueAfter = new Date(Date.now() - 2 * 60 * 1000);
  const recentlyDueBefore = new Date();
  let pendingJob = await prisma.outboundMessageJob.findFirst({
    where: {
      body: input.body,
      OR: [
        { createdAt: { gte: recentlyCreatedAfter } },
        { availableAt: { gte: recentlyDueAfter, lte: recentlyDueBefore } }
      ],
      workspaceId: input.workspaceId,
      channelId: input.channelId,
      ...(input.conversationId ? { conversationId: input.conversationId } : {}),
      status: { in: [OutboundMessageJobStatus.RUNNING, OutboundMessageJobStatus.PENDING] },
      availableAt: { lte: new Date() },
      message: {
        providerMessageId: null,
        direction: MessageDirection.OUTBOUND,
        ...(input.attachmentName ? { attachmentName: input.attachmentName } : {})
      }
    },
    select: {
      messageId: true,
      conversationId: true
    },
    orderBy: {
      createdAt: "desc"
    }
  });

  // WhatsApp can emit an outbound media event after its blob is no longer
  // downloadable. Link it to Connexa's recent local upload so audio, images,
  // and documents do not appear as a second attachment-less placeholder.
  if (!pendingJob && input.hasUnresolvedMedia) {
    pendingJob = await prisma.outboundMessageJob.findFirst({
      where: {
        OR: [
          { createdAt: { gte: recentlyCreatedAfter } },
          { availableAt: { gte: recentlyDueAfter, lte: recentlyDueBefore } }
        ],
        workspaceId: input.workspaceId,
        channelId: input.channelId,
        ...(input.conversationId ? { conversationId: input.conversationId } : {}),
        message: {
          providerMessageId: null,
          direction: MessageDirection.OUTBOUND,
          attachmentUrl: { not: null }
        }
      },
      select: {
        messageId: true,
        conversationId: true
      },
      orderBy: {
        createdAt: "desc"
      }
    });
  }

  // `sendMessage()` can resolve as accepted before whatsapp-web.js exposes an
  // id. The worker deliberately finalizes that ambiguous send instead of
  // retrying it. If the authoritative message_create event arrives shortly
  // afterwards, recover the missing id without sending another message.
  if (!pendingJob) {
    pendingJob = await prisma.outboundMessageJob.findFirst({
      where: {
        body: input.body,
        OR: [
          { createdAt: { gte: recentlyCreatedAfter } },
          { availableAt: { gte: recentlyDueAfter, lte: recentlyDueBefore } }
        ],
        workspaceId: input.workspaceId,
        channelId: input.channelId,
        ...(input.conversationId ? { conversationId: input.conversationId } : {}),
        status: OutboundMessageJobStatus.SENT,
        lastError: { startsWith: "[ACCEPTED_UNTRACKED]" },
        message: {
          providerMessageId: null,
          direction: MessageDirection.OUTBOUND,
          deliveryStatus: "accepted_untracked",
          ...(input.attachmentName ? { attachmentName: input.attachmentName } : {})
        }
      },
      select: { messageId: true, conversationId: true },
      orderBy: { createdAt: "desc" }
    });
  }

  if (!pendingJob) {
    return null;
  }
  const pendingMessage = { id: pendingJob.messageId, conversationId: pendingJob.conversationId };

  const linked = await prisma.$transaction(async (tx) => {
    const updatedMessage = await tx.message.updateMany({
      where: {
        id: pendingMessage.id,
        providerMessageId: null
      },
      data: {
        providerMessageId: input.providerMessageId,
        deliveryStatus: "pending"
      }
    });
    if (!updatedMessage.count) return false;

    await tx.outboundMessageJob.updateMany({
      where: {
        messageId: pendingMessage.id
      },
      data: {
        status: OutboundMessageJobStatus.SENT,
        lockedAt: null,
        lastError: null
      }
    });
    return true;
  });

  if (linked) {
    // The web worker can receive the sendMessage rejection a moment after the
    // definitive message_create event and otherwise overwrite SENT with a
    // retry. Re-apply the confirmation after that race window.
    setTimeout(() => {
      void prisma.outboundMessageJob.updateMany({
        where: {
          messageId: pendingMessage.id,
          status: {
            in: [OutboundMessageJobStatus.RUNNING, OutboundMessageJobStatus.PENDING]
          }
        },
        data: {
          status: OutboundMessageJobStatus.SENT,
          lockedAt: null,
          lastError: null
        }
      });
    }, 1_500);
  }

  return linked
    ? {
        conversationId: pendingMessage.conversationId,
        messageId: pendingMessage.id
      }
    : null;
}

async function initializeRuntime(state: RuntimeState) {
  if (!state.initializing) {
    state.initializing = (async () => {
      const maxAttempts = 3;

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          console.info(
            `[whatsapp-web][runtime] workspace=${state.workspaceId} session=${state.sessionClientId} initialize:start attempt=${attempt}`
          );
          await initializeClientWithTimeout(state);
          console.info(
            `[whatsapp-web][runtime] workspace=${state.workspaceId} session=${state.sessionClientId} initialize:returned attempt=${attempt}`
          );
          return;
        } catch (error) {
          if (isChromiumProfileLockError(error)) {
            console.warn(
              `[whatsapp-web][runtime] workspace=${state.workspaceId} session=${state.sessionClientId} initialize:profile-lock attempt=${attempt}`
            );
            const lockResolution = clearStaleChromiumProfileLocks(
              getSessionAuthPath(state.sessionClientId)
            );
            if (lockResolution.state !== "stale-cleared") {
              throw createProfileLockInterventionError(
                state.sessionClientId,
                lockResolution.state === "active" ? "active" : "unverifiable"
              );
            }

            try {
              await initializeClientWithTimeout(state);
              console.info(
                `[whatsapp-web][runtime] workspace=${state.workspaceId} session=${state.sessionClientId} initialize:returned-after-lock-clear attempt=${attempt}`
              );
              return;
            } catch (retryError) {
              if (isChromiumProfileLockError(retryError)) {
                const retryResolution = clearStaleChromiumProfileLocks(
                  getSessionAuthPath(state.sessionClientId)
                );
                throw createProfileLockInterventionError(
                  state.sessionClientId,
                  retryResolution.state === "active" ? "active" : "unverifiable"
                );
              }

              throw retryError;
            }
          }

          if (attempt < maxAttempts && shouldRetryInitializeError(error)) {
            console.warn(
              `[whatsapp-web][runtime] workspace=${state.workspaceId} session=${state.sessionClientId} initialize:retry attempt=${attempt} reason=${
                error instanceof Error ? error.message : "Unknown initialize error."
              }`
            );
            await new Promise((resolve) => setTimeout(resolve, WHATSAPP_BROWSER_RETRY_DELAY_MS));
            await replaceRuntimeClient(state);
            recordLifecycleProgress(state);
            continue;
          }

          throw error;
        }
      }
    })().catch(async (error: unknown) => {
      const message =
        error instanceof Error ? error.message : "Unable to initialize WhatsApp client.";
      if (message.startsWith("WHATSAPP_CHROMIUM_PROFILE_LOCK_REQUIRES_INTERVENTION:")) {
        recordRuntimeInterventionRequired(state.workspaceId, message, state.channelId);
      }
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

        await saveWhatsAppChannelConnection({
          channelId: state.channelId,
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

      await saveWhatsAppChannelConnection({
        channelId: state.channelId,
        workspaceId: state.workspaceId,
        agentId: state.agentId,
        sessionClientId: state.sessionClientId,
        connectionStatus: "ERROR",
        lastError: state.lastError
      });

      // Initialization exhaustion, including a profile lock, is recoverable
      // without deleting LocalAuth or claiming that the phone must relink.
      // Persist the retry so a process restart cannot reset the backoff.
      await scheduleRuntimeReconnect(
        state,
        isTransientBrowserExecutableError(error)
          ? WHATSAPP_BROWSER_RETRY_DELAY_MS
          : WHATSAPP_RECONNECT_BASE_MS
      );

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
  channelId: string;
  agentId: string;
  sessionClientId: string;
  generationId: string;
  restoredFromSession?: boolean;
  wasPreviouslyConnected?: boolean;
  initialHistorySyncCompleted?: boolean;
  pairingRequestedMonotonicAt?: number;
}) {
  const state: RuntimeState = {
    client: createWhatsAppClient(input.sessionClientId),
    generationId: input.generationId,
    agentId: input.agentId,
    workspaceId: input.workspaceId,
    channelId: input.channelId,
    sessionClientId: input.sessionClientId,
    restoredFromSession: Boolean(input.restoredFromSession),
    wasPreviouslyConnected: Boolean(input.wasPreviouslyConnected),
    initializing: null,
    qrCodeDataUrl: null,
    qrCodeGeneratedAt: null,
    qrVersion: 0,
    connectionEventSequence: 0,
    connectionUpdatedAt: new Date().toISOString(),
    lastQrEventPersistedAt: null,
    connectionStatus: "INITIALIZING",
    lastError: null,
    isSyncingHistory: false,
    hasCompletedInitialSync: Boolean(input.initialHistorySyncCompleted),
    historySyncFullyCaughtUp: false,
    historySyncCompletedAt: null,
    historySyncCursor: 0,
    historySyncTotal: null,
    historySyncProgressAt: null,
    historyChatWorklist: [],
    historyChatWorklistBuiltAt: null,
    historyPairingPriorityDeferredAt: null,
    historyAttemptedUnseenChatIds: new Set<string>(),
    historyTimedOutChatIds: new Set<string>(),
    deferredHistoryChatIds: [],
    historySyncStartedAt: null,
    historyRetryDelayMs: WHATSAPP_HISTORY_RETRY_BASE_MS,
    browserStoreHydrationFailures: 0,
    backgroundSyncTimer: null,
    historyRecoveryTimer: null,
    historySyncWatchdogTimer: null,
    historySyncAttemptId: 0,
    historyOperationFence: 0,
    statusUpdatedAt: Date.now(),
    stallRecoveryTimer: null,
    idleEvictionTimer: null,
    lastActivityAt: Date.now(),
    lifecycleProgressAt: Date.now(),
    loadingPercent: null,
    notificationState: "STARTING",
    startupStartedAt: Date.now(),
    startupMonotonicAt: performance.now(),
    pairingRequestedMonotonicAt: input.pairingRequestedMonotonicAt ?? performance.now(),
    authenticatedAt: null,
    authenticatedMonotonicAt: null,
    authenticatedCpuUsage: null,
    authenticatedResourceUsage: null,
    authenticatedEventLoopUtilization: null,
    wwebjsInjectedMonotonicAt: null,
    clientInfoMonotonicAt: null,
    postAuthenticationProfileTimer: null,
    initializationStages: {},
    bootstrapProfileId: null,
    bootstrapStages: {},
    bootstrapPerformance: {},
    authenticationStages: {},
    reconciliationStartedAt: null,
    liveWatermarkAt: null,
    pendingHistoricalUnreadChats: new Map()
  };

  bindClientEvents(state);
  runtimeStates.set(buildRuntimeKey(input.channelId), state);
  recordRuntimeStartMetric({
    workspaceId: input.workspaceId,
    sessionClientId: input.sessionClientId,
    runtimeStatus: "INITIALIZING"
  });
  updateRuntimeStatus(state, "INITIALIZING");

  await saveWhatsAppChannelConnection({
    channelId: input.channelId,
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
  channelId: string,
  create: (generationId: string) => Promise<RuntimeState | null>
) {
  const runtimeKey = buildRuntimeKey(channelId);
  const existing = runtimeStates.get(runtimeKey);

  if (existing?.client && !shouldRecycleRuntimeState(existing)) {
    return existing;
  }

  if (existing) {
    const recycleReason = !existing.client
      ? "missing-client"
      : runtimeRecoveryTimers.has(existing.channelId)
        ? "pending-reconnect"
        : isUnrecoverableRuntimeStatus(existing.connectionStatus)
          ? `status-${existing.connectionStatus.toLowerCase()}`
          : `stalled-${existing.connectionStatus.toLowerCase()}`;
    console.warn(
      `[whatsapp-web][runtime] workspace=${existing.workspaceId} session=${existing.sessionClientId} recycle ${recycleReason}`
    );
    void logWhatsAppRuntimeEvent({
      workspaceId: existing.workspaceId,
      sessionClientId: existing.sessionClientId,
      eventType: WHATSAPP_RUNTIME_EVENT_TYPES.RUNTIME_RECYCLED,
      message: `Recycling stale WhatsApp runtime (${recycleReason}).`,
      metadata: {
        recycleReason,
        connectionStatus: existing.connectionStatus,
        statusAgeMs: Date.now() - existing.statusUpdatedAt,
        lastActivityAgeMs: Date.now() - existing.lastActivityAt
      }
    });
    await teardownRuntimeState(channelId);
  }

  if (existing && !existing.client) {
    runtimeStates.delete(runtimeKey);
  }

  const pending = runtimeCreations.get(runtimeKey);
  if (pending && isCurrentRuntimeGeneration(channelId, pending.generationId)) {
    return pending.promise;
  }
  if (pending) {
    runtimeCreations.delete(runtimeKey);
  }

  // Serialize runtime creation per workspace so polling and boot restore do not
  // race each other into duplicate Chromium sessions.
  const generationId = createRuntimeGeneration(channelId);
  const promise = create(generationId);
  const creation = { generationId, promise };
  runtimeCreations.set(runtimeKey, creation);
  void promise.then(
    () => {
      if (runtimeCreations.get(runtimeKey) === creation) runtimeCreations.delete(runtimeKey);
    },
    () => {
      if (runtimeCreations.get(runtimeKey) === creation) runtimeCreations.delete(runtimeKey);
    }
  );
  return promise;
}

async function ensureWorkspaceWhatsAppClientUnlocked(input: {
  workspaceId: string;
  channelId?: string | null;
  agentId: string;
  source?: "external" | "auto";
  initialHistorySyncCompleted?: boolean;
  selectedChannel?: WorkspaceWhatsAppChannelStatus | null;
  pairingRequestedMonotonicAt?: number;
}) {
  const selectedChannel = input.selectedChannel ?? (input.channelId
    ? await getWhatsAppChannelStatusById(input.channelId)
    : await getWorkspaceWhatsAppChannelStatus(input.workspaceId));
  const channel = selectedChannel?.workspaceId === input.workspaceId ? selectedChannel : null;
  if (!channel) {
    return null;
  }

  await setWhatsAppRuntimeDesiredState({
    workspaceId: input.workspaceId,
    channelId: channel.id,
    desiredState: "RUNNING",
    healthStatus: "RECOVERING"
  });

  return getOrCreateRuntime(channel.id, async (generationId) => {
    const sessionClientId =
      channel?.sessionClientId && channel.connectedByAgentId === input.agentId
        ? channel.sessionClientId
        : buildSessionClientId(input.workspaceId, channel.id, input.agentId);
    // History state is loaded from its durable checkpoint immediately before
    // background synchronization. A channel-wide message count here delayed
    // Chromium/QR startup and provided no authentication correctness.
    const hasImportedHistory = input.initialHistorySyncCompleted ?? channel.connectionStatus === "READY";

    return createRuntimeState({
      workspaceId: input.workspaceId,
      channelId: channel.id,
      agentId: input.agentId,
      sessionClientId,
      generationId,
      restoredFromSession: false,
      wasPreviouslyConnected: Boolean(channel.connectedAt),
      initialHistorySyncCompleted: hasImportedHistory,
      pairingRequestedMonotonicAt: input.pairingRequestedMonotonicAt
    });
  });
}

export async function ensureWorkspaceWhatsAppClient(input: {
  workspaceId: string;
  channelId?: string | null;
  agentId: string;
  source?: "external" | "auto";
  initialHistorySyncCompleted?: boolean;
}) {
  const pairingRequestedMonotonicAt = performance.now();
  const selectedChannel = input.channelId
    ? await getWhatsAppChannelStatusById(input.channelId)
    : await getWorkspaceWhatsAppChannelStatus(input.workspaceId);
  const channel = selectedChannel?.workspaceId === input.workspaceId ? selectedChannel : null;
  if (!channel) return null;

  return runSerializedChannelLifecycle(channel.id, () =>
    ensureWorkspaceWhatsAppClientUnlocked({
      ...input,
      channelId: channel.id,
      selectedChannel: channel,
      pairingRequestedMonotonicAt
    })
  );
}

/**
 * Additive phone-pairing operation for an already managed personal WhatsApp
 * Web runtime. It intentionally reuses the existing channel client and does
 * not alter QR listeners, QR state, or session persistence.
 */
export async function requestWhatsAppWebClientPairingCode(input: {
  workspaceId: string;
  agentId: string;
  channelId: string;
  phoneNumber: string;
}) {
  const runtime = await ensureWorkspaceWhatsAppClient(input);
  if (!runtime?.client) {
    throw new Error("WHATSAPP_PHONE_PAIRING_CLIENT_UNAVAILABLE");
  }

  if (typeof runtime.client.requestPairingCode !== "function") {
    throw new Error("WHATSAPP_PHONE_PAIRING_UNSUPPORTED_VERSION");
  }

  // whatsapp-web.js only registers this page callback during initialization
  // when `pairWithPhoneNumber` is configured. Connexa deliberately keeps the
  // established QR initialization path unchanged, so add the no-op return
  // bridge only for this additive request. Without it WhatsApp can accept the
  // request (and notify the phone) before whatsapp-web.js throws because the
  // callback is absent, leaving the UI without the generated code.
  const pairingPage = runtime.client.pupPage;
  if (!pairingPage) {
    throw new Error("WHATSAPP_PHONE_PAIRING_CLIENT_UNAVAILABLE");
  }

  const pairingModuleDeadline = Date.now() + 20_000;
  let pairingModuleReady = false;
  while (Date.now() < pairingModuleDeadline) {
    pairingModuleReady = await pairingPage.evaluate(() => {
      const pairingWindow = window as Window & {
        AuthStore?: {
          PairingCodeLinkUtils?: unknown;
          AppState?: unknown;
        };
      };
      return Boolean(
        pairingWindow.AuthStore?.PairingCodeLinkUtils && pairingWindow.AuthStore?.AppState
      );
    });
    if (pairingModuleReady) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!pairingModuleReady) {
    throw new Error("WHATSAPP_PHONE_PAIRING_CLIENT_PREPARING");
  }

  await pairingPage.evaluate((bridgeKey) => {
    const pairingWindow = window as unknown as Window & {
      onCodeReceivedEvent?: (code: unknown) => string;
      [key: string]: unknown;
    };
    pairingWindow.onCodeReceivedEvent = (code: unknown) => {
      const pairingCode = typeof code === "string" ? code.trim() : "";
      if (pairingCode) {
        pairingWindow[bridgeKey] = pairingCode;
      }
      return pairingCode;
    };
  }, PHONE_PAIRING_CODE_BRIDGE_KEY);

  let pairingCode: string | null = null;
  try {
    pairingCode = await runtime.client.requestPairingCode(input.phoneNumber);
  } catch (error) {
    // A few WhatsApp Web builds can deliver the code to the page and then
    // reject their minified request promise. Recover only that in-memory code;
    // never retry the provider call because it may already have been accepted.
    pairingCode = await pairingPage
      .evaluate((bridgeKey) => {
        const pairingWindow = window as unknown as Window & { [key: string]: unknown };
        const recoveredCode = pairingWindow[bridgeKey];
        delete pairingWindow[bridgeKey];
        return typeof recoveredCode === "string" ? recoveredCode : null;
      }, PHONE_PAIRING_CODE_BRIDGE_KEY)
      .catch(() => null);
    if (!pairingCode) {
      throw error;
    }
  } finally {
    await pairingPage
      .evaluate((bridgeKey) => {
        const pairingWindow = window as unknown as Window & {
          codeInterval?: number;
          [key: string]: unknown;
        };
        if (typeof pairingWindow.codeInterval === "number") {
          clearInterval(pairingWindow.codeInterval);
          delete pairingWindow.codeInterval;
        }
        delete pairingWindow[bridgeKey];
      }, PHONE_PAIRING_CODE_BRIDGE_KEY)
      .catch(() => null);
  }

  if (typeof pairingCode !== "string" || !pairingCode.trim()) {
    throw new Error("WHATSAPP_PHONE_PAIRING_CODE_UNAVAILABLE");
  }

  return pairingCode.trim();
}

async function restoreWorkspaceWhatsAppClientUnlocked(workspaceId: string, channelId?: string | null) {
  const selectedChannel = channelId
    ? await getWhatsAppChannelStatusById(channelId)
    : await getWorkspaceWhatsAppChannelStatus(workspaceId);
  const channel = selectedChannel?.workspaceId === workspaceId ? selectedChannel : null;
  if (
    !channel?.connectedByAgentId ||
    !channel.sessionClientId ||
    channel.runtimeDesiredState !== "RUNNING" ||
    channel.runtimeHealthStatus === "REAUTH_REQUIRED"
  ) {
    return null;
  }

  return getOrCreateRuntime(channel.id, async (generationId) => {
    if (!channel?.connectedByAgentId || !channel.sessionClientId) {
      return null;
    }

    // Do not delay browser restoration with a channel-wide message count.
    // syncWorkspaceHistoryWithinBudget hydrates this flag from the durable
    // WhatsAppHistorySyncState before choosing a bootstrap/reconcile phase.
    const hasImportedHistory = channel.connectionStatus === "READY";

    return createRuntimeState({
      workspaceId,
      channelId: channel.id,
      agentId: channel.connectedByAgentId,
      sessionClientId: channel.sessionClientId,
      generationId,
      restoredFromSession: true,
      wasPreviouslyConnected: Boolean(channel.connectedAt),
      initialHistorySyncCompleted: hasImportedHistory
    });
  });
}

export async function restoreWorkspaceWhatsAppClient(workspaceId: string, channelId?: string | null) {
  const selectedChannel = channelId
    ? await getWhatsAppChannelStatusById(channelId)
    : await getWorkspaceWhatsAppChannelStatus(workspaceId);
  const channel = selectedChannel?.workspaceId === workspaceId ? selectedChannel : null;
  if (
    !channel?.connectedByAgentId ||
    !channel.sessionClientId ||
    channel.runtimeDesiredState !== "RUNNING" ||
    channel.runtimeHealthStatus === "REAUTH_REQUIRED"
  ) return null;

  return runSerializedChannelLifecycle(channel.id, () =>
    restoreWorkspaceWhatsAppClientUnlocked(workspaceId, channel.id)
  );
}

export async function getWorkspaceWhatsAppRuntimeStatus(input: {
  workspaceId: string;
  channelId?: string | null;
  agentId: string;
}) {
  const selectedChannel = input.channelId
    ? await getWhatsAppChannelStatusById(input.channelId)
    : await getWorkspaceWhatsAppChannelStatus(input.workspaceId);
  const channel = selectedChannel?.workspaceId === input.workspaceId ? selectedChannel : null;
  const persistedHistorySync = channel
    ? await readWhatsAppHistorySyncState({ workspaceId: input.workspaceId, channelId: channel.id }).catch(() => null)
    : null;
  const hydratedRuntime = channel ? runtimeStates.get(buildRuntimeKey(channel.id)) : null;
  const supervisor = getRuntimeSupervisorStatus(input.workspaceId, channel?.id ?? null);
  const runtimePresent = Boolean(hydratedRuntime && isActiveRuntimeState(hydratedRuntime));
  const runtimeStatus = hydratedRuntime?.connectionStatus ?? channel?.connectionStatus ?? "DISCONNECTED";
  const qrPresentation = resolveWhatsAppQrPresentation({
    runtimePresent,
    runtimeStatus,
    qrCodeDataUrl: hydratedRuntime?.qrCodeDataUrl ?? channel?.qrCodeDataUrl,
    qrCodeGeneratedAt: hydratedRuntime?.qrCodeGeneratedAt ?? channel?.qrCodeUpdatedAt
  });
  const userConnectionState = resolveWhatsAppUserConnectionState({
    senderReachable: true,
    runtimePresent,
    runtimeStatus,
    healthStatus: channel?.runtimeHealthStatus,
    lastHealthyAt: channel?.lastHealthyAt
  });
  const derivedHistorySync = persistedHistorySync ?? {
    phase: channel?.runtimeHealthStatus === "RECOVERING"
      ? ("catch_up" as const)
      : runtimePresent && hydratedRuntime?.isSyncingHistory
        ? hydratedRuntime.hasCompletedInitialSync
          ? ("reconcile" as const)
          : ("initial_import" as const)
        : userConnectionState === "connected"
          ? ("idle" as const)
          : ("disconnected" as const),
    active: hydratedRuntime?.isSyncingHistory ?? false,
    startedAt: hydratedRuntime?.historySyncStartedAt
      ? new Date(hydratedRuntime.historySyncStartedAt).toISOString()
      : null,
    progressAt: hydratedRuntime?.historySyncProgressAt
      ? new Date(hydratedRuntime.historySyncProgressAt).toISOString()
      : null,
    completedAt: hydratedRuntime?.historySyncCompletedAt
      ? new Date(hydratedRuntime.historySyncCompletedAt).toISOString()
      : null,
    lastSuccessfulSyncAt: hydratedRuntime?.historySyncCompletedAt
      ? new Date(hydratedRuntime.historySyncCompletedAt).toISOString()
      : null,
    nextReconciliationAt: null,
    totalChats: hydratedRuntime?.historySyncTotal ?? null,
    processedChats: hydratedRuntime?.historySyncCursor ?? 0,
    remainingChats: Math.max(
      0,
      (hydratedRuntime?.historySyncTotal ?? 0) - (hydratedRuntime?.historySyncCursor ?? 0)
    ),
    deferredChats: hydratedRuntime?.deferredHistoryChatIds.length ?? 0,
    newMessages: 0,
    knownMessages: 0,
    updatedMessages: 0,
    skippedMessages: 0,
    mediaDownloadsAvoided: 0,
    mediaBytesDownloaded: 0,
    databaseWritesAvoided: 0,
    lastError: hydratedRuntime?.lastError ?? channel?.lastError ?? null,
    generation: 0
  };

  return {
    channel,
    runtimeStatus,
    runtimePresent,
    connectionAttemptId: hydratedRuntime?.generationId ?? null,
    connectionEventSequence: hydratedRuntime?.connectionEventSequence ?? null,
    connectionUpdatedAt: hydratedRuntime?.connectionUpdatedAt ?? channel?.updatedAt?.toISOString() ?? new Date().toISOString(),
    qrVersion: hydratedRuntime?.qrVersion ?? null,
    userConnectionState,
    runtimeHealthStatus: channel?.runtimeHealthStatus ?? "UNKNOWN",
    lastHealthCheckAt: channel?.latestHealthCheckAt?.toISOString() ?? null,
    lastHealthyAt: channel?.lastHealthyAt?.toISOString() ?? null,
    degradedAt: channel?.runtimeDegradedAt?.toISOString() ?? null,
    nextRecoveryAt: channel?.nextRecoveryAt?.toISOString() ?? null,
    senderReachable: true,
    senderError: null,
    ...qrPresentation,
    lastError:
      hydratedRuntime?.lastError ??
      supervisor.manualAttentionReason ??
      channel?.lastError ??
      null,
    connectedByCurrentAgent: channel?.connectedByAgentId === input.agentId,
    isSyncingHistory: derivedHistorySync.active,
    historySyncFullyCaughtUp:
      derivedHistorySync.phase === "idle" && Boolean(derivedHistorySync.lastSuccessfulSyncAt),
    historySyncCompletedAt: derivedHistorySync.completedAt,
    historySyncCursor: derivedHistorySync.processedChats,
    historySyncTotal: derivedHistorySync.totalChats,
    historySyncProgressAt: derivedHistorySync.progressAt,
    historySync: derivedHistorySync,
    supervisor
  };
}

export function getWhatsAppRuntimeWatchdogSnapshot() {
  return {
    running: healthWatchdogRunning,
    lastStartedAt: healthWatchdogLastStartedAt?.toISOString() ?? null,
    lastCompletedAt: healthWatchdogLastCompletedAt?.toISOString() ?? null,
    lastError: healthWatchdogLastError,
    pendingRecoveryTimers: runtimeRecoveryTimers.size
  };
}

export async function getWhatsAppRuntimeHealthSummary() {
  const rows = await prisma.$queryRaw<Array<{ healthStatus: string; count: bigint }>>`
    SELECT "runtimeHealthStatus" AS "healthStatus", COUNT(*)::bigint AS "count"
    FROM "WhatsAppChannel"
    WHERE ("channelType" = 'web' OR ("channelType" IS NULL AND "phoneNumberId" IS NULL))
    GROUP BY "runtimeHealthStatus"
  `;
  return Object.fromEntries(rows.map((row) => [row.healthStatus, Number(row.count)]));
}

export async function runWhatsAppRuntimeHealthWatchdog() {
  if (healthWatchdogRunning) return getWhatsAppRuntimeWatchdogSnapshot();
  healthWatchdogRunning = true;
  healthWatchdogLastStartedAt = new Date();
  healthWatchdogLastError = null;

  try {
    const channels = await listDesiredWhatsAppRuntimeChannels();
    const concurrency = 3;
    for (let offset = 0; offset < channels.length; offset += concurrency) {
      await Promise.all(
        channels.slice(offset, offset + concurrency).map(async (channel) => {
          if (channel.runtimeHealthStatus === "REAUTH_REQUIRED") return;

          const runtime = runtimeStates.get(buildRuntimeKey(channel.id));
          if (runtime && isActiveRuntimeState(runtime)) {
            if (["CONNECTED", "READY", "SYNCING_HISTORY"].includes(runtime.connectionStatus)) {
              await probeRuntimeHealth(runtime);
            }
            return;
          }

          // Do not keep generating unattended QRs after a sender restart.
          if (
            !channel.connectedAt &&
            ["INITIALIZING", "QR_READY"].includes(channel.connectionStatus)
          ) {
            await markWhatsAppRuntimeReauthRequired({
              workspaceId: channel.workspaceId,
              channelId: channel.id,
              errorCode: "PAIRING_INTERRUPTED"
            });
            return;
          }

          if (channel.nextRecoveryAt && channel.nextRecoveryAt.getTime() > Date.now()) return;
          if (channel.runtimeHealthStatus === "HEALTHY" && !channel.nextRecoveryAt) return;
          await restoreWorkspaceWhatsAppClient(channel.workspaceId, channel.id).catch((error) => {
            // initializeRuntime owns the durable retry schedule. Avoid a
            // second write here that would invalidate its recovery token.
            console.warn(
              `[whatsapp-web][health] workspace=${channel.workspaceId} channel=${channel.id} restore-failed ${
                error instanceof Error ? error.message : "Unknown restore error."
              }`
            );
          });
        })
      );
    }
    healthWatchdogLastCompletedAt = new Date();
  } catch (error) {
    healthWatchdogLastError = error instanceof Error ? error.message : "Unknown watchdog error.";
    throw error;
  } finally {
    healthWatchdogRunning = false;
  }

  return getWhatsAppRuntimeWatchdogSnapshot();
}

export async function shutdownAllWhatsAppRuntimes() {
  for (const [channelId] of runtimeRecoveryTimers) clearReconnectTimer(channelId);
  const states = Array.from(runtimeStates.values());
  await Promise.allSettled(
    states.map((state) =>
      runSerializedChannelLifecycle(state.channelId, async () => {
        if (isActiveRuntimeState(state)) await teardownRuntimeState(state.channelId);
      })
    )
  );
}

async function disconnectWorkspaceWhatsAppClientUnlocked(workspaceId: string, channelId?: string | null) {
  const selectedChannel = channelId
    ? await getWhatsAppChannelStatusById(channelId)
    : await getWorkspaceWhatsAppChannelStatus(workspaceId);
  const channel = selectedChannel?.workspaceId === workspaceId ? selectedChannel : null;
  if (!channel) {
    return;
  }

  clearReconnectTimer(channel.id);
  await setWhatsAppRuntimeDesiredState({
    workspaceId,
    channelId: channel.id,
    desiredState: "STOPPED",
    healthStatus: "STOPPED"
  });
  await teardownRuntimeState(channel.id);
  clearRuntimeSupervisorState(workspaceId, channel.id);

  await markWhatsAppChannelDisconnected({
    channelId: channel.id,
    workspaceId,
    connectionStatus: "DISCONNECTED",
    lastError: null
  });
}

export async function disconnectWorkspaceWhatsAppClient(workspaceId: string, channelId?: string | null) {
  const selectedChannel = channelId
    ? await getWhatsAppChannelStatusById(channelId)
    : await getWorkspaceWhatsAppChannelStatus(workspaceId);
  const channel = selectedChannel?.workspaceId === workspaceId ? selectedChannel : null;
  if (!channel) return;
  await runSerializedChannelLifecycle(channel.id, () =>
    disconnectWorkspaceWhatsAppClientUnlocked(workspaceId, channel.id)
  );
}

export async function freshStartWorkspaceWhatsAppClient(input: {
  workspaceId: string;
  channelId: string;
  agentId: string;
}) {
  const pairingRequestedMonotonicAt = performance.now();
  const channel = await getWhatsAppChannelStatusById(input.channelId);
  if (!channel || channel.workspaceId !== input.workspaceId) return null;

  return runSerializedChannelLifecycle(channel.id, async () => {
    clearReconnectTimer(channel.id);
    await setWhatsAppRuntimeDesiredState({
      workspaceId: input.workspaceId,
      channelId: channel.id,
      desiredState: "STOPPED",
      healthStatus: "STOPPED"
    });
    await teardownRuntimeState(channel.id, { invalidateSession: true });
    await deleteWhatsAppSession({
      workspaceId: input.workspaceId,
      channelId: channel.id,
      authPath: channel.sessionClientId ? getSessionAuthPath(channel.sessionClientId) : null
    });
    clearRuntimeSupervisorState(input.workspaceId, channel.id);
    return ensureWorkspaceWhatsAppClientUnlocked({
      workspaceId: input.workspaceId,
      channelId: channel.id,
      agentId: input.agentId,
      pairingRequestedMonotonicAt
    });
  });
}

export async function deleteWorkspaceWhatsAppClientSession(workspaceId: string, channelId?: string | null) {
  const candidateChannel = channelId ? await getWhatsAppChannelStatusById(channelId) : null;
  const selectedChannel = candidateChannel?.workspaceId === workspaceId ? candidateChannel : null;
  const channels = channelId ? (selectedChannel ? [selectedChannel] : []) : await getWorkspaceWhatsAppChannels(workspaceId);
  if (!channels.length) return;

  for (const channel of channels) {
    await runSerializedChannelLifecycle(channel.id, async () => {
      clearReconnectTimer(channel.id);
      await setWhatsAppRuntimeDesiredState({
        workspaceId,
        channelId: channel.id,
        desiredState: "STOPPED",
        healthStatus: "STOPPED"
      });
      await teardownRuntimeState(channel.id, { invalidateSession: true });
      await deleteWhatsAppSession({
        workspaceId,
        channelId: channel.id,
        authPath: channel.sessionClientId ? getSessionAuthPath(channel.sessionClientId) : null
      });
    });
  }
  clearRuntimeSupervisorState(workspaceId, channelId);
}

function getOutboundAttachmentName(attachmentName?: string | null) {
  const normalizedName = attachmentName?.trim();
  if (!normalizedName) {
    return undefined;
  }

  // Attachment names originate from the browser, so discard directory parts
  // before passing metadata to WhatsApp. This also handles Windows-style paths.
  const fileName = normalizedName.replace(/\\/g, "/").split("/").pop()?.trim();
  return fileName || undefined;
}

export async function sendWhatsAppWebMessage(input: {
  workspaceId: string;
  channelId?: string | null;
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
  sendAudioAsVoice?: boolean;
}) {
  const startedAt = Date.now();
  const selectedChannel = input.channelId
    ? await getWhatsAppChannelStatusById(input.channelId)
    : await getWorkspaceWhatsAppChannelStatus(input.workspaceId);
  const channel = selectedChannel?.workspaceId === input.workspaceId ? selectedChannel : null;
  if (!channel) {
    throw new Error("WhatsApp channel is not connected for this workspace.");
  }

  const wasColdStart = !hasWarmRuntime(channel.id);
  const runtime = await restoreWorkspaceWhatsAppClient(input.workspaceId, channel.id);

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

    if (input.simulateTyping && !channel.incognitoMode) {
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
        providerMessageId: getAcceptedWhatsAppMessageProviderId(sentMessage),
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
        providerMessageId: getAcceptedWhatsAppMessageProviderId(sentMessage),
        status: "accepted" as const
      };
    }

    if (input.attachmentPath || input.attachmentUrl) {
      assertValidVoiceNoteRequest(input);
      const sendAsVoiceNote = shouldSendAsVoiceNote(input);
      // `MessageMedia.fromFilePath` uses the generated storage filename by
      // default (for example `1785226215201-....pdf`).  Always replace that
      // value with the user-uploaded filename before sending to WhatsApp.
      // URL-based sends already receive this option, but local paths are the
      // normal Inbox path and need the same explicit metadata.
      const outboundAttachmentName = getOutboundAttachmentName(input.attachmentName);
      let voiceNoteAsset: Awaited<ReturnType<typeof prepareVoiceNoteAttachment>> | null = null;

      try {
        if (sendAsVoiceNote && input.attachmentPath) {
          voiceNoteAsset = await prepareVoiceNoteAttachment({
            attachmentPath: input.attachmentPath,
            attachmentMimeType: input.attachmentMimeType,
            attachmentName: input.attachmentName
          });
        }

        const media = voiceNoteAsset
          ? MessageMedia.fromFilePath(voiceNoteAsset.path)
          : input.attachmentPath
            ? MessageMedia.fromFilePath(input.attachmentPath)
            : await MessageMedia.fromUrl(input.attachmentUrl!, {
                filename: outboundAttachmentName,
                unsafeMime: true
              });
        if (outboundAttachmentName) {
          media.filename = outboundAttachmentName;
        }
        const sentMessage = await connectedRuntime.client.sendMessage(chatId, media, {
          caption: outgoingBody || undefined,
          mentions: mentionOptions.length ? (mentionOptions as never) : undefined,
          sendAudioAsVoice: sendAsVoiceNote,
          sendMediaAsDocument:
            !(input.attachmentMimeType ?? "").startsWith("image/") && !sendAsVoiceNote,
          quotedMessageId: input.quotedProviderMessageId ?? undefined
        });

        recordSendDurationMetric({
          workspaceId: input.workspaceId,
          durationMs: Date.now() - startedAt,
          wasColdStart
        });
        return {
          providerMessageId: getAcceptedWhatsAppMessageProviderId(sentMessage),
          status: "accepted" as const
        };
      } finally {
        await voiceNoteAsset?.cleanup();
      }
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
      providerMessageId: getAcceptedWhatsAppMessageProviderId(sentMessage),
      status: "accepted" as const
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to send WhatsApp message.";

    if (isStaleWhatsAppRuntimeError(message)) {
      await teardownActiveRuntimeStateSerialized(connectedRuntime);
      throw new Error(
        "WhatsApp client runtime was restarted after a stale-client error. The message will retry automatically."
      );
    }

    throw error;
  }
}

function isStaleWhatsAppRuntimeError(message: string) {
  const normalized = message.toLowerCase();

  return (
    normalized.includes("getchat") ||
    (normalized.includes("cannot read properties of undefined") && normalized.includes("reading 'id'"))
  );
}

export function getWhatsAppSenderNodeMetrics() {
  return {
    ...getWhatsAppSenderNodeMetricsSnapshot({
      activeRuntimes: Array.from(runtimeStates.values()).map((runtime) => ({
        workspaceId: runtime.workspaceId,
        sessionClientId: runtime.sessionClientId,
        connectionStatus: runtime.connectionStatus,
        isSyncingHistory: runtime.isSyncingHistory,
        chromiumPid: runtime.client.pupBrowser?.process()?.pid ?? null
      })),
      supervisorPausedCount: getRuntimeSupervisorPausedCount()
    }),
    historySynchronization: getWhatsAppHistoryResourceSnapshot()
  };
}

export async function deleteWhatsAppWebMessageForEveryone(input: {
  workspaceId: string;
  channelId?: string | null;
  providerMessageId: string;
}) {
  const runtime = await restoreWorkspaceWhatsAppClient(input.workspaceId, input.channelId ?? null);

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
      await teardownActiveRuntimeStateSerialized(runtime);
      throw new Error(
        "WhatsApp client runtime is stale. Disconnect, generate a new QR session, and try again."
      );
    }

    throw error;
  }
}

export async function sendWhatsAppWebChatSeen(input: {
  workspaceId: string;
  channelId?: string | null;
  conversationId: string;
}) {
  if (
    await isWhatsAppChannelIncognitoModeEnabled({
      workspaceId: input.workspaceId,
      channelId: input.channelId ?? null
    })
  ) {
    return { status: "skipped" as const };
  }

  const conversation = await prisma.conversation.findFirst({
    where: {
      id: input.conversationId,
      workspaceId: input.workspaceId
    },
    select: {
      contact: {
        select: {
          phone: true
        }
      }
    }
  });

  if (!conversation?.contact.phone) {
    return { status: "skipped" as const };
  }

  const runtime = await restoreWorkspaceWhatsAppClient(input.workspaceId, input.channelId ?? null);

  if (!runtime) {
    return { status: "skipped" as const };
  }

  const connectedRuntime = await waitForConnectedRuntime(runtime);
  const chatId = await resolveWhatsAppChatId({
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
    to: conversation.contact.phone
  });
  const didSendSeen = await connectedRuntime.client.sendSeen(chatId).catch(() => false);
  if (!didSendSeen) {
    return { status: "skipped" as const };
  }
  touchRuntimeActivity(connectedRuntime);
  return { status: "seen" as const };
}

function resolveMuteExpirationDate(isMuted: boolean, muteExpiration?: number | null) {
  if (!isMuted || typeof muteExpiration !== "number" || !Number.isFinite(muteExpiration) || muteExpiration <= 0) {
    return null;
  }

  const resolvedDate = new Date(muteExpiration > 1_000_000_000_000 ? muteExpiration : muteExpiration * 1000);
  return Number.isNaN(resolvedDate.getTime()) ? null : resolvedDate;
}

export async function setWhatsAppWebChatMute(input: {
  workspaceId: string;
  channelId?: string | null;
  conversationId: string;
  mute: boolean;
  muteUntil?: Date | null;
}) {
  const conversation = await prisma.conversation.findFirst({
    where: {
      id: input.conversationId,
      workspaceId: input.workspaceId
    },
    select: {
      contact: {
        select: {
          phone: true
        }
      }
    }
  });

  if (!conversation?.contact.phone) {
    throw new Error("Conversation phone number was not found.");
  }

  const runtime = await restoreWorkspaceWhatsAppClient(input.workspaceId, input.channelId ?? null);

  if (!runtime) {
    throw new Error("WhatsApp Personal channel is not connected for this workspace.");
  }

  const connectedRuntime = await waitForConnectedRuntime(runtime);
  const chatId = await resolveWhatsAppChatId({
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
    to: conversation.contact.phone
  });
  try {
    const result = input.mute
      ? await connectedRuntime.client.muteChat(chatId, input.muteUntil ?? undefined)
      : await connectedRuntime.client.unmuteChat(chatId);
    touchRuntimeActivity(connectedRuntime);

    return {
      isMuted: Boolean(result.isMuted),
      muteExpiration: resolveMuteExpirationDate(Boolean(result.isMuted), result.muteExpiration)
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update WhatsApp mute state.";

    if (message.includes("getChat")) {
      await teardownActiveRuntimeStateSerialized(runtime);
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

async function reconcilePersonalWhatsAppUnreadNotifications(runtime: RuntimeState) {
  // WhatsApp's unread count is authoritative for historical state. We never
  // call sendSeen or mutate a chat here; this only emits one safe summary.
  for (const [chatId, chat] of runtime.pendingHistoricalUnreadChats) {
    if (chat.unreadCount < 1) continue;
    const fingerprint = `historical:${chat.latestIncomingMessageId ?? "unknown"}:${chat.unreadCount}`;
    const reserved = await reservePersonalWhatsAppNotification({
      workspaceId: runtime.workspaceId,
      channelId: runtime.channelId,
      chatId,
      fingerprint,
      kind: "HISTORICAL_UNREAD"
    }).catch((error) => {
      console.warn(`[whatsapp-web][notification] unread reconciliation skipped workspace=${runtime.workspaceId} channel=${runtime.channelId}: ${error instanceof Error ? error.message : "unknown error"}`);
      return false;
    });
    if (reserved) {
      await dispatchInboxWebPushForHistoricalUnreadSummary({
        workspaceId: runtime.workspaceId,
        conversationId: chat.conversationId,
        unreadCount: chat.unreadCount,
        timestamp: new Date().toISOString()
      }).catch((error) => console.warn(`[whatsapp-web][notification] unread summary dispatch failed workspace=${runtime.workspaceId}: ${error instanceof Error ? error.message : "unknown error"}`));
    }
  }
  runtime.pendingHistoricalUnreadChats.clear();
}

export async function syncWorkspaceHistory(
  workspaceId: string,
  channelIdOrOptions?: string | { triggeredBy?: "manual" | "background"; priority?: "bootstrap" | "incremental" | "routine" | "media" } | null,
  options: { triggeredBy?: "manual" | "background"; priority?: "bootstrap" | "incremental" | "routine" | "media" } = {}
) {
  const channelId = typeof channelIdOrOptions === "string" ? channelIdOrOptions : null;
  const resolvedOptions =
    typeof channelIdOrOptions === "object" && channelIdOrOptions !== null ? channelIdOrOptions : options;
  const targetRuntime = channelId
    ? runtimeStates.get(buildRuntimeKey(channelId)) ?? null
    : Array.from(runtimeStates.values()).find((candidate) => candidate.workspaceId === workspaceId) ?? null;
  if (
    resolvedOptions.triggeredBy === "background" &&
    targetRuntime &&
    shouldDeferHistoryForPairing(targetRuntime)
  ) {
    scheduleBackgroundSync(
      targetRuntime,
      WHATSAPP_PAIRING_HISTORY_DEFERRAL_MS,
      resolvedOptions.priority ?? (targetRuntime.hasCompletedInitialSync ? "routine" : "bootstrap")
    );
    return { importedChats: 0, importedMessages: 0 };
  }
  if (targetRuntime) targetRuntime.historyPairingPriorityDeferredAt = null;

  return runWithWhatsAppHistoryBudget({
    key: `${workspaceId}:${channelId ?? "default"}`,
    accountKey: workspaceId,
    priority: resolvedOptions.priority ?? "routine",
    skippedValue: { importedChats: 0, importedMessages: 0 },
    run: () => syncWorkspaceHistoryWithinBudget(workspaceId, channelIdOrOptions, options)
  });
}

async function syncWorkspaceHistoryWithinBudget(
  workspaceId: string,
  channelIdOrOptions?: string | { triggeredBy?: "manual" | "background"; priority?: "bootstrap" | "incremental" | "routine" | "media" } | null,
  options: { triggeredBy?: "manual" | "background"; priority?: "bootstrap" | "incremental" | "routine" | "media" } = {}
) {
  const channelId = typeof channelIdOrOptions === "string" ? channelIdOrOptions : null;
  const resolvedOptions =
    typeof channelIdOrOptions === "object" && channelIdOrOptions !== null ? channelIdOrOptions : options;
  const runtime = await restoreWorkspaceWhatsAppClient(workspaceId, channelId);

  if (!runtime) {
    throw new Error("WhatsApp channel is not connected for this workspace.");
  }

  if (!runtime.client) {
    await teardownActiveRuntimeStateSerialized(runtime);
    throw new Error("WhatsApp client runtime is stale. Restart the QR session and try syncing again.");
  }

  const connectedRuntime = await waitForConnectedRuntime(runtime);
  touchRuntimeActivity(connectedRuntime);

  if (runtime.isSyncingHistory) {
    return { importedChats: 0, importedMessages: 0 };
  }

  const previousDurableState = await readWhatsAppHistorySyncState({
    workspaceId,
    channelId: runtime.channelId
  }).catch(() => null);
  if (previousDurableState?.lastSuccessfulSyncAt) {
    runtime.hasCompletedInitialSync = true;
    runtime.historySyncFullyCaughtUp = previousDurableState.phase === "idle";
    runtime.historySyncCompletedAt = new Date(previousDurableState.lastSuccessfulSyncAt).getTime();
  }

  const leaseOwnerId = `${process.pid}:${runtime.generationId}`;
  const historyLease = await acquireWhatsAppHistoryLease({
    workspaceId,
    channelId: runtime.channelId,
    ownerId: leaseOwnerId,
    ttlMs: WHATSAPP_HISTORY_LEASE_TTL_MS
  });
  if (!historyLease) {
    return { importedChats: 0, importedMessages: 0 };
  }

  clearBackgroundSyncTimer(runtime);
  clearIdleEvictionTimer(runtime);
  runtime.isSyncingHistory = true;
  runtime.historySyncProgressAt = Date.now();
  updateRuntimeStatus(runtime, "SYNCING_HISTORY");
  scheduleHistorySyncWatchdog(runtime);
  if (!runtime.hasCompletedInitialSync && runtime.historySyncStartedAt === null) {
    runtime.historySyncStartedAt = Date.now();
  }
  let syncCompleted = false;
  let syncFullyCaughtUp = false;
  let shouldRetryInBackground = false;
  let transientSkippedChats = 0;
  let nextRetryDelayMs: number | null = null;
  const configuredIncrementalMode = getWhatsAppIncrementalSyncMode(workspaceId);
  const incrementalMode = incrementalFallbackChannels.has(runtime.channelId) ? "off" : configuredIncrementalMode;
  const syncPhase: Exclude<WhatsAppHistorySyncPhase, "idle" | "deferred" | "error" | "disconnected"> =
    !runtime.hasCompletedInitialSync
      ? previousDurableState?.phase === "fast_bootstrap" ||
        previousDurableState?.phase === "incremental_sync" ||
        previousDurableState?.phase === "initial_import"
        ? "incremental_sync"
        : previousDurableState?.phase === "media_enrichment"
          ? "media_enrichment"
          : "fast_bootstrap"
      : previousDurableState?.phase === "disconnected" || resolvedOptions.triggeredBy === "manual"
        ? "catch_up"
        : "reconcile";
  const isBootstrapPhase = syncPhase === "fast_bootstrap";
  const isMediaEnrichmentPhase = syncPhase === "media_enrichment";
  let nextWorkPriority: "bootstrap" | "incremental" | "routine" | "media" =
    isBootstrapPhase ? "bootstrap" : isMediaEnrichmentPhase ? "media" : runtime.hasCompletedInitialSync ? "routine" : "incremental";
  const batchStartedAt = Date.now();
  let knownMessages = 0;
  let updatedMessages = 0;
  let skippedMessages = 0;
  let mediaDownloadsAvoided = 0;
  let mediaDownloadAttempts = 0;
  let mediaDownloadFailures = 0;
  let mediaBytesDownloaded = 0;
  let databaseWritesAvoided = 0;
  let databaseWriteDurationMs = 0;
  let shadowMissedMessages = 0;
  let shadowIncrementalNewMessages = 0;
  let incompleteHistoryTransfers = 0;
  let fenceTimedOutClient = false;
  let legacySelectedConversations = 0;
  let incrementalSelectedConversations = 0;
  let batchFetchedMessages = 0;
  let batchNewMessages = 0;
  let batchProcessedChats = 0;
  let durableStatusPhase: WhatsAppHistorySyncPhase = "idle";
  let durableLastError: string | null = null;

  const durableSyncState = await startWhatsAppHistorySyncState({
    workspaceId,
    channelId: runtime.channelId,
    phase: syncPhase
  }).catch((error) => {
    console.warn(`[whatsapp-web][sync] unable to persist sync start: ${error instanceof Error ? error.message : "unknown error"}`);
    return null;
  });
  const durableStateGeneration = durableSyncState?.generation ?? 0;
  void logWhatsAppRuntimeEvent({
    workspaceId,
    sessionClientId: runtime.sessionClientId,
    eventType: WHATSAPP_RUNTIME_EVENT_TYPES.HISTORY_JOB_STARTED,
    message: "WhatsApp history work started.",
    metadata: { channelId: runtime.channelId, phase: syncPhase, startedAt: new Date(batchStartedAt).toISOString() }
  });

  try {
    const chats = await retryWhatsAppOperation(() => getHistoryChatWorklist(runtime, connectedRuntime.client)).catch(async (error: unknown) => {
      const message = error instanceof Error ? error.message : "Unable to load WhatsApp chats.";

      if (isTransientWhatsAppSyncError(error)) {
        console.warn(
          `[whatsapp-web][sync] workspace=${workspaceId} chat discovery deferred after a transient browser-store hydration failure`
        );
        throw createBrowserStoreHydrationError(message);
      }

      if (message.includes("getChats")) {
        await teardownActiveRuntimeStateSerialized(runtime);
        throw new Error(
          "WhatsApp client runtime is stale. Disconnect, generate a new QR session, and try syncing again."
        );
      }

      throw error;
    });
    const importableChats = chats
      .filter((chat) => canImportChat(chat))
      .filter(
        (chat) =>
          !isConnectedAccountIdentity({
            client: connectedRuntime.client,
            remoteId: getChatIdentifier(chat)
          })
      )
      // A single historical chat can leave a WhatsApp Web operation pending
      // even while the live session remains healthy. Quarantine it for this
      // runtime after its bounded timeout instead of repeatedly recycling the
      // browser and eventually pausing the whole channel supervisor.
      .filter((chat) => {
        const chatId = getChatIdentifier(chat);
        return !chatId || !runtime.historyTimedOutChatIds.has(chatId);
      })
      .sort((left, right) => getChatSortTimestamp(right) - getChatSortTimestamp(left));
    runtime.browserStoreHydrationFailures = 0;
    const checkpoints = await loadWhatsAppHistoryCheckpoints({
      workspaceId,
      channelId: runtime.channelId
    }).catch(() => new Map());
    const chatSignatures = new Map<string, string>();
    const deepAuditMs = getWhatsAppDeepAuditMs();
    const deepAuditChatIds = new Set<string>();
    for (const chat of importableChats) {
      const remoteChatId = getChatIdentifier(chat);
      if (!remoteChatId) continue;
      chatSignatures.set(
        remoteChatId,
        createWhatsAppChatSignature({
          remoteChatId,
          activityTimestamp: chat.timestamp ?? null,
          unreadCount: chat.unreadCount ?? 0,
          lastProviderMessageId: chat.lastMessage
            ? getWhatsAppMessageProviderId(chat.lastMessage as Message)
            : null,
          archived: Boolean(chat.archived),
          pinned: Boolean(chat.pinned),
          muted: Boolean(chat.isMuted)
        })
      );
    }
    const incrementalCandidates = importableChats.filter((chat) => {
      const remoteChatId = getChatIdentifier(chat);
      if (!remoteChatId) return true;
      const checkpoint = checkpoints.get(remoteChatId) ?? null;
      if (
        checkpoint?.lastSuccessfulReconciliationAt &&
        Date.now() - checkpoint.lastSuccessfulReconciliationAt.getTime() >= deepAuditMs
      ) {
        deepAuditChatIds.add(remoteChatId);
      }
      if (checkpoint?.deferred && checkpoint.retryAt && checkpoint.retryAt.getTime() > Date.now()) {
        return false;
      }
      return shouldReconcileWhatsAppChat({
        checkpoint,
        signature: chatSignatures.get(remoteChatId) ?? remoteChatId,
        deepAuditMs
      });
    });
    legacySelectedConversations = importableChats.length;
    incrementalSelectedConversations = incrementalCandidates.length;
    if (incrementalMode === "shadow") {
      console.info(
        `[whatsapp-web][sync-summary] mode=shadow chats=${importableChats.length} incrementalCandidates=${incrementalCandidates.length} metadataSkipped=${importableChats.length - incrementalCandidates.length}`
      );
    }
    const importedRemoteIds = new Set(
      (
        await prisma.conversation.findMany({
          where: {
            workspaceId,
            channelId: runtime.channelId,
            whatsAppRemoteId: {
              not: null
            }
          },
          select: {
            whatsAppRemoteId: true
          }
        })
      )
        .map((conversation) => conversation.whatsAppRemoteId?.trim() ?? "")
        .filter(Boolean)
    );
    // History cursors are intentionally in memory, but sender restarts must
    // not make newer chats starve conversations that Connexa has never seen.
    // Import unseen chat ids first on every pass; once all conversations exist,
    // the normal cursor resumes scanning their message history.
    const unseenChats = importableChats.filter((chat) => {
      const chatId = getChatIdentifier(chat);
      const checkpoint = chatId ? checkpoints.get(chatId) ?? null : null;
      return Boolean(
        chatId &&
        !importedRemoteIds.has(chatId) &&
        !checkpoint?.initialImportComplete &&
        !runtime.historyAttemptedUnseenChatIds.has(chatId) &&
        !(
          checkpoint?.deferred &&
          checkpoint.retryAt &&
          checkpoint.retryAt.getTime() > Date.now()
        )
      );
    });
    if (unseenChats.length > 0) {
      runtime.historySyncFullyCaughtUp = false;
      runtime.historySyncCompletedAt = null;
    }
    const resumableInitialChats = importableChats.filter((chat) => {
      const remoteChatId = getChatIdentifier(chat);
      const checkpoint = remoteChatId ? checkpoints.get(remoteChatId) ?? null : null;
      return !checkpoint?.initialImportComplete || checkpoint.deferred;
    });
    const routineChatPool = isMediaEnrichmentPhase
      ? importableChats
      : runtime.hasCompletedInitialSync
      ? incrementalMode === "on"
        ? incrementalCandidates
        : importableChats
      : resumableInitialChats;
    const completedInitialChatCount = runtime.hasCompletedInitialSync
      ? 0
      : importableChats.length - resumableInitialChats.length;
    runtime.historySyncTotal = runtime.hasCompletedInitialSync
      ? routineChatPool.length
      : importableChats.length;
    const batchSize = isBootstrapPhase
      ? WHATSAPP_BOOTSTRAP_CHAT_BATCH
      : WHATSAPP_HISTORY_WORK_UNIT_CHATS;
    const isUnseenBatch = !isMediaEnrichmentPhase && unseenChats.length > 0;
    const batchStart = isUnseenBatch || (incrementalMode === "on" && runtime.hasCompletedInitialSync)
      ? 0
      : Math.min(runtime.historySyncCursor, routineChatPool.length);
    const existingDeferredChatIds = new Set(runtime.deferredHistoryChatIds);
    const deferredChats = importableChats.filter((chat) => {
      const chatId = getChatIdentifier(chat);
      return Boolean(chatId && existingDeferredChatIds.has(chatId));
    });
    const isDeferredBatch =
      !isUnseenBatch &&
      batchStart >= importableChats.length &&
      deferredChats.length > 0;
    const chatsToSync = isUnseenBatch
      ? unseenChats.slice(0, batchSize)
      : isDeferredBatch
      ? deferredChats.slice(0, batchSize)
      : routineChatPool.slice(batchStart, batchStart + batchSize);
    console.info(
      `[whatsapp-web][sync] workspace=${workspaceId} discovered=${chats.length} importable=${importableChats.length} unseen=${unseenChats.length} batch=${chatsToSync.length} cursor=${batchStart} deferred=${deferredChats.length}`
    );
    let importedChats = 0;
    let importedMessages = 0;
    const resolvedChatIds = new Set<string>();
    const deferredChatIds = new Set(existingDeferredChatIds);
    const deferredCountBeforeBatch = deferredChatIds.size;
    let processedChatCount = 0;

    await updateWhatsAppHistorySyncProgress({
      workspaceId,
      channelId: runtime.channelId,
      generation: durableStateGeneration,
      totalChats: runtime.historySyncTotal,
      processedChats: completedInitialChatCount,
      remainingChats: routineChatPool.length,
      deferredChats: deferredChats.length,
      newMessages: 0,
      knownMessages: 0,
      skippedMessages: 0,
      mediaDownloadsAvoided: 0
    }).catch(() => null);

    for (const [chatIndex, chat] of chatsToSync.entries()) {
      if (!isActiveRuntimeState(runtime)) {
        return {
          importedChats,
          importedMessages
        };
      }

      const chatId = getChatIdentifier(chat);
      if (chatIndex > 0 && hasInteractiveWhatsAppPairing(runtime.channelId)) {
        shouldRetryInBackground = true;
        nextRetryDelayMs = WHATSAPP_PAIRING_HISTORY_DEFERRAL_MS;
        console.info(
          `[whatsapp-web][sync] workspace=${workspaceId} yielded-after-chat=${chatIndex} for interactive pairing`
        );
        break;
      }
      if (Date.now() - batchStartedAt >= WHATSAPP_HISTORY_BATCH_WALL_MS) {
        shouldRetryInBackground = true;
        nextRetryDelayMs = WHATSAPP_HISTORY_RETRY_BASE_MS;
        break;
      }
      const leaseRenewed = await renewWhatsAppHistoryLease({
        channelId: runtime.channelId,
        ownerId: leaseOwnerId,
        generation: historyLease.generation,
        ttlMs: WHATSAPP_HISTORY_LEASE_TTL_MS
      }).catch(() => false);
      if (!leaseRenewed) {
        durableStatusPhase = "deferred";
        durableLastError = "History synchronization ownership changed; this batch stopped safely.";
        shouldRetryInBackground = true;
        nextRetryDelayMs = WHATSAPP_HISTORY_RETRY_BASE_MS;
        break;
      }
      runtime.historySyncProgressAt = Date.now();
      processedChatCount = chatIndex + 1;
      batchProcessedChats = processedChatCount;
      if (isUnseenBatch && chatId) {
        // Mark chats only when their turn actually begins. A timeout stops the
        // batch, so later unseen chats must remain eligible for the next pass.
        runtime.historyAttemptedUnseenChatIds.add(chatId);
      }
      if (
        isConnectedAccountIdentity({
          client: connectedRuntime.client,
          remoteId: chatId
        })
      ) {
        if (chatId) {
          resolvedChatIds.add(chatId);
        }
        console.info("[whatsapp-web][sync] skipped self-chat");
        continue;
      }
      const fallbackPayload = buildFallbackSyncPayload(chat);
      const operationFence = ++runtime.historyOperationFence;

      try {
        await runWhatsAppHistoryOperation(
          async () => {
        const checkpoint = chatId ? checkpoints.get(chatId) ?? null : null;
        const [historyFetch, contact] = await Promise.all([
          fetchChatMessagesWithRecovery({
            client: connectedRuntime.client,
            chat,
            limit: isBootstrapPhase
              ? WHATSAPP_BOOTSTRAP_MESSAGE_LIMIT
              : Math.max(
              incrementalMode === "on" &&
                runtime.hasCompletedInitialSync &&
                syncPhase === "reconcile" &&
                !deepAuditChatIds.has(chat.id._serialized)
                ? WHATSAPP_INCREMENTAL_OVERLAP_MESSAGES
                : WHATSAPP_HISTORY_SYNC_LIMIT,
              (chat.unreadCount ?? 0) + 20
            )
          }),
          retryWhatsAppOperation(() => chat.getContact()).catch(() => null)
        ]);
        // whatsapp-web.js returns fetched history from oldest to newest. Keep
        // Connexa's import work newest-first so a stopped or deferred batch
        // makes the most useful messages visible before walking backwards.
        const newestFirstMessages = [...historyFetch.messages].sort(
          (left, right) => (right.timestamp ?? 0) - (left.timestamp ?? 0)
        );
        const checkpointBoundaryIndex = checkpoint?.lastProviderMessageId
          ? newestFirstMessages.findIndex(
              (message) => getWhatsAppMessageProviderId(message) === checkpoint.lastProviderMessageId
            )
          : -1;
        const messages =
          incrementalMode === "on" && runtime.hasCompletedInitialSync && checkpointBoundaryIndex >= 0
            ? newestFirstMessages.slice(0, checkpointBoundaryIndex + WHATSAPP_INCREMENTAL_OVERLAP_MESSAGES)
            : newestFirstMessages;
        batchFetchedMessages += historyFetch.messages.length;
        const providerMessageIds = messages
          .map((message) => getWhatsAppMessageProviderId(message))
          .filter((value): value is string => Boolean(value));
        const storedMessages = await loadStoredHistoryMessages({
          workspaceId,
          channelId: runtime.channelId,
          providerMessageIds
        });
        knownMessages += storedMessages.size;
        const contactSnapshot = serializeWhatsAppContactSnapshot(contact);
        const groupAuthorId = isGroupRemoteId(chat.id._serialized)
          ? ((chat.lastMessage as { author?: string | null } | null)?.author?.trim() || null)
          : null;
        const groupAuthorContact = groupAuthorId
          ? await connectedRuntime.client.getContactById(groupAuthorId).catch(() => null)
          : null;
        const resolvedIdentity = await resolveIncomingContactIdentity({
          workspaceId,
          client: connectedRuntime.client,
          remoteId: chat.id._serialized,
          contact,
          profileContact: groupAuthorContact,
          profileContactId: groupAuthorId,
          resolveProfilePhoto: isMediaEnrichmentPhase,
          groupContactName: isGroupRemoteId(chat.id._serialized) ? contact?.name : null,
          chat
        });

        if (
          isConnectedAccountIdentity({
            client: connectedRuntime.client,
            remoteId: chatId,
            phone: resolvedIdentity.phone,
            isSelfContact: contact?.isMe
          })
        ) {
          if (chatId) {
            resolvedChatIds.add(chatId);
          }
          console.info("[whatsapp-web][sync] skipped self-chat");
          return;
        }

        logProfilePhotoResult({
          source: "sync",
          displayName: resolvedIdentity.displayName,
          phone: resolvedIdentity.phone,
          photoUrl: resolvedIdentity.primaryPhotoUrl,
          fallbackPhotoUrl: resolvedIdentity.fallbackPhotoUrl,
          bridgePhotoUrl: resolvedIdentity.bridgePhotoUrl
        });

        if (!resolvedIdentity.phone) {
          if (chatId) {
            deferredChatIds.add(chatId);
            await recordWhatsAppHistoryCheckpointFailure({
              workspaceId,
              channelId: runtime.channelId,
              remoteChatId: chatId,
              retryAt: new Date(Date.now() + WHATSAPP_HISTORY_DEFERRED_RETRY_MS),
              error: chatId.endsWith("@lid")
                ? "Stable phone identity is not available for this LID chat yet."
                : "Stable contact identity is not available for this chat yet."
            }).catch(() => null);
          }
          console.info(`[whatsapp-web][sync] deferred unresolved identity chat=${chatId ?? "unknown"}`);
          return;
        }

        const syncedMessages: Array<{
          author: string | null;
          chatId: string;
          id: string;
          mediaAssetId: string | null;
          attachmentMimeType: string | null;
          attachmentName: string | null;
          attachmentUrl: string | null;
          body: string;
          fromMe: boolean;
          timestamp: number;
          type: string;
          hasMedia: boolean;
          existingMessage: (typeof storedMessages extends Map<string, infer TValue> ? TValue : never) | null;
          rawPayload: Record<string, unknown>;
        }> = [];
        // Deliberately process one message at a time. Besides preserving the
        // requested newest-to-oldest order, this prevents a large chat from
        // launching concurrent media/notification lookups against Chromium.
        for (const message of messages) {
          if (isStatusLikeMessage(message)) {
            continue;
          }

          const providerMessageId = getWhatsAppMessageProviderId(message);
          if (!providerMessageId) {
            continue;
          }

          const storedMessage = storedMessages.get(providerMessageId);
          const storedMediaComplete = message.hasMedia && isStoredHistoryMediaComplete(storedMessage);
          if (storedMediaComplete) {
            mediaDownloadsAvoided += 1;
          } else if (message.hasMedia && isMediaEnrichmentPhase) {
            mediaDownloadAttempts += 1;
          } else if (message.hasMedia) {
            mediaDownloadsAvoided += 1;
          }
          const mediaAttachment = storedMediaComplete
            ? {
                mediaAssetId: storedMessage?.mediaAssetId ?? null,
                attachmentMimeType: storedMessage?.attachmentMimeType ?? null,
                attachmentName: storedMessage?.attachmentName ?? null,
                attachmentUrl: storedMessage?.attachmentUrl ?? storedMessage?.envelopeMediaUrl ?? null,
                downloadedBytes: 0
              }
            : isMediaEnrichmentPhase
            ? await extractIncomingMediaAttachment({
                workspaceId,
                providerMessageId,
                message
              })
            : null;
          if (isMediaEnrichmentPhase && !storedMediaComplete && message.hasMedia && !mediaAttachment) {
            mediaDownloadFailures += 1;
          }
          mediaBytesDownloaded += mediaAttachment?.downloadedBytes ?? 0;

          const rawBody = message.body;
          const mentionMetadata = getMessageMentionMetadata(message);
          const groupNotification = await resolveWhatsAppGroupNotificationMetadata(
            connectedRuntime.client,
            message
          );

          syncedMessages.push({
            author: (message as Message & { author?: string | null }).author ?? null,
            chatId: chat.id._serialized,
            id: providerMessageId,
            mediaAssetId: mediaAttachment?.mediaAssetId ?? null,
            attachmentMimeType: mediaAttachment?.attachmentMimeType ?? null,
            attachmentName: mediaAttachment?.attachmentName ?? null,
            attachmentUrl: mediaAttachment?.attachmentUrl ?? null,
            body: rawBody,
            fromMe: message.fromMe,
            timestamp: message.timestamp,
            type: message.type,
            hasMedia: message.hasMedia,
            existingMessage: storedMessage ?? null,
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
              ...(groupNotification ? { groupNotification } : {}),
              hasMedia: message.hasMedia
            }
          });
        }
        const resolvedSyncedMessages = syncedMessages;
        const normalizedMessages = await normalizeSyncedMessagesWithMentions({
          client: connectedRuntime.client,
          messages: resolvedSyncedMessages
        });

        if (runtime.historyOperationFence !== operationFence || !isActiveRuntimeState(runtime)) {
          throw new Error("History synchronization client-operation fence changed before persistence.");
        }
        const ownsLeaseBeforePersistence = await renewWhatsAppHistoryLease({
          channelId: runtime.channelId,
          ownerId: leaseOwnerId,
          generation: historyLease.generation,
          ttlMs: WHATSAPP_HISTORY_LEASE_TTL_MS
        }).catch(() => false);
        if (!ownsLeaseBeforePersistence) {
          throw new Error("History synchronization lease changed before persistence.");
        }

        const databaseWriteStartedAt = Date.now();
        const result = await syncWhatsAppHistoryConversation({
          workspaceId,
          channelId: runtime.channelId,
          phone: resolvedIdentity.phone,
          displayName: resolvedIdentity.displayName,
          whatsappPushName: resolvedIdentity.whatsappPushName ?? undefined,
          // A group must never inherit its latest sender's avatar. Clearing an
          // unavailable group photo is safer than retaining a stale one.
          photoUrl: isGroupRemoteId(chat.id._serialized) ? resolvedIdentity.photoUrl : resolvedIdentity.photoUrl ?? undefined,
          isMuted: Boolean(chat.isMuted),
          muteExpiration: chat.muteExpiration ?? null,
          isArchived: Boolean(chat.archived),
          isPinned: Boolean(chat.pinned),
          unreadCount: chat.unreadCount,
          messages: normalizedMessages
        });
        databaseWriteDurationMs += Date.now() - databaseWriteStartedAt;
        if (incrementalMode === "shadow" && chatId) {
          const wasIncrementalCandidate = incrementalCandidates.some(
            (candidate) => getChatIdentifier(candidate) === chatId
          );
          shadowIncrementalNewMessages += wasIncrementalCandidate ? result.importedCount : 0;
          shadowMissedMessages += wasIncrementalCandidate ? 0 : result.importedCount;
        }

        if (result.conversationId) {
          importedChats += 1;
          importedMessages += result.importedCount;
          batchNewMessages += result.importedCount;
          updatedMessages += result.updatedCount;
          skippedMessages += result.skippedCount;
          databaseWritesAvoided += result.databaseWritesAvoided;
          const latestIncomingMessageId = resolvedSyncedMessages.find((item) => !item.fromMe)?.id ?? null;
          if ((chat.unreadCount ?? 0) > 0 && chatId) {
            runtime.pendingHistoricalUnreadChats.set(chatId, {
              conversationId: result.conversationId,
              unreadCount: chat.unreadCount ?? 0,
              latestIncomingMessageId
            });
          }
        }

        if (chatId) {
          if (runtime.historyOperationFence !== operationFence || !isActiveRuntimeState(runtime)) {
            throw new Error("History synchronization client-operation fence changed before checkpoint advancement.");
          }
          const ownsLeaseBeforeCheckpoint = await renewWhatsAppHistoryLease({
            channelId: runtime.channelId,
            ownerId: leaseOwnerId,
            generation: historyLease.generation,
            ttlMs: WHATSAPP_HISTORY_LEASE_TTL_MS
          }).catch(() => false);
          if (!ownsLeaseBeforeCheckpoint) {
            throw new Error("History synchronization lease changed before checkpoint advancement.");
          }
          const latestCheckpointMessage = [...normalizedMessages]
            .filter((message) => Boolean(message.id))
            .sort((left, right) => (right.timestamp ?? 0) - (left.timestamp ?? 0))
            .at(0);
          await recordWhatsAppHistoryCheckpointSuccess({
            workspaceId,
            channelId: runtime.channelId,
            remoteChatId: chatId,
            lastProviderMessageId: latestCheckpointMessage?.id ?? null,
            lastMessageTimestamp: latestCheckpointMessage?.timestamp
              ? new Date(latestCheckpointMessage.timestamp * 1000)
              : null,
            lastObservedChatActivityAt: chat.timestamp ? new Date(chat.timestamp * 1000) : null,
            lastChatSignature: chatSignatures.get(chatId) ?? chatId
          }).catch(() => null);
          if (historyFetch.needsRetry) {
            incompleteHistoryTransfers += 1;
            await recordWhatsAppHistoryCheckpointFailure({
              workspaceId,
              channelId: runtime.channelId,
              remoteChatId: chatId,
              retryAt: new Date(Date.now() + WHATSAPP_HISTORY_DEFERRED_RETRY_MS),
              error: historyFetch.recoveryError ?? "WhatsApp history hydration is incomplete."
            }).catch(() => null);
          }
        }

        await updateWhatsAppHistorySyncProgress({
          workspaceId,
          channelId: runtime.channelId,
          generation: durableStateGeneration,
          totalChats: runtime.historySyncTotal,
          processedChats: completedInitialChatCount + processedChatCount,
          remainingChats: Math.max(0, routineChatPool.length - processedChatCount),
          deferredChats: deferredChatIds.size,
          newMessages: importedMessages,
          knownMessages,
          updatedMessages,
          skippedMessages,
          mediaDownloadsAvoided,
          mediaBytesDownloaded,
          databaseWritesAvoided
        }).catch(() => null);

        if (chatId) {
          if (historyFetch.needsRetry) {
            deferredChatIds.add(chatId);
            console.warn(
              `[whatsapp-web][sync] imported ${result.importedCount} message(s) from the available snapshot for chat ${chatId}; queued a full-history retry after WhatsApp Web history loading failed: ${historyFetch.recoveryError ?? "Unknown history loading error."}`
            );
          } else {
            resolvedChatIds.add(chatId);
          }
        }
          },
          `importing history for ${chatId ?? "chat"}`,
          WHATSAPP_HISTORY_CHAT_TIMEOUT_MS
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown WhatsApp sync error.";
        if (chatId) {
          await recordWhatsAppHistoryCheckpointFailure({
            workspaceId,
            channelId: runtime.channelId,
            remoteChatId: chatId,
            retryAt: new Date(Date.now() + WHATSAPP_HISTORY_DEFERRED_RETRY_MS),
            error: message
          }).catch(() => null);
        }

        if (isTransientWhatsAppSyncError(error)) {
          // Promise.race cannot cancel an in-flight Puppeteer evaluation. Stop
          // this batch and quarantine only the offending historical chat. Live
          // messaging remains connected, and the batch watchdog still handles
          // a genuinely wedged browser-wide operation.
          if (isWhatsAppHistoryOperationTimeout(error)) {
            runtime.historyOperationFence += 1;
            fenceTimedOutClient = true;
            transientSkippedChats += 1;
            if (chatId) {
              deferredChatIds.delete(chatId);
              runtime.historyTimedOutChatIds.add(chatId);
            }
            console.warn(
              `[whatsapp-web][sync] workspace=${workspaceId} chat-timeout-quarantined chat=${chatId ?? "unknown"}; live session preserved`
            );
            void logWhatsAppRuntimeEvent({
              workspaceId,
              sessionClientId: runtime.sessionClientId,
              eventType: WHATSAPP_RUNTIME_EVENT_TYPES.HISTORY_CHAT_TIMEOUT,
              message: "A WhatsApp history chat operation timed out and the client was fenced.",
              metadata: { channelId: runtime.channelId, chatId, timeoutMs: WHATSAPP_HISTORY_CHAT_TIMEOUT_MS }
            });
            break;
          }

          let fallbackOutcome: "imported" | "self" | "unavailable" = "unavailable";
          try {
            fallbackOutcome = await runWhatsAppHistoryOperation(
              async () => {
                const fallbackContact = await retryWhatsAppOperation(() => chat.getContact(), 2).catch(() => null);
                const fallbackContactSnapshot = serializeWhatsAppContactSnapshot(fallbackContact);
                const fallbackIdentity = await resolveIncomingContactIdentity({
                  workspaceId,
                  client: connectedRuntime.client,
                  remoteId: chat.id._serialized,
                  contact: fallbackContact,
                  groupContactName: isGroupRemoteId(chat.id._serialized) ? fallbackContact?.name : null,
                  chat
                }).catch(() => null);
                const resolvedFallbackPayload =
                  (await buildResolvedFallbackSyncPayload({
                    client: connectedRuntime.client,
                    serializedId: chat.id?._serialized ?? null,
                    fallbackNumber: fallbackContact?.number ?? null,
                    displayName: resolveIncomingDisplayName({
                      chatName: chat.name,
                      groupSubject: (
                        chat as typeof chat & {
                          formattedTitle?: string | null;
                          groupMetadata?: { subject?: string | null } | null;
                        }
                      ).groupMetadata?.subject,
                      groupContactName: isGroupRemoteId(chat.id._serialized) ? fallbackContact?.name : null,
                      formattedTitle: (chat as typeof chat & { formattedTitle?: string | null }).formattedTitle,
                      phone: fallbackContact?.number ?? null,
                      fallbackId: chat.id?._serialized
                    }),
                    contact: fallbackContactSnapshot,
                    unreadCount: chat.unreadCount,
                    timestamp: chat.timestamp ?? null,
                    lastMessage: chat.lastMessage ?? null
                  })) ?? fallbackPayload;

                if (!resolvedFallbackPayload) {
                  return "unavailable";
                }

                if (
                  isConnectedAccountIdentity({
                    client: connectedRuntime.client,
                    remoteId: chatId,
                    phone: resolvedFallbackPayload.phone,
                    isSelfContact: fallbackContact?.isMe
                  })
                ) {
                  if (chatId) {
                    resolvedChatIds.add(chatId);
                  }
                  console.info("[whatsapp-web][sync] skipped self-chat fallback");
                  return "self";
                }

                const normalizedFallbackMessages = await normalizeSyncedMessagesWithMentions({
                  client: connectedRuntime.client,
                  messages: resolvedFallbackPayload.messages
                });
                if (runtime.historyOperationFence !== operationFence || !isActiveRuntimeState(runtime)) {
                  throw new Error("History synchronization client-operation fence changed before fallback persistence.");
                }
                const ownsLeaseBeforeFallbackPersistence = await renewWhatsAppHistoryLease({
                  channelId: runtime.channelId,
                  ownerId: leaseOwnerId,
                  generation: historyLease.generation,
                  ttlMs: WHATSAPP_HISTORY_LEASE_TTL_MS
                }).catch(() => false);
                if (!ownsLeaseBeforeFallbackPersistence) {
                  throw new Error("History synchronization lease changed before fallback persistence.");
                }
                const fallbackWriteStartedAt = Date.now();
                const fallbackResult = await syncWhatsAppHistoryConversation({
                  workspaceId,
                  channelId: runtime.channelId,
                  phone: resolvedFallbackPayload.phone,
                  displayName: resolvedFallbackPayload.displayName,
                  whatsappPushName: fallbackIdentity?.whatsappPushName ?? undefined,
                  photoUrl: fallbackIdentity?.photoUrl ?? undefined,
                  isMuted: Boolean(chat.isMuted),
                  muteExpiration: chat.muteExpiration ?? null,
                  isArchived: Boolean(chat.archived),
                  isPinned: Boolean(chat.pinned),
                  unreadCount: resolvedFallbackPayload.unreadCount,
                  messages: normalizedFallbackMessages
                });
                databaseWriteDurationMs += Date.now() - fallbackWriteStartedAt;

                if (fallbackResult.conversationId) {
                  importedChats += 1;
                  importedMessages += fallbackResult.importedCount;
                  batchNewMessages += fallbackResult.importedCount;
                  updatedMessages += fallbackResult.updatedCount;
                  skippedMessages += fallbackResult.skippedCount;
                  databaseWritesAvoided += fallbackResult.databaseWritesAvoided;
                  const latestIncomingMessageId = [...normalizedFallbackMessages]
                    .reverse()
                    .find((item) => !item.fromMe)?.id ?? null;
                  if ((resolvedFallbackPayload.unreadCount ?? 0) > 0 && chatId) {
                    runtime.pendingHistoricalUnreadChats.set(chatId, {
                      conversationId: fallbackResult.conversationId,
                      unreadCount: resolvedFallbackPayload.unreadCount ?? 0,
                      latestIncomingMessageId
                    });
                  }
                }

                if (chatId) {
                  deferredChatIds.add(chatId);
                }
                console.warn(
                  `[whatsapp-web][sync] imported fallback snapshot for chat ${chat.id._serialized} after transient load failure; keeping chat deferred for a full retry: ${message}`
                );
                return "imported";
              },
              `recovering fallback history for ${chatId ?? "chat"}`,
              WHATSAPP_HISTORY_CHAT_TIMEOUT_MS
            );
          } catch (fallbackError) {
            console.warn(
              `[whatsapp-web][sync] fallback snapshot import failed for chat ${chat.id._serialized}: ${
                fallbackError instanceof Error ? fallbackError.message : "Unknown fallback import error."
              }`
            );
            if (isWhatsAppHistoryOperationTimeout(fallbackError)) {
              runtime.historyOperationFence += 1;
              fenceTimedOutClient = true;
              transientSkippedChats += 1;
              if (chatId) {
                deferredChatIds.delete(chatId);
                runtime.historyTimedOutChatIds.add(chatId);
              }
              console.warn(
                `[whatsapp-web][sync] workspace=${workspaceId} fallback-timeout-quarantined chat=${chatId ?? "unknown"}; live session preserved`
              );
              void logWhatsAppRuntimeEvent({
                workspaceId,
                sessionClientId: runtime.sessionClientId,
                eventType: WHATSAPP_RUNTIME_EVENT_TYPES.HISTORY_CHAT_TIMEOUT,
                message: "A fallback WhatsApp history operation timed out and the client was fenced.",
                metadata: { channelId: runtime.channelId, chatId, timeoutMs: WHATSAPP_HISTORY_CHAT_TIMEOUT_MS }
              });
              break;
            }
          }

          if (fallbackOutcome === "imported" || fallbackOutcome === "self") {
            continue;
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
      ? routineChatPool.length
      : Math.min(batchStart + processedChatCount, routineChatPool.length);

    if (isUnseenBatch) {
      runtime.historySyncCursor = 0;
    } else if (isMediaEnrichmentPhase) {
      runtime.historySyncCursor = nextCursor;
    } else if (runtime.hasCompletedInitialSync) {
      runtime.historySyncCursor =
        incrementalMode === "on"
          ? 0
          : nextCursor < routineChatPool.length
            ? nextCursor
            : 0;
    } else {
      // Initial-stage pools shrink as checkpoints complete. Always select the
      // next remaining slice from zero so a persisted checkpoint cannot make
      // the cursor skip a conversation in the next short work unit.
      runtime.historySyncCursor = 0;
    }

    const hasMorePrimaryChats = isUnseenBatch
      ? importableChats.length > 0
      : incrementalMode === "on" && runtime.hasCompletedInitialSync
      ? processedChatCount < routineChatPool.length
      : runtime.hasCompletedInitialSync
      ? nextCursor < routineChatPool.length
      : runtime.historySyncCursor < routineChatPool.length;
    const hasDeferredChats = runtime.deferredHistoryChatIds.length > 0;
    if (hasDeferredChats || runtime.historyTimedOutChatIds.size > 0) {
      runtime.historySyncFullyCaughtUp = false;
      runtime.historySyncCompletedAt = null;
    }
    const hasMoreChatsToSync = hasMorePrimaryChats || hasDeferredChats;
    const progressedPrimaryCursor =
      !isUnseenBatch &&
      !isDeferredBatch &&
      nextCursor > batchStart;
    const clearedDeferredChats = runtime.deferredHistoryChatIds.length < deferredCountBeforeBatch;
    const madeProgress =
      importedChats > 0 ||
      importedMessages > 0 ||
      processedChatCount > 0 ||
      progressedPrimaryCursor ||
      clearedDeferredChats;

    // Advancing through chats that WhatsApp Web cannot load is not useful
    // history-import progress. Without this guard, a large account can keep
    // moving the cursor while importing no conversations and look like it is
    // syncing forever. Defer the history pass after the bounded grace period,
    // preserve live messaging, and let the existing recovery retry it later.
    const historyImportElapsedMs =
      runtime.historySyncStartedAt === null ? 0 : Date.now() - runtime.historySyncStartedAt;
    const hasImportedUsableHistory = importedChats > 0 || importedMessages > 0;

    if (
      !runtime.hasCompletedInitialSync &&
      !isMediaEnrichmentPhase &&
      hasMoreChatsToSync &&
      !hasImportedUsableHistory &&
      historyImportElapsedMs >= WHATSAPP_HISTORY_STUCK_MS
    ) {
      // A WhatsApp Web account can expose an otherwise healthy history while
      // one or two old chats never hydrate. Once this channel already has
      // usable imported history, keeping the whole initial pass marked as
      // deferred makes the UI look permanently stuck and resets the same
      // cursor on every retry. Finalize the usable portion, keep the failed
      // chat ids in memory for periodic background attempts, and leave live
      // messaging fully ready. A brand-new channel with no imported history
      // still follows the visible deferred/recovery path below.
      const existingImportedMessageCount = await prisma.message.count({
        where: {
          conversation: {
            workspaceId,
            channelId: runtime.channelId
          }
        }
      });

      if (existingImportedMessageCount > 0) {
        console.warn(
          `[whatsapp-web][sync] workspace=${workspaceId} finalized partial history after ${historyImportElapsedMs}ms; ${runtime.deferredHistoryChatIds.length} chat(s) remain queued for non-blocking retries`
        );
        syncCompleted = true;
        return {
          importedChats,
          importedMessages
        };
      }

      nextRetryDelayMs = deferHistoryImport(runtime);
      durableStatusPhase = "deferred";
      durableLastError = runtime.lastError;
      shouldRetryInBackground = true;
      return {
        importedChats,
        importedMessages
      };
    }

    if (!hasMoreChatsToSync && isBootstrapPhase) {
      durableStatusPhase = "incremental_sync";
      nextWorkPriority = "incremental";
      shouldRetryInBackground = true;
      nextRetryDelayMs = WHATSAPP_HISTORY_RETRY_BASE_MS;
      updateRuntimeStatus(runtime, "READY");
      void logWhatsAppRuntimeEvent({
        workspaceId,
        sessionClientId: runtime.sessionClientId,
        eventType: WHATSAPP_RUNTIME_EVENT_TYPES.HISTORY_BOOTSTRAP_COMPLETED,
        message: "WhatsApp fast bootstrap completed.",
        metadata: { channelId: runtime.channelId, chatsProcessed: batchProcessedChats, newMessages: batchNewMessages }
      });
      return { importedChats, importedMessages };
    }

    if (!hasMoreChatsToSync && syncPhase === "incremental_sync") {
      durableStatusPhase = "media_enrichment";
      nextWorkPriority = "media";
      runtime.historySyncCursor = 0;
      shouldRetryInBackground = true;
      nextRetryDelayMs = WHATSAPP_HISTORY_RETRY_BASE_MS;
      updateRuntimeStatus(runtime, "READY");
      return { importedChats, importedMessages };
    }

    if (!hasMoreChatsToSync) {
      syncCompleted = true;
      syncFullyCaughtUp = runtime.historyTimedOutChatIds.size === 0;
      return {
        importedChats,
        importedMessages
      };
    }

    if (madeProgress) {
      updateRuntimeStatus(runtime, "READY");
      runtime.lastError = null;
      if (isBootstrapPhase) {
        durableStatusPhase = "incremental_sync";
        nextWorkPriority = "incremental";
        runtime.historySyncCursor = 0;
        void logWhatsAppRuntimeEvent({
          workspaceId,
          sessionClientId: runtime.sessionClientId,
          eventType: WHATSAPP_RUNTIME_EVENT_TYPES.HISTORY_FIRST_BATCH_COMPLETED,
          message: "The first WhatsApp history batch completed.",
          metadata: { channelId: runtime.channelId, chatsProcessed: batchProcessedChats, newMessages: batchNewMessages }
        });
        void logWhatsAppRuntimeEvent({
          workspaceId,
          sessionClientId: runtime.sessionClientId,
          eventType: WHATSAPP_RUNTIME_EVENT_TYPES.HISTORY_BOOTSTRAP_COMPLETED,
          message: "WhatsApp fast bootstrap completed.",
          metadata: { channelId: runtime.channelId, chatsProcessed: batchProcessedChats, newMessages: batchNewMessages }
        });
      }
      // Existing chats are a periodic refresh, not an initial-import
      // emergency. Pace large completed accounts between batches so they do
      // not spend nearly all day inside SYNCING_HISTORY. Truly unseen chats
      // still use the short retry delay and are imported promptly.
      nextRetryDelayMs =
        runtime.hasCompletedInitialSync && !isUnseenBatch
          ? incrementalMode === "on"
            ? WHATSAPP_HISTORY_RETRY_BASE_MS
            : getRoutineHistoryDelayMs()
          : WHATSAPP_HISTORY_RETRY_BASE_MS;
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
      if (isWhatsAppHistoryOperationTimeout(error)) {
        runtime.historyOperationFence += 1;
        fenceTimedOutClient = true;
        durableStatusPhase = "deferred";
        durableLastError = "A timed-out WhatsApp history operation was fenced; the sender is restarting safely.";
        return { importedChats: 0, importedMessages: 0 };
      }
      if (isBrowserStoreHydrationError(error)) {
        runtime.browserStoreHydrationFailures += 1;
        if (runtime.browserStoreHydrationFailures >= WHATSAPP_BROWSER_STORE_RECOVERY_THRESHOLD) {
          const reason =
            "WhatsApp browser chat store remained unavailable after repeated retries. Restarting the runtime while preserving the linked session.";
          console.warn(
            `[whatsapp-web][sync] workspace=${workspaceId} restarting stale browser store after ${runtime.browserStoreHydrationFailures} failed chat discoveries`
          );
          await runSerializedChannelLifecycle(runtime.channelId, async () => {
            if (
              !isActiveRuntimeState(runtime) ||
              runtime.browserStoreHydrationFailures < WHATSAPP_BROWSER_STORE_RECOVERY_THRESHOLD
            ) {
              return;
            }
            await restartRuntimePreservingSession(runtime, reason, {
              trigger: "browser-store-hydration-recovery",
              failures: runtime.browserStoreHydrationFailures
            });
          });
          return { importedChats: 0, importedMessages: 0 };
        }
      }
      // All automatic imports are sender-owned. A transient browser timeout
      // must hand back to the same bounded recovery path so a channel can
      // never remain stuck in SYNCING_HISTORY after the UI disconnects.
      const elapsedMs =
        runtime.historySyncStartedAt === null ? 0 : Date.now() - runtime.historySyncStartedAt;
      if (!runtime.hasCompletedInitialSync && !isMediaEnrichmentPhase && elapsedMs >= WHATSAPP_HISTORY_STUCK_MS) {
        // Some old chats fail before the normal end-of-batch finalization
        // branch is reached. Do the same usable-history check here so the
        // recovery watchdog cannot keep restarting a healthy live channel
        // merely because one historical chat never hydrates.
        const existingImportedMessageCount = await prisma.message.count({
          where: {
            conversation: {
              workspaceId,
              channelId: runtime.channelId
            }
          }
        });

        if (existingImportedMessageCount > 0) {
          console.warn(
            `[whatsapp-web][sync] workspace=${workspaceId} finalized partial history after transient sync failure at ${elapsedMs}ms; failed chats remain eligible for periodic non-blocking retries`
          );
          syncCompleted = true;
        } else {
          nextRetryDelayMs = deferHistoryImport(runtime);
          shouldRetryInBackground = true;
        }
      } else {
        runtime.connectionStatus = runtime.hasCompletedInitialSync ? "READY" : "CONNECTED";
        runtime.lastError = null;
        nextRetryDelayMs = getNextHistoryRetryDelay(runtime);
        shouldRetryInBackground = true;
      }
      return { importedChats: 0, importedMessages: 0 };

    }

    if (resolvedOptions.triggeredBy === "background" && isTransientExecutionContextError(error)) {
      runtime.connectionStatus = runtime.hasCompletedInitialSync ? "READY" : "CONNECTED";
      nextRetryDelayMs = getNextHistoryRetryDelay(runtime);
      shouldRetryInBackground = true;
      return { importedChats: 0, importedMessages: 0 };
    }

    // A schema mismatch or another persistent per-batch failure must not leave
    // the channel stored as SYNCING_HISTORY with no retry timer. Live messaging
    // remains available while the bounded background loop retries after the
    // underlying problem is corrected.
    const failureMessage = error instanceof Error ? error.message : "Unknown WhatsApp history error.";
    if (incrementalMode === "on") {
      incrementalFallbackChannels.add(runtime.channelId);
    }
    runtime.connectionStatus = runtime.hasCompletedInitialSync ? "READY" : "CONNECTED";
    runtime.lastError = `Historical import will retry automatically: ${failureMessage}`;
    durableStatusPhase = "error";
    durableLastError = runtime.lastError;
    nextRetryDelayMs = getNextHistoryRetryDelay(runtime);
    shouldRetryInBackground = true;
    console.error(
      `[whatsapp-web][sync] workspace=${workspaceId} historical import failed; live messaging remains available and retry is scheduled: ${failureMessage}`
    );
    return { importedChats: 0, importedMessages: 0 };
  } finally {
    runtime.isSyncingHistory = false;
    clearHistorySyncWatchdogTimer(runtime);
    if (isActiveRuntimeState(runtime)) {
      let scheduledDelayMs: number | null = null;
      if (syncCompleted) {
        if (incrementalMode === "off" && incrementalFallbackChannels.has(runtime.channelId)) {
          incrementalFallbackChannels.delete(runtime.channelId);
        }
        await reconcilePersonalWhatsAppUnreadNotifications(runtime);
        // The watermark is captured after reconciliation. Messages received
        // during it were persisted but suppressed, avoiding history races.
        runtime.liveWatermarkAt = Date.now();
        runtime.notificationState = "LIVE";
        updateRuntimeStatus(runtime, "READY");
        runtime.hasCompletedInitialSync = true;
        if (syncFullyCaughtUp) {
          if (!runtime.historySyncFullyCaughtUp) {
            runtime.historySyncCompletedAt = Date.now();
          }
          runtime.historySyncFullyCaughtUp = true;
        }
        runtime.lastError = null;
        resetHistoryRetryState(runtime);
        await saveWhatsAppChannelConnection({
          channelId: runtime.channelId,
          workspaceId: runtime.workspaceId,
          agentId: runtime.agentId,
          sessionClientId: runtime.sessionClientId,
          connectionStatus: "READY",
          lastError: null
        }).catch(() => null);
        void logWhatsAppRuntimeEvent({
          workspaceId,
          sessionClientId: runtime.sessionClientId,
          eventType: WHATSAPP_RUNTIME_EVENT_TYPES.HISTORY_FULL_SYNC_COMPLETED,
          message: "WhatsApp history synchronization completed.",
          metadata: {
            channelId: runtime.channelId,
            completedAt: new Date().toISOString(),
            durationMs: Date.now() - batchStartedAt,
            fullyCaughtUp: syncFullyCaughtUp
          }
        });
        scheduledDelayMs = getRoutineHistoryDelayMs();
        if (!fenceTimedOutClient) scheduleBackgroundSync(runtime, scheduledDelayMs, "routine");
      }

      if (!syncCompleted) {
        await saveWhatsAppChannelConnection({
          channelId: runtime.channelId,
          workspaceId: runtime.workspaceId,
          agentId: runtime.agentId,
          sessionClientId: runtime.sessionClientId,
          connectionStatus: runtime.connectionStatus,
          lastError: runtime.lastError
        }).catch(() => null);
      }

      if (shouldRetryInBackground && !fenceTimedOutClient) {
        scheduledDelayMs = nextRetryDelayMs ?? runtime.historyRetryDelayMs;
        scheduleBackgroundSync(runtime, scheduledDelayMs, nextWorkPriority);
      }

      const nextScheduledDelay = scheduledDelayMs ?? getRoutineHistoryDelayMs();
      if (durableStatusPhase === "idle") {
        durableStatusPhase = syncCompleted
          ? syncFullyCaughtUp
            ? "idle"
            : "deferred"
          : syncPhase;
      }
      await finishWhatsAppHistorySyncState({
        workspaceId,
        channelId: runtime.channelId,
        generation: durableStateGeneration,
        phase: durableStatusPhase,
        nextReconciliationAt: new Date(Date.now() + nextScheduledDelay),
        lastError: durableLastError ?? runtime.lastError,
        successful: syncCompleted && syncFullyCaughtUp
      }).catch(() => null);

      console.info(
        `[whatsapp-web][sync-summary] mode=${incrementalMode} phase=${durableStatusPhase} durationMs=${Date.now() - batchStartedAt} chatsProcessed=${batchProcessedChats} legacySelectedConversations=${legacySelectedConversations} incrementalSelectedConversations=${incrementalSelectedConversations} messagesFetched=${batchFetchedMessages} knownMessages=${knownMessages} newMessages=${batchNewMessages} shadowIncrementalNewMessages=${shadowIncrementalNewMessages} shadowMissedMessages=${shadowMissedMessages} incompleteHistoryTransfers=${incompleteHistoryTransfers} updatedMessages=${updatedMessages} skippedMessages=${skippedMessages} mediaDownloadAttempts=${mediaDownloadAttempts} mediaDownloadFailures=${mediaDownloadFailures} mediaDownloadsAvoided=${mediaDownloadsAvoided} mediaBytesDownloaded=${mediaBytesDownloaded} databaseWriteDurationMs=${databaseWriteDurationMs} databaseWritesAvoided=${databaseWritesAvoided} deferredChats=${runtime.deferredHistoryChatIds.length}`
      );

      touchRuntimeActivity(runtime);
    }
    await releaseWhatsAppHistoryLease({
      channelId: runtime.channelId,
      ownerId: leaseOwnerId,
      generation: historyLease.generation
    }).catch(() => null);
    if (fenceTimedOutClient && isActiveRuntimeState(runtime)) {
      const reason = "A timed-out history operation was fenced before another operation could use the same WhatsApp client.";
      void runSerializedChannelLifecycle(runtime.channelId, async () => {
        if (!isActiveRuntimeState(runtime)) return;
        await restartRuntimePreservingSession(runtime, reason, {
          trigger: "history-operation-timeout-fence"
        });
      }).catch((error) => {
        console.error(
          `[whatsapp-web][sync] workspace=${workspaceId} timeout-fence-restart:error ${
            error instanceof Error ? error.message : "Unknown timeout fence restart error."
          }`
        );
      });
    }
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

        if (initialWid?.server === "lid") {
          return {
            resolvedId: normalizedPhoneContact?.resolvedId ?? normalizedPhoneWid,
            phone: normalizedPhoneContact?.phone ?? directPhone,
            name: primaryContact?.name ?? normalizedPhoneContact?.name ?? null,
            pushname: primaryContact?.pushname ?? normalizedPhoneContact?.pushname ?? null
          };
        }

        return primaryContact ?? normalizedPhoneContact ?? {
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
