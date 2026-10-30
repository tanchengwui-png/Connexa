import { createHash, randomUUID } from "node:crypto";
import { execute, queryMany, queryOne } from "@/lib/db";

export const WHATSAPP_HISTORY_SYNC_PHASES = [
  "fast_bootstrap",
  "incremental_sync",
  "media_enrichment",
  "initial_import",
  "catch_up",
  "reconcile",
  "idle",
  "deferred",
  "error",
  "disconnected"
] as const;

export type WhatsAppHistorySyncPhase = (typeof WHATSAPP_HISTORY_SYNC_PHASES)[number];
export type WhatsAppIncrementalSyncMode = "off" | "shadow" | "on";

export type WhatsAppHistorySyncStatus = {
  phase: WhatsAppHistorySyncPhase;
  active: boolean;
  startedAt: string | null;
  progressAt: string | null;
  completedAt: string | null;
  lastSuccessfulSyncAt: string | null;
  nextReconciliationAt: string | null;
  totalChats: number | null;
  processedChats: number;
  remainingChats: number;
  deferredChats: number;
  newMessages: number;
  knownMessages: number;
  updatedMessages: number;
  skippedMessages: number;
  mediaDownloadsAvoided: number;
  mediaBytesDownloaded: number;
  databaseWritesAvoided: number;
  lastError: string | null;
  generation: number;
};

type SyncStateRow = Omit<
  WhatsAppHistorySyncStatus,
  "startedAt" | "progressAt" | "completedAt" | "lastSuccessfulSyncAt" | "nextReconciliationAt" | "mediaBytesDownloaded"
> & {
  startedAt: Date | null;
  progressAt: Date | null;
  completedAt: Date | null;
  lastSuccessfulSyncAt: Date | null;
  nextReconciliationAt: Date | null;
  mediaBytesDownloaded: bigint | number | string;
  leaseActive: boolean;
};

export type WhatsAppHistoryCheckpoint = {
  remoteChatId: string;
  lastProviderMessageId: string | null;
  lastMessageTimestamp: Date | null;
  lastObservedChatActivityAt: Date | null;
  lastChatSignature: string | null;
  lastSuccessfulReconciliationAt: Date | null;
  lastAttemptedReconciliationAt: Date | null;
  initialImportComplete: boolean;
  deferred: boolean;
  retryAt: Date | null;
  lastError: string | null;
  schemaVersion: number;
};

export type StoredHistoryMessage = {
  id: string;
  conversationId: string;
  providerMessageId: string;
  mediaAssetId: string | null;
  attachmentMimeType: string | null;
  attachmentName: string | null;
  attachmentUrl: string | null;
  envelopeMediaUrl: string | null;
  envelopeMediaStoragePath: string | null;
};

function asIso(value: Date | null) {
  return value ? value.toISOString() : null;
}

function isMissingHistoryStateTable(error: unknown) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "42P01"
  );
}

function normalizePhase(value: string): WhatsAppHistorySyncPhase {
  return (WHATSAPP_HISTORY_SYNC_PHASES as readonly string[]).includes(value)
    ? (value as WhatsAppHistorySyncPhase)
    : "idle";
}

export function getWhatsAppIncrementalSyncMode(workspaceId?: string): WhatsAppIncrementalSyncMode {
  const configured = process.env.WHATSAPP_INCREMENTAL_SYNC_MODE?.trim().toLowerCase();
  const mode = configured === "on" || configured === "off" || configured === "shadow" ? configured : "shadow";
  if (mode !== "on" || !workspaceId) return mode;

  const rolloutPercent = Math.min(
    100,
    Math.max(0, Number.parseInt(process.env.WHATSAPP_INCREMENTAL_ROLLOUT_PERCENT ?? "100", 10) || 0)
  );
  if (rolloutPercent >= 100) return "on";
  if (rolloutPercent <= 0) return "shadow";
  const bucket = Number.parseInt(createHash("sha256").update(workspaceId).digest("hex").slice(0, 8), 16) % 100;
  return bucket < rolloutPercent ? "on" : "shadow";
}

