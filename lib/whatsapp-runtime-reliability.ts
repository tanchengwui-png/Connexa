import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import {
  calculateWhatsAppRecoveryDelayMs,
  type WhatsAppRuntimeDesiredState,
  type WhatsAppRuntimeHealthStatus
} from "@/lib/whatsapp-runtime-health-state";
export {
  calculateWhatsAppRecoveryDelayMs,
  classifyWhatsAppWebState,
  resolveWhatsAppUserConnectionState
} from "@/lib/whatsapp-runtime-health-state";

const DEFAULT_RECOVERY_BASE_MS = Math.max(
  1_000,
  Number.parseInt(process.env.WHATSAPP_RECOVERY_BASE_MS ?? "5000", 10) || 5_000
);
const DEFAULT_RECOVERY_MAX_MS = Math.max(
  DEFAULT_RECOVERY_BASE_MS,
  Number.parseInt(process.env.WHATSAPP_RECOVERY_MAX_MS ?? "300000", 10) || 5 * 60_000
);
const DEFAULT_RECOVERY_WINDOW_MS = Math.max(
  60_000,
  Number.parseInt(process.env.WHATSAPP_RECOVERY_WINDOW_MS ?? "900000", 10) || 15 * 60_000
);
const DEFAULT_MAX_RECOVERY_ATTEMPTS = Math.max(
  1,
  Number.parseInt(process.env.WHATSAPP_MAX_RECOVERY_ATTEMPTS ?? "3", 10) || 3
);
const DEFAULT_RECOVERY_JITTER_RATIO = 0.2;

type ReliabilityRow = {
  id: string;
  workspaceId: string;
  connectedByAgentId: string | null;
  sessionClientId: string | null;
  connectionStatus: string;
  connectedAt: Date | null;
  runtimeDesiredState: string;
  runtimeHealthStatus: string;
  consecutiveHealthFailures: number;
  recoveryAttemptCount: number;
  recoveryWindowStartedAt: Date | null;
  nextRecoveryAt: Date | null;
  lastHealthyAt: Date | null;
  recoveryToken: string | null;
};

export async function listDesiredWhatsAppRuntimeChannels() {
  return prisma.$queryRaw<ReliabilityRow[]>`
    SELECT
      "id", "workspaceId", "connectedByAgentId", "sessionClientId", "connectionStatus", "connectedAt",
      "runtimeDesiredState", "runtimeHealthStatus", "consecutiveHealthFailures",
      "recoveryAttemptCount", "recoveryWindowStartedAt", "nextRecoveryAt",
      "lastHealthyAt", "recoveryToken"
    FROM "WhatsAppChannel"
    WHERE ("channelType" = 'web' OR ("channelType" IS NULL AND "phoneNumberId" IS NULL))
      AND "runtimeDesiredState" = 'RUNNING'
      AND "connectedByAgentId" IS NOT NULL
      AND "sessionClientId" IS NOT NULL
  `;
}

export async function setWhatsAppRuntimeDesiredState(input: {
  workspaceId: string;
  channelId: string;
  desiredState: WhatsAppRuntimeDesiredState;
  healthStatus?: WhatsAppRuntimeHealthStatus;
}) {
  const healthStatus = input.healthStatus ?? (input.desiredState === "STOPPED" ? "STOPPED" : "RECOVERING");
  await prisma.$executeRaw`
    UPDATE "WhatsAppChannel"
    SET
      "runtimeDesiredState" = ${input.desiredState},
      "runtimeHealthStatus" = ${healthStatus},
      "consecutiveHealthFailures" = 0,
      "recoveryAttemptCount" = 0,
      "recoveryWindowStartedAt" = NULL,
      "nextRecoveryAt" = NULL,
      "lastRecoveryAt" = NULL,
      "recoveryToken" = NULL,
      "runtimeDegradedAt" = CASE
        WHEN ${healthStatus} = 'RECOVERING' THEN COALESCE("runtimeDegradedAt", NOW())
        ELSE NULL
      END,
      "reauthRequiredAt" = CASE WHEN ${healthStatus} = 'REAUTH_REQUIRED' THEN NOW() ELSE NULL END,
      "updatedAt" = NOW()
    WHERE "id" = ${input.channelId}
      AND "workspaceId" = ${input.workspaceId}
  `;
}