export function getWhatsAppRoutineReconciliationMs(mode = getWhatsAppIncrementalSyncMode()) {
  const fallback = mode === "on" ? 30 * 60_000 : 3 * 60_000;
  if (mode !== "on") return fallback;
  return Math.max(
    60_000,
    Number.parseInt(process.env.WHATSAPP_ROUTINE_RECONCILIATION_MS ?? `${fallback}`, 10) || fallback
  );
}

export function getWhatsAppDeepAuditMs() {
  return Math.max(
    60 * 60_000,
    Number.parseInt(process.env.WHATSAPP_DEEP_AUDIT_MS ?? `${24 * 60 * 60_000}`, 10) || 24 * 60 * 60_000
  );
}

export function createWhatsAppChatSignature(input: {
  remoteChatId: string;
  activityTimestamp?: number | null;
  unreadCount?: number | null;
  lastProviderMessageId?: string | null;
  archived?: boolean | null;
  pinned?: boolean | null;
  muted?: boolean | null;
}) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        remoteChatId: input.remoteChatId,
        activityTimestamp: input.activityTimestamp ?? null,
        unreadCount: input.unreadCount ?? 0,
        lastProviderMessageId: input.lastProviderMessageId ?? null,
        archived: Boolean(input.archived),
        pinned: Boolean(input.pinned),
        muted: Boolean(input.muted)
      })
    )
    .digest("hex");
}

export function shouldReconcileWhatsAppChat(input: {
  checkpoint: WhatsAppHistoryCheckpoint | null;
  signature: string;
  now?: Date;
  deepAuditMs?: number;
}) {
  const { checkpoint } = input;
  if (!checkpoint || !checkpoint.initialImportComplete || checkpoint.deferred) {
    return true;
  }

  if (checkpoint.lastChatSignature !== input.signature) {
    return true;
  }

  const now = input.now ?? new Date();
  const deepAuditMs = input.deepAuditMs ?? getWhatsAppDeepAuditMs();
  return (
    !checkpoint.lastSuccessfulReconciliationAt ||
    now.getTime() - checkpoint.lastSuccessfulReconciliationAt.getTime() >= deepAuditMs
  );
}

export async function readWhatsAppHistorySyncState(input: {
  workspaceId: string;
  channelId: string;
}): Promise<WhatsAppHistorySyncStatus | null> {
  try {
    const row = await queryOne<SyncStateRow>(
      `SELECT state.phase, state.active, state."startedAt", state."progressAt", state."completedAt",
              state."lastSuccessfulSyncAt", state."nextReconciliationAt", state."totalChats",
              state."processedChats", state."remainingChats", state."deferredChats", state."newMessages",
              state."knownMessages", state."updatedMessages", state."skippedMessages",
              state."mediaDownloadsAvoided", state."mediaBytesDownloaded", state."databaseWritesAvoided",
              state."lastError", state.generation,
              EXISTS (
                SELECT 1
                FROM "WhatsAppHistoryLease" lease
                WHERE lease."channelId" = state."channelId"
                  AND lease."workspaceId" = state."workspaceId"
                  AND lease."expiresAt" > NOW()
              ) AS "leaseActive"
       FROM "WhatsAppHistorySyncState" state
       WHERE state."workspaceId" = $1 AND state."channelId" = $2
       LIMIT 1`,
      [input.workspaceId, input.channelId]
    );
    if (!row) return null;

    const interrupted = row.active && !row.leaseActive;
    const { leaseActive: _leaseActive, ...status } = row;
    return {
      ...status,
      phase: interrupted ? "deferred" : normalizePhase(row.phase),
      active: row.active && row.leaseActive,
      startedAt: asIso(row.startedAt),
      progressAt: asIso(row.progressAt),
      completedAt: asIso(row.completedAt),
      lastSuccessfulSyncAt: asIso(row.lastSuccessfulSyncAt),
      nextReconciliationAt: asIso(row.nextReconciliationAt),
      mediaBytesDownloaded: Number(row.mediaBytesDownloaded),
      lastError:
        row.lastError ??
        (interrupted ? "History reconciliation was interrupted and will resume automatically." : null)
    };
  } catch (error) {
    if (isMissingHistoryStateTable(error)) return null;
    throw error;
  }
}

export async function startWhatsAppHistorySyncState(input: {
  workspaceId: string;
  channelId: string;
  phase: Exclude<WhatsAppHistorySyncPhase, "idle" | "deferred" | "error" | "disconnected">;
  totalChats?: number | null;
}) {
  return queryOne<{ generation: number }>(
    `INSERT INTO "WhatsAppHistorySyncState" (
       id, "workspaceId", "channelId", phase, active, "startedAt", "progressAt",
       "totalChats", "processedChats", "remainingChats", "deferredChats",
       "newMessages", "knownMessages", "updatedMessages", "skippedMessages",
       "mediaDownloadsAvoided", "mediaBytesDownloaded", "databaseWritesAvoided",
       "lastError", generation, "createdAt", "updatedAt"
     ) VALUES ($1, $2, $3, $4, true, NOW(), NOW(), $5, 0, COALESCE($5, 0), 0,
               0, 0, 0, 0, 0, 0, 0, NULL, 1, NOW(), NOW())
     ON CONFLICT ("channelId") DO UPDATE SET
       phase = EXCLUDED.phase,
       active = true,
       "startedAt" = NOW(),
       "progressAt" = NOW(),
       "totalChats" = EXCLUDED."totalChats",
       "processedChats" = 0,
       "remainingChats" = COALESCE(EXCLUDED."totalChats", 0),
       "deferredChats" = 0,
       "newMessages" = 0,
       "knownMessages" = 0,
       "updatedMessages" = 0,
       "skippedMessages" = 0,
       "mediaDownloadsAvoided" = 0,
       "mediaBytesDownloaded" = 0,
       "databaseWritesAvoided" = 0,
       "lastError" = NULL,
       generation = "WhatsAppHistorySyncState".generation + 1,
       "updatedAt" = NOW()
     RETURNING generation`,
    [randomUUID(), input.workspaceId, input.channelId, input.phase, input.totalChats ?? null]
  );
}

export async function updateWhatsAppHistorySyncProgress(input: {
  workspaceId: string;
  channelId: string;
  generation: number;
  totalChats?: number | null;
  processedChats: number;
  remainingChats: number;
  deferredChats: number;
  newMessages: number;
  knownMessages: number;
  updatedMessages?: number;
  skippedMessages: number;
  mediaDownloadsAvoided: number;
  mediaBytesDownloaded?: number;
  databaseWritesAvoided?: number;
}) {
  await execute(
    `UPDATE "WhatsAppHistorySyncState"
     SET "progressAt" = NOW(),
         "totalChats" = COALESCE($3, "totalChats"),
         "processedChats" = $4,
         "remainingChats" = $5,
         "deferredChats" = $6,
         "newMessages" = $7,
         "knownMessages" = $8,
         "updatedMessages" = $9,
         "skippedMessages" = $10,
         "mediaDownloadsAvoided" = $11,
         "mediaBytesDownloaded" = $12,
         "databaseWritesAvoided" = $13,
         "updatedAt" = NOW()
     WHERE "workspaceId" = $1 AND "channelId" = $2 AND generation = $14`,
    [
      input.workspaceId,
      input.channelId,
      input.totalChats ?? null,
      input.processedChats,
      input.remainingChats,
      input.deferredChats,
      input.newMessages,
      input.knownMessages,
      input.updatedMessages ?? 0,
      input.skippedMessages,
      input.mediaDownloadsAvoided,
      input.mediaBytesDownloaded ?? 0,
      input.databaseWritesAvoided ?? 0,
      input.generation
    ]
  );
}