export async function markWhatsAppRuntimeHealthy(input: { workspaceId: string; channelId: string }) {
  await prisma.$executeRaw`
    UPDATE "WhatsAppChannel"
    SET
      "runtimeHealthStatus" = 'HEALTHY',
      "latestHealthCheckAt" = NOW(),
      "lastHealthyAt" = NOW(),
      "runtimeDegradedAt" = NULL,
      "consecutiveHealthFailures" = 0,
      "recoveryAttemptCount" = 0,
      "recoveryWindowStartedAt" = NULL,
      "nextRecoveryAt" = NULL,
      "lastRecoveryAt" = NULL,
      "recoveryToken" = NULL,
      "reauthRequiredAt" = NULL,
      "lastErrorCode" = NULL,
      "updatedAt" = NOW()
    WHERE "id" = ${input.channelId}
      AND "workspaceId" = ${input.workspaceId}
      AND "runtimeDesiredState" = 'RUNNING'
  `;
}

export async function recordWhatsAppRuntimeHealthFailure(input: {
  workspaceId: string;
  channelId: string;
  errorCode: string;
}) {
  const rows = await prisma.$queryRaw<Array<{ consecutiveHealthFailures: number }>>`
    UPDATE "WhatsAppChannel"
    SET
      "runtimeHealthStatus" = 'RECOVERING',
      "latestHealthCheckAt" = NOW(),
      "consecutiveHealthFailures" = "consecutiveHealthFailures" + 1,
      "runtimeDegradedAt" = COALESCE("runtimeDegradedAt", NOW()),
      "lastErrorCode" = ${input.errorCode},
      "updatedAt" = NOW()
    WHERE "id" = ${input.channelId}
      AND "workspaceId" = ${input.workspaceId}
      AND "runtimeDesiredState" = 'RUNNING'
    RETURNING "consecutiveHealthFailures"
  `;
  return rows[0]?.consecutiveHealthFailures ?? 0;
}

export async function markWhatsAppRuntimeRecovering(input: {
  workspaceId: string;
  channelId: string;
  errorCode: string;
}) {
  await prisma.$executeRaw`
    UPDATE "WhatsAppChannel"
    SET
      "runtimeHealthStatus" = 'RECOVERING',
      "latestHealthCheckAt" = NOW(),
      "runtimeDegradedAt" = COALESCE("runtimeDegradedAt", NOW()),
      "lastErrorCode" = ${input.errorCode},
      "updatedAt" = NOW()
    WHERE "id" = ${input.channelId}
      AND "workspaceId" = ${input.workspaceId}
      AND "runtimeDesiredState" = 'RUNNING'
  `;
}

export async function markWhatsAppRuntimeReauthRequired(input: {
  workspaceId: string;
  channelId: string;
  errorCode: string;
}) {
  await prisma.$executeRaw`
    UPDATE "WhatsAppChannel"
    SET
      "runtimeHealthStatus" = 'REAUTH_REQUIRED',
      "connectionStatus" = 'REAUTH_REQUIRED',
      "latestHealthCheckAt" = NOW(),
      "reauthRequiredAt" = NOW(),
      "runtimeDegradedAt" = COALESCE("runtimeDegradedAt", NOW()),
      "nextRecoveryAt" = NULL,
      "recoveryToken" = NULL,
      "lastErrorCode" = ${input.errorCode},
      "updatedAt" = NOW()
    WHERE "id" = ${input.channelId}
      AND "workspaceId" = ${input.workspaceId}
      AND "runtimeDesiredState" = 'RUNNING'
  `;
}