export async function finishWhatsAppHistorySyncState(input: {
  workspaceId: string;
  channelId: string;
  generation: number;
  phase: WhatsAppHistorySyncPhase;
  nextReconciliationAt?: Date | null;
  lastError?: string | null;
  successful?: boolean;
}) {
  await execute(
    `UPDATE "WhatsAppHistorySyncState"
     SET phase = $3,
         active = false,
         "completedAt" = CASE WHEN $4 THEN NOW() ELSE "completedAt" END,
         "lastSuccessfulSyncAt" = CASE WHEN $4 THEN NOW() ELSE "lastSuccessfulSyncAt" END,
         "nextReconciliationAt" = $5,
         "lastError" = $6,
         "updatedAt" = NOW()
     WHERE "workspaceId" = $1 AND "channelId" = $2 AND generation = $7`,
    [
      input.workspaceId,
      input.channelId,
      input.phase,
      Boolean(input.successful),
      input.nextReconciliationAt ?? null,
      input.lastError ?? null,
      input.generation
    ]
  );
}

export async function loadWhatsAppHistoryCheckpoints(input: {
  workspaceId: string;
  channelId: string;
}) {
  const rows = await queryMany<WhatsAppHistoryCheckpoint>(
    `SELECT "remoteChatId", "lastProviderMessageId", "lastMessageTimestamp",
            "lastObservedChatActivityAt", "lastChatSignature",
            "lastSuccessfulReconciliationAt", "lastAttemptedReconciliationAt",
            "initialImportComplete", deferred, "retryAt", "lastError", "schemaVersion"
     FROM "WhatsAppHistoryCheckpoint"
     WHERE "workspaceId" = $1 AND "channelId" = $2`,
    [input.workspaceId, input.channelId]
  );
  return new Map(rows.map((row) => [row.remoteChatId, row]));
}

export async function recordWhatsAppHistoryCheckpointSuccess(input: {
  workspaceId: string;
  channelId: string;
  remoteChatId: string;
  lastProviderMessageId?: string | null;
  lastMessageTimestamp?: Date | null;
  lastObservedChatActivityAt?: Date | null;
  lastChatSignature: string;
}) {
  await execute(
    `INSERT INTO "WhatsAppHistoryCheckpoint" (
       id, "workspaceId", "channelId", "remoteChatId", "lastProviderMessageId",
       "lastMessageTimestamp", "lastObservedChatActivityAt", "lastChatSignature",
       "lastSuccessfulReconciliationAt", "lastAttemptedReconciliationAt",
       "initialImportComplete", deferred, "retryAt", "lastError", "schemaVersion",
       "createdAt", "updatedAt"
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW(), true, false, NULL, NULL, 1, NOW(), NOW())
     ON CONFLICT ("workspaceId", "channelId", "remoteChatId") DO UPDATE SET
       "lastProviderMessageId" = COALESCE(EXCLUDED."lastProviderMessageId", "WhatsAppHistoryCheckpoint"."lastProviderMessageId"),
       "lastMessageTimestamp" = GREATEST(EXCLUDED."lastMessageTimestamp", "WhatsAppHistoryCheckpoint"."lastMessageTimestamp"),
       "lastObservedChatActivityAt" = EXCLUDED."lastObservedChatActivityAt",
       "lastChatSignature" = EXCLUDED."lastChatSignature",
       "lastSuccessfulReconciliationAt" = NOW(),
       "lastAttemptedReconciliationAt" = NOW(),
       "initialImportComplete" = true,
       deferred = false,
       "retryAt" = NULL,
       "lastError" = NULL,
       "schemaVersion" = 1,
       "updatedAt" = NOW()`,
    [
      randomUUID(),
      input.workspaceId,
      input.channelId,
      input.remoteChatId,
      input.lastProviderMessageId ?? null,
      input.lastMessageTimestamp ?? null,
      input.lastObservedChatActivityAt ?? null,
      input.lastChatSignature
    ]
  );
}

export async function recordWhatsAppHistoryCheckpointFailure(input: {
  workspaceId: string;
  channelId: string;
  remoteChatId: string;
  retryAt: Date;
  error: string;
}) {
  await execute(
    `INSERT INTO "WhatsAppHistoryCheckpoint" (
       id, "workspaceId", "channelId", "remoteChatId", "lastAttemptedReconciliationAt",
       deferred, "retryAt", "lastError", "schemaVersion", "createdAt", "updatedAt"
     ) VALUES ($1, $2, $3, $4, NOW(), true, $5, $6, 1, NOW(), NOW())
     ON CONFLICT ("workspaceId", "channelId", "remoteChatId") DO UPDATE SET
       "lastAttemptedReconciliationAt" = NOW(),
       deferred = true,
       "retryAt" = EXCLUDED."retryAt",
       "lastError" = EXCLUDED."lastError",
       "updatedAt" = NOW()`,
    [randomUUID(), input.workspaceId, input.channelId, input.remoteChatId, input.retryAt, input.error.slice(0, 1000)]
  );
}

export async function loadStoredHistoryMessages(input: {
  workspaceId: string;
  channelId: string;
  providerMessageIds: string[];
}) {
  const providerMessageIds = Array.from(new Set(input.providerMessageIds.map((id) => id.trim()).filter(Boolean)));
  if (!providerMessageIds.length) return new Map<string, StoredHistoryMessage>();

  const rows = await queryMany<StoredHistoryMessage>(
    `SELECT m.id, m."conversationId", m."providerMessageId", m."mediaAssetId",
            m."attachmentMimeType", m."attachmentName", m."attachmentUrl",
            we."mediaUrl" AS "envelopeMediaUrl", we."mediaStoragePath" AS "envelopeMediaStoragePath"
     FROM "Message" m
     JOIN "Conversation" conv ON conv.id = m."conversationId"
     LEFT JOIN "WhatsAppMessageEnvelope" we
       ON we."messageId" = m.id OR we."providerMessageId" = m."providerMessageId"
     WHERE conv."workspaceId" = $1
       AND conv."channelId" = $2
       AND m."providerMessageId" = ANY($3::text[])`,
    [input.workspaceId, input.channelId, providerMessageIds]
  );
  return new Map(rows.map((row) => [row.providerMessageId, row]));
}

export function isStoredHistoryMediaComplete(message: StoredHistoryMessage | undefined) {
  return Boolean(
    message &&
      (message.mediaAssetId || message.attachmentUrl || message.envelopeMediaUrl || message.envelopeMediaStoragePath)
  );
}

export async function acquireWhatsAppHistoryLease(input: {
  workspaceId: string;
  channelId: string;
  ownerId: string;
  ttlMs: number;
}) {
  const row = await queryOne<{ generation: number; expiresAt: Date }>(
    `INSERT INTO "WhatsAppHistoryLease" (
       "channelId", "workspaceId", "ownerId", generation, "expiresAt", "createdAt", "updatedAt"
     ) VALUES ($1, $2, $3, 1, NOW() + ($4::double precision * INTERVAL '1 millisecond'), NOW(), NOW())
     ON CONFLICT ("channelId") DO UPDATE SET
       "workspaceId" = EXCLUDED."workspaceId",
       "ownerId" = EXCLUDED."ownerId",
       generation = "WhatsAppHistoryLease".generation + 1,
       "expiresAt" = EXCLUDED."expiresAt",
       "updatedAt" = NOW()
     WHERE "WhatsAppHistoryLease"."expiresAt" <= NOW()
        OR "WhatsAppHistoryLease"."ownerId" = EXCLUDED."ownerId"
     RETURNING generation, "expiresAt"`,
    [input.channelId, input.workspaceId, input.ownerId, input.ttlMs]
  );
  return row;
}

export async function renewWhatsAppHistoryLease(input: {
  channelId: string;
  ownerId: string;
  generation: number;
  ttlMs: number;
}) {
  const result = await execute(
    `UPDATE "WhatsAppHistoryLease"
     SET "expiresAt" = NOW() + ($4::double precision * INTERVAL '1 millisecond'), "updatedAt" = NOW()
     WHERE "channelId" = $1 AND "ownerId" = $2 AND generation = $3`,
    [input.channelId, input.ownerId, input.generation, input.ttlMs]
  );
  return result.rowCount === 1;
}

export async function releaseWhatsAppHistoryLease(input: {
  channelId: string;
  ownerId: string;
  generation: number;
}) {
  await execute(
    `DELETE FROM "WhatsAppHistoryLease"
     WHERE "channelId" = $1 AND "ownerId" = $2 AND generation = $3`,
    [input.channelId, input.ownerId, input.generation]
  );
}