export async function scheduleWhatsAppRuntimeRecovery(input: {
  workspaceId: string;
  channelId: string;
  errorCode: string;
  minimumDelayMs?: number;
  now?: Date;
  maxAttempts?: number;
  windowMs?: number;
}) {
  const now = input.now ?? new Date();
  const current = await prisma.$queryRaw<Array<{
    runtimeDesiredState: string;
    recoveryAttemptCount: number;
    recoveryWindowStartedAt: Date | null;
  }>>`
    SELECT "runtimeDesiredState", "recoveryAttemptCount", "recoveryWindowStartedAt"
    FROM "WhatsAppChannel"
    WHERE "id" = ${input.channelId} AND "workspaceId" = ${input.workspaceId}
    LIMIT 1
  `;
  const row = current[0];
  if (!row || row.runtimeDesiredState !== "RUNNING") return null;

  const windowMs = input.windowMs ?? DEFAULT_RECOVERY_WINDOW_MS;
  const windowExpired =
    !row.recoveryWindowStartedAt || now.getTime() - row.recoveryWindowStartedAt.getTime() > windowMs;
  const attempt = windowExpired ? 1 : row.recoveryAttemptCount + 1;
  if (attempt > (input.maxAttempts ?? DEFAULT_MAX_RECOVERY_ATTEMPTS)) {
    const nextRecoveryAt = new Date(now.getTime() + windowMs);
    const token = randomUUID();
    await prisma.$executeRaw`
      UPDATE "WhatsAppChannel"
      SET
        "runtimeHealthStatus" = 'RECOVERING',
        "nextRecoveryAt" = ${nextRecoveryAt},
        "recoveryToken" = ${token},
        "runtimeDegradedAt" = COALESCE("runtimeDegradedAt", NOW()),
        "lastErrorCode" = 'RECOVERY_CIRCUIT_OPEN',
        "updatedAt" = NOW()
      WHERE "id" = ${input.channelId}
        AND "workspaceId" = ${input.workspaceId}
        AND "runtimeDesiredState" = 'RUNNING'
    `;
    return { allowed: false as const, attempt, token, nextRecoveryAt };
  }

  const delayMs = Math.max(
    input.minimumDelayMs ?? 0,
    calculateWhatsAppRecoveryDelayMs(
      attempt,
      DEFAULT_RECOVERY_BASE_MS,
      DEFAULT_RECOVERY_MAX_MS,
      DEFAULT_RECOVERY_JITTER_RATIO
    )
  );
  const nextRecoveryAt = new Date(now.getTime() + delayMs);
  const token = randomUUID();
  await prisma.$executeRaw`
    UPDATE "WhatsAppChannel"
    SET
      "runtimeHealthStatus" = 'RECOVERING',
      "recoveryAttemptCount" = ${attempt},
      "recoveryWindowStartedAt" = ${windowExpired ? now : row.recoveryWindowStartedAt},
      "nextRecoveryAt" = ${nextRecoveryAt},
      "lastRecoveryAt" = NOW(),
      "runtimeDegradedAt" = COALESCE("runtimeDegradedAt", NOW()),
      "recoveryToken" = ${token},
      "lastErrorCode" = ${input.errorCode},
      "updatedAt" = NOW()
    WHERE "id" = ${input.channelId}
      AND "workspaceId" = ${input.workspaceId}
      AND "runtimeDesiredState" = 'RUNNING'
  `;
  return { allowed: true as const, attempt, delayMs, token, nextRecoveryAt };
}

export async function isWhatsAppRuntimeRecoveryCurrent(input: {
  workspaceId: string;
  channelId: string;
  token: string;
}) {
  const rows = await prisma.$queryRaw<Array<{ current: boolean }>>`
    SELECT EXISTS(
      SELECT 1 FROM "WhatsAppChannel"
      WHERE "id" = ${input.channelId}
        AND "workspaceId" = ${input.workspaceId}
        AND "runtimeDesiredState" = 'RUNNING'
        AND "runtimeHealthStatus" = 'RECOVERING'
        AND "recoveryToken" = ${input.token}
    ) AS "current"
  `;
  return rows[0]?.current === true;
}
