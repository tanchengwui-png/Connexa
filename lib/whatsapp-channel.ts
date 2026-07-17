import { rm } from "fs/promises";
import { encryptSecret, hashSecret } from "@/lib/crypto";
import { getMetaWebhookVerifyToken } from "@/lib/meta-whatsapp";
import { assertWorkspaceHasWhatsAppNumberCapacity } from "@/lib/package-feature-limits";
import { prisma } from "@/lib/prisma";
import { sanitizeWhatsAppChannelDisplayName } from "@/lib/whatsapp-channel-label";
import { shouldDeleteChannelRecord } from "@/lib/whatsapp-channel-hardening";

export type WhatsAppProviderMode = "webjs";
export type WhatsAppConnectionMethod = "api" | "web";

export type WorkspaceWhatsAppChannelStatus = {
  id: string;
  workspaceId: string;
  connectionMethod: WhatsAppConnectionMethod;
  incognitoMode: boolean;
  provider: string | null;
  channelType: string | null;
  connectedByAgentId: string | null;
  connectedByAgentName: string | null;
  sessionClientId: string | null;
  connectionStatus: string;
  displayName: string | null;
  phoneNumber: string | null;
  phoneNumberId: string | null;
  businessAccountId: string | null;
  accessTokenLastFour: string | null;
  verifyTokenLastFour: string | null;
  qrCodeDataUrl: string | null;
  qrCodeUpdatedAt: Date | null;
  lastError: string | null;
  connectedAt: Date | null;
  tokenExpiresAt: Date | null;
  disconnectedAt: Date | null;
  lastSeenAt: Date | null;
  lastWebhookAt: Date | null;
  updatedAt: Date;
};

const NEW_NUMBER_CONVERSATION_ELIGIBLE_STATUSES = new Set(["CONNECTED", "READY", "SYNCING_HISTORY"]);

type SaveWhatsAppChannelConnectionInput = {
  channelId?: string | null;
  workspaceId: string;
  agentId?: string | null;
  sessionClientId?: string | null;
  connectionStatus: string;
  displayName?: string | null;
  phoneNumber?: string | null;
  qrCodeDataUrl?: string | null;
  qrCodeUpdatedAt?: Date | null;
  lastError?: string | null;
  connectedAt?: Date | null;
};

type MarkWhatsAppChannelDisconnectedInput = {
  channelId?: string | null;
  workspaceId: string;
  lastError?: string | null;
  connectionStatus?: string;
};

export function getWhatsAppProviderMode(): WhatsAppProviderMode {
  return "webjs";
}

export function isWhatsAppMockModeEnabled() {
  return false;
}

function resolveWhatsAppConnectionMethod(input: {
  channelType?: string | null;
  phoneNumberId?: string | null;
  accessTokenCiphertext?: string | null;
}) {
  return input.channelType === "web"
    ? "web"
    : input.channelType === "cloudapi" || Boolean(input.phoneNumberId && input.accessTokenCiphertext)
      ? "api"
      : "web";
}

function isPersonalWhatsAppSession(input: {
  channelType?: string | null;
  phoneNumberId?: string | null;
  accessTokenCiphertext?: string | null;
}) {
  return resolveWhatsAppConnectionMethod(input) === "web";
}

export function canStartUnsavedNumberConversation(
  channel:
    | Pick<
        WorkspaceWhatsAppChannelStatus,
        | "connectionMethod"
        | "connectionStatus"
        | "sessionClientId"
        | "disconnectedAt"
        | "tokenExpiresAt"
        | "phoneNumber"
      >
    | null
    | undefined
) {
  if (!channel || channel.connectionMethod !== "web") {
    return false;
  }

  if (!channel.sessionClientId?.trim()) {
    return false;
  }

  if (!NEW_NUMBER_CONVERSATION_ELIGIBLE_STATUSES.has(channel.connectionStatus)) {
    return false;
  }

  if (channel.tokenExpiresAt && channel.tokenExpiresAt.getTime() <= Date.now()) {
    return false;
  }

  return true;
}

function isMissingWhatsAppIncognitoColumnError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  const candidate = error as Error & { code?: string; meta?: { column?: string } };
  return (
    candidate.code === "P2022" &&
    (candidate.meta?.column === "WhatsAppChannel.incognitoMode" ||
      candidate.message.includes("WhatsAppChannel.incognitoMode"))
  );
}

type LegacyWhatsAppChannelRow = {
  id: string;
  workspaceId: string;
  provider: string | null;
  channelType: string | null;
  phoneNumberId: string | null;
  businessAccountId: string | null;
  accessTokenCiphertext: string | null;
  accessTokenLastFour: string | null;
  verifyTokenLastFour: string | null;
  connectedByAgentId: string | null;
  connectedByAgentName: string | null;
  connectedByAgentEmail: string | null;
  sessionClientId: string | null;
  connectionStatus: string;
  displayName: string | null;
  phoneNumber: string | null;
  qrCodeDataUrl: string | null;
  qrCodeUpdatedAt: Date | null;
  lastError: string | null;
  connectedAt: Date | null;
  tokenExpiresAt: Date | null;
  disconnectedAt: Date | null;
  lastSeenAt: Date | null;
  lastWebhookAt: Date | null;
  updatedAt: Date;
  createdAt: Date;
};

function mapLegacyChannelRow(row: LegacyWhatsAppChannelRow) {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    provider: row.provider,
    channelType: row.channelType,
    phoneNumberId: row.phoneNumberId,
    businessAccountId: row.businessAccountId,
    accessTokenCiphertext: row.accessTokenCiphertext,
    accessTokenLastFour: row.accessTokenLastFour,
    verifyTokenLastFour: row.verifyTokenLastFour,
    connectedByAgentId: row.connectedByAgentId,
    connectedByAgent: row.connectedByAgentId
      ? {
          id: row.connectedByAgentId,
          name: row.connectedByAgentName ?? row.connectedByAgentEmail ?? "Unknown agent",
          email: row.connectedByAgentEmail ?? undefined
        }
      : null,
    sessionClientId: row.sessionClientId,
    connectionStatus: row.connectionStatus,
    displayName: row.displayName,
    phoneNumber: row.phoneNumber,
    incognitoMode: false,
    qrCodeDataUrl: row.qrCodeDataUrl,
    qrCodeUpdatedAt: row.qrCodeUpdatedAt,
    lastError: row.lastError,
    connectedAt: row.connectedAt,
    tokenExpiresAt: row.tokenExpiresAt,
    disconnectedAt: row.disconnectedAt,
    lastSeenAt: row.lastSeenAt,
    lastWebhookAt: row.lastWebhookAt,
    updatedAt: row.updatedAt,
    createdAt: row.createdAt
  };
}

async function getLegacyWhatsAppChannelRows(input: { workspaceId?: string; channelId?: string }) {
  if (input.channelId) {
    return prisma.$queryRaw<LegacyWhatsAppChannelRow[]>`
      SELECT
        c."id",
        c."workspaceId",
        c."provider",
        c."channelType",
        c."phoneNumberId",
        c."businessAccountId",
        c."accessTokenCiphertext",
        c."accessTokenLastFour",
        c."verifyTokenLastFour",
        c."connectedByAgentId",
        a."name" AS "connectedByAgentName",
        a."email" AS "connectedByAgentEmail",
        c."sessionClientId",
        c."connectionStatus",
        c."displayName",
        c."phoneNumber",
        c."qrCodeDataUrl",
        c."qrCodeUpdatedAt",
        c."lastError",
        c."connectedAt",
        c."tokenExpiresAt",
        c."disconnectedAt",
        c."lastSeenAt",
        c."lastWebhookAt",
        c."updatedAt",
        c."createdAt"
      FROM "WhatsAppChannel" c
      LEFT JOIN "Agent" a ON a."id" = c."connectedByAgentId"
      WHERE c."id" = ${input.channelId}
      LIMIT 1
    `;
  }

  return prisma.$queryRaw<LegacyWhatsAppChannelRow[]>`
    SELECT
      c."id",
      c."workspaceId",
      c."provider",
      c."channelType",
      c."phoneNumberId",
      c."businessAccountId",
      c."accessTokenCiphertext",
      c."accessTokenLastFour",
      c."verifyTokenLastFour",
      c."connectedByAgentId",
      a."name" AS "connectedByAgentName",
      a."email" AS "connectedByAgentEmail",
      c."sessionClientId",
      c."connectionStatus",
      c."displayName",
      c."phoneNumber",
      c."qrCodeDataUrl",
      c."qrCodeUpdatedAt",
      c."lastError",
      c."connectedAt",
      c."tokenExpiresAt",
      c."disconnectedAt",
      c."lastSeenAt",
      c."lastWebhookAt",
      c."updatedAt",
      c."createdAt"
    FROM "WhatsAppChannel" c
    LEFT JOIN "Agent" a ON a."id" = c."connectedByAgentId"
    WHERE c."workspaceId" = ${input.workspaceId!}
    ORDER BY c."updatedAt" DESC, c."createdAt" DESC
  `;
}

function mapChannelStatus(
  channel:
    | ({
        connectedByAgent?: {
          id: string;
          name: string;
          email?: string;
        } | null;
      } & {
        id: string;
        workspaceId: string;
        provider?: string | null;
        channelType?: string | null;
        phoneNumberId?: string | null;
        businessAccountId?: string | null;
        accessTokenCiphertext?: string | null;
        accessTokenLastFour?: string | null;
        verifyTokenLastFour?: string | null;
        connectedByAgentId: string | null;
        sessionClientId: string | null;
        connectionStatus: string;
        displayName: string | null;
        phoneNumber: string | null;
        incognitoMode?: boolean | null;
        qrCodeDataUrl: string | null;
        qrCodeUpdatedAt: Date | null;
        lastError: string | null;
        connectedAt: Date | null;
        tokenExpiresAt?: Date | null;
        disconnectedAt?: Date | null;
        lastSeenAt: Date | null;
        lastWebhookAt?: Date | null;
        updatedAt: Date;
      })
    | null
) {
  if (!channel) {
    return null;
  }

  return {
    id: channel.id,
    workspaceId: channel.workspaceId,
    connectionMethod: resolveWhatsAppConnectionMethod({
      channelType: channel.channelType,
      phoneNumberId: channel.phoneNumberId,
      accessTokenCiphertext: channel.accessTokenCiphertext
    }),
    incognitoMode: channel.incognitoMode === true,
    provider: channel.provider ?? null,
    channelType: channel.channelType ?? null,
    connectedByAgentId: channel.connectedByAgentId,
    connectedByAgentName: channel.connectedByAgent?.name ?? null,
    sessionClientId: channel.sessionClientId,
    connectionStatus: channel.connectionStatus,
    displayName: channel.displayName,
    phoneNumber: channel.phoneNumber,
    phoneNumberId: channel.phoneNumberId ?? null,
    businessAccountId: channel.businessAccountId ?? null,
    accessTokenLastFour: channel.accessTokenLastFour ?? null,
    verifyTokenLastFour: channel.verifyTokenLastFour ?? null,
    qrCodeDataUrl: channel.qrCodeDataUrl,
    qrCodeUpdatedAt: channel.qrCodeUpdatedAt,
    lastError: channel.lastError,
    connectedAt: channel.connectedAt,
    tokenExpiresAt: channel.tokenExpiresAt ?? null,
    disconnectedAt: channel.disconnectedAt ?? null,
    lastSeenAt: channel.lastSeenAt,
    lastWebhookAt: channel.lastWebhookAt ?? null,
    updatedAt: channel.updatedAt
  } satisfies WorkspaceWhatsAppChannelStatus;
}

export async function saveWhatsAppChannelConnectionMethod(input: {
  workspaceId: string;
  channelId: string;
  connectionMethod: WhatsAppConnectionMethod;
}) {
  const existing = await prisma.whatsAppChannel.findFirst({
    where: {
      id: input.channelId,
      workspaceId: input.workspaceId
    },
    select: {
      id: true
    }
  });

  if (!existing) {
    throw new Error("Workspace isolation check failed for WhatsApp connection method save.");
  }

  await prisma.$executeRaw`
    UPDATE "WhatsAppChannel"
    SET
      "channelType" = ${input.connectionMethod === "api" ? "cloudapi" : "web"},
      "provider" = ${input.connectionMethod === "api" ? "meta" : null},
      "lastSeenAt" = NOW(),
      "updatedAt" = NOW()
    WHERE id = ${existing.id}
  `;

  return getWhatsAppChannelStatusById(existing.id);
}

function channelPriority(channel: {
  connectionStatus: string;
  updatedAt: Date;
  createdAt?: Date;
}) {
  const connectedScore = ["READY", "SYNCING_HISTORY", "CONNECTED", "AUTHENTICATED", "QR_READY", "INITIALIZING"].includes(
    channel.connectionStatus
  )
    ? 1
    : 0;
  return [connectedScore, channel.updatedAt.getTime(), channel.createdAt?.getTime() ?? 0] as const;
}

function pickPreferredChannel<T extends WorkspaceWhatsAppChannelStatus & { createdAt?: Date }>(channels: T[]) {
  return [...channels].sort((left, right) => {
    const leftPriority = channelPriority(left);
    const rightPriority = channelPriority(right);

    if (leftPriority[0] !== rightPriority[0]) {
      return rightPriority[0] - leftPriority[0];
    }
    if (leftPriority[1] !== rightPriority[1]) {
      return rightPriority[1] - leftPriority[1];
    }
    return rightPriority[2] - leftPriority[2];
  })[0] ?? null;
}

export async function getWhatsAppChannelStatusById(channelId: string) {
  let channel;
  try {
    channel = await prisma.whatsAppChannel.findUnique({
      where: { id: channelId },
      include: {
        connectedByAgent: {
          select: { id: true, name: true, email: true }
        }
      }
    });
  } catch (error) {
    if (!isMissingWhatsAppIncognitoColumnError(error)) {
      throw error;
    }

    const legacyRow = (await getLegacyWhatsAppChannelRows({ channelId }))[0];
    return legacyRow ? mapChannelStatus(mapLegacyChannelRow(legacyRow)) : null;
  }

  return mapChannelStatus(channel);
}

export async function getWorkspaceWhatsAppChannels(workspaceId: string) {
  let channels;
  try {
    channels = await prisma.whatsAppChannel.findMany({
      where: { workspaceId },
      include: {
        connectedByAgent: {
          select: { id: true, name: true, email: true }
        }
      },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }]
    });
  } catch (error) {
    if (!isMissingWhatsAppIncognitoColumnError(error)) {
      throw error;
    }

    const legacyRows = await getLegacyWhatsAppChannelRows({ workspaceId });
    return legacyRows.map((row) => ({
      ...mapChannelStatus(mapLegacyChannelRow(row))!,
      createdAt: row.createdAt
    }));
  }

  return channels.map((channel) => ({
    ...mapChannelStatus(channel)!,
    createdAt: channel.createdAt
  }));
}

export async function ensureWorkspaceDefaultWhatsAppChannel(workspaceId: string) {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true }
  });

  if (!workspace) {
    return null;
  }

  const existingChannels = await getWorkspaceWhatsAppChannels(workspaceId);
  const preferred = pickPreferredChannel(existingChannels);
  if (preferred) {
    return preferred;
  }

  const created = await prisma.whatsAppChannel.create({
    data: {
      workspaceId,
      connectionStatus: "DISCONNECTED",
      qrCodeDataUrl: null,
      qrCodeUpdatedAt: null,
      lastSeenAt: new Date()
    },
    include: {
      connectedByAgent: {
        select: { id: true, name: true, email: true }
      }
    }
  });

  return {
    ...mapChannelStatus(created)!,
    createdAt: created.createdAt
  };
}

export async function createWorkspaceWhatsAppChannel(workspaceId: string) {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true }
  });

  if (!workspace) {
    return null;
  }

  await assertWorkspaceHasWhatsAppNumberCapacity(workspaceId);

  const created = await prisma.whatsAppChannel.create({
    data: {
      workspaceId,
      connectionStatus: "DISCONNECTED",
      qrCodeDataUrl: null,
      qrCodeUpdatedAt: null,
      lastSeenAt: new Date()
    },
    include: {
      connectedByAgent: {
        select: { id: true, name: true, email: true }
      }
    }
  });

  return {
    ...mapChannelStatus(created)!,
    createdAt: created.createdAt
  };
}

export async function getWorkspaceWhatsAppChannelStatus(workspaceId: string) {
  const channels = await getWorkspaceWhatsAppChannels(workspaceId);
  return pickPreferredChannel(channels);
}

export async function setWhatsAppChannelIncognitoMode(input: {
  workspaceId: string;
  channelId: string;
  incognitoMode: boolean;
}) {
  let existing;
  try {
    existing = await prisma.whatsAppChannel.findFirst({
      where: {
        id: input.channelId,
        workspaceId: input.workspaceId
      },
      select: {
        id: true,
        channelType: true,
        phoneNumberId: true,
        accessTokenCiphertext: true
      }
    });
  } catch (error) {
    if (isMissingWhatsAppIncognitoColumnError(error)) {
      throw new Error("Incognito mode is not available until the latest database migration is applied.");
    }
    throw error;
  }

  if (!existing) {
    throw new Error("WhatsApp channel was not found.");
  }

  if (
    !isPersonalWhatsAppSession({
      channelType: existing.channelType,
      phoneNumberId: existing.phoneNumberId,
      accessTokenCiphertext: existing.accessTokenCiphertext
    })
  ) {
    throw new Error("Incognito mode is only available for personal WhatsApp sessions.");
  }

  try {
    await prisma.whatsAppChannel.update({
      where: { id: existing.id },
      data: {
        incognitoMode: input.incognitoMode,
        lastSeenAt: new Date()
      }
    });
  } catch (error) {
    if (isMissingWhatsAppIncognitoColumnError(error)) {
      throw new Error("Incognito mode is not available until the latest database migration is applied.");
    }
    throw error;
  }

  return getWhatsAppChannelStatusById(existing.id);
}

export async function isWhatsAppChannelIncognitoModeEnabled(input: {
  workspaceId: string;
  channelId?: string | null;
}) {
  if (!input.channelId) {
    return false;
  }

  let channel;
  try {
    channel = await prisma.whatsAppChannel.findFirst({
      where: {
        id: input.channelId,
        workspaceId: input.workspaceId
      },
      select: {
        channelType: true,
        phoneNumberId: true,
        accessTokenCiphertext: true,
        incognitoMode: true
      }
    });
  } catch (error) {
    if (isMissingWhatsAppIncognitoColumnError(error)) {
      return false;
    }
    throw error;
  }

  return (
    !!channel &&
    isPersonalWhatsAppSession({
      channelType: channel.channelType,
      phoneNumberId: channel.phoneNumberId,
      accessTokenCiphertext: channel.accessTokenCiphertext
    }) &&
    channel.incognitoMode === true
  );
}

export async function isConversationWhatsAppIncognitoModeEnabled(input: {
  workspaceId: string;
  conversationId: string;
}) {
  let conversation;
  try {
    conversation = await prisma.conversation.findFirst({
      where: {
        id: input.conversationId,
        workspaceId: input.workspaceId
      },
      select: {
        channel: {
          select: {
            channelType: true,
            phoneNumberId: true,
            accessTokenCiphertext: true,
            incognitoMode: true
          }
        }
      }
    });
  } catch (error) {
    if (isMissingWhatsAppIncognitoColumnError(error)) {
      return false;
    }
    throw error;
  }

  return (
    !!conversation?.channel &&
    isPersonalWhatsAppSession({
      channelType: conversation.channel.channelType,
      phoneNumberId: conversation.channel.phoneNumberId,
      accessTokenCiphertext: conversation.channel.accessTokenCiphertext
    }) &&
    conversation.channel.incognitoMode === true
  );
}

export async function saveWhatsAppChannelConnection(input: SaveWhatsAppChannelConnectionInput) {
  const workspace = await prisma.workspace.findUnique({
    where: { id: input.workspaceId },
    select: { id: true }
  });

  if (!workspace) {
    console.warn(
      `[whatsapp-channel] skipped channel save because workspace ${input.workspaceId} does not exist.`
    );
    return null;
  }

  const connectedByAgentId =
    input.agentId === undefined
      ? undefined
      : input.agentId
        ? await prisma.agent
            .findFirst({
              where: {
                id: input.agentId,
                workspaceId: input.workspaceId
              },
              select: { id: true }
            })
            .then((agent) => agent?.id ?? null)
        : null;

  const existing =
    (input.channelId
      ? await prisma.whatsAppChannel.findFirst({
          where: {
            id: input.channelId,
            workspaceId: input.workspaceId
          }
        })
      : null) ?? (await ensureWorkspaceDefaultWhatsAppChannel(input.workspaceId));

  if (!existing) {
    return null;
  }

  return prisma.whatsAppChannel.update({
    where: { id: existing.id },
    data: {
      connectedByAgentId:
        connectedByAgentId !== undefined ? connectedByAgentId : existing.connectedByAgentId,
      sessionClientId:
        input.sessionClientId !== undefined ? input.sessionClientId : existing.sessionClientId,
      connectionStatus: input.connectionStatus,
      displayName:
        input.displayName !== undefined
          ? sanitizeWhatsAppChannelDisplayName(input.displayName)
          : existing.displayName,
      phoneNumber: input.phoneNumber !== undefined ? input.phoneNumber : existing.phoneNumber,
      qrCodeDataUrl: input.qrCodeDataUrl !== undefined ? input.qrCodeDataUrl : existing.qrCodeDataUrl,
      qrCodeUpdatedAt:
        input.qrCodeUpdatedAt !== undefined ? input.qrCodeUpdatedAt : existing.qrCodeUpdatedAt,
      lastError: input.lastError !== undefined ? input.lastError : existing.lastError,
      connectedAt: input.connectedAt !== undefined ? input.connectedAt : existing.connectedAt,
      provider: null,
      channelType: "web",
      lastSeenAt: new Date()
    }
  });
}

export async function saveWorkspaceWhatsAppChannelConnection(
  input: SaveWhatsAppChannelConnectionInput
) {
  return saveWhatsAppChannelConnection(input);
}

export async function clearWhatsAppChannelSession(input: {
  channelId?: string | null;
  workspaceId: string;
  lastError?: string | null;
  authPath?: string | null;
}) {
  const existing =
    (input.channelId
      ? await prisma.whatsAppChannel.findFirst({
          where: {
            id: input.channelId,
            workspaceId: input.workspaceId
          }
        })
      : null) ?? (await ensureWorkspaceDefaultWhatsAppChannel(input.workspaceId));

  if (!existing) {
    if (input.authPath) {
      await rm(input.authPath, { recursive: true, force: true }).catch(() => null);
    }
    return null;
  }

  await prisma.whatsAppChannel.update({
    where: { id: existing.id },
    data: {
      connectedByAgentId: null,
      sessionClientId: null,
      connectionStatus: "DISCONNECTED",
      displayName: null,
      phoneNumber: existing.phoneNumber,
      qrCodeDataUrl: null,
      qrCodeUpdatedAt: null,
      lastError: input.lastError ?? null,
      connectedAt: null,
      disconnectedAt: new Date(),
      lastSeenAt: new Date()
    } as any
  });

  if (input.authPath) {
    await rm(input.authPath, { recursive: true, force: true }).catch(() => null);
  }
}

export async function clearWorkspaceWhatsAppSession(
  workspaceId: string,
  lastError?: string | null,
  authPath?: string | null
) {
  return clearWhatsAppChannelSession({ workspaceId, lastError, authPath });
}

export async function markWhatsAppChannelDisconnected(
  input: MarkWhatsAppChannelDisconnectedInput
) {
  const existing =
    (input.channelId
      ? await prisma.whatsAppChannel.findFirst({
          where: {
            id: input.channelId,
            workspaceId: input.workspaceId
          }
        })
      : null) ?? (await ensureWorkspaceDefaultWhatsAppChannel(input.workspaceId));

  if (!existing) {
    return null;
  }

  return prisma.whatsAppChannel.update({
    where: { id: existing.id },
    data: {
      connectionStatus: input.connectionStatus ?? "DISCONNECTED",
      qrCodeDataUrl: null,
      qrCodeUpdatedAt: null,
      lastError: input.lastError ?? null,
      disconnectedAt: new Date(),
      lastSeenAt: new Date()
    } as any
  });
}

export async function markWorkspaceWhatsAppChannelDisconnected(
  input: MarkWhatsAppChannelDisconnectedInput
) {
  return markWhatsAppChannelDisconnected(input);
}

export async function saveWhatsAppCloudCredentials(input: {
  workspaceId: string;
  channelId: string;
  phoneNumberId: string;
  businessAccountId?: string | null;
  accessToken: string;
  appSecret?: string | null;
  verifyToken?: string | null;
  displayName?: string | null;
  phoneNumber?: string | null;
  provider?: string | null;
  channelType?: string | null;
  tokenExpiresAt?: Date | null;
}) {
  const existing = await prisma.whatsAppChannel.findFirst({
    where: {
      id: input.channelId,
      workspaceId: input.workspaceId
    },
    select: {
      id: true
    }
  });

  if (!existing) {
    throw new Error("Workspace isolation check failed for Cloud credential save.");
  }

  const normalizedAccessToken = input.accessToken.trim();
  if (!normalizedAccessToken) {
    throw new Error("WhatsApp Cloud access token is required.");
  }

  const normalizedPhoneNumberId = input.phoneNumberId.trim();
  if (!normalizedPhoneNumberId) {
    throw new Error("WhatsApp Cloud phone number id is required.");
  }

  const normalizedAppSecret = input.appSecret?.trim() || null;
  const normalizedVerifyToken = input.verifyToken?.trim() || null;
  const defaultMetaVerifyToken = await getMetaWebhookVerifyToken();
  const shouldPersistVerifyTokenHash = Boolean(
    normalizedVerifyToken && (!defaultMetaVerifyToken || normalizedVerifyToken !== defaultMetaVerifyToken)
  );

  return prisma.whatsAppChannel.update({
    where: {
      id: existing.id
    },
    data: {
      provider: input.provider?.trim() || "meta",
      channelType: input.channelType?.trim() || "cloudapi",
      phoneNumberId: normalizedPhoneNumberId,
      businessAccountId: input.businessAccountId?.trim() || null,
      accessTokenCiphertext: encryptSecret(normalizedAccessToken),
      accessTokenLastFour: normalizedAccessToken.slice(-4) || null,
      appSecretCiphertext: normalizedAppSecret ? encryptSecret(normalizedAppSecret) : null,
      appSecretLastFour: normalizedAppSecret ? normalizedAppSecret.slice(-4) : null,
      verifyTokenHash: shouldPersistVerifyTokenHash ? hashSecret(normalizedVerifyToken!) : null,
      verifyTokenLastFour: normalizedVerifyToken ? normalizedVerifyToken.slice(-4) : null,
      displayName: sanitizeWhatsAppChannelDisplayName(input.displayName) ?? undefined,
      phoneNumber: input.phoneNumber?.trim() || undefined,
      connectionStatus: "CONNECTED",
      connectedAt: new Date(),
      disconnectedAt: null,
      tokenExpiresAt: input.tokenExpiresAt ?? null,
      lastSeenAt: new Date()
    } as any
  });
}

export async function deleteWhatsAppSession(input: {
  channelId?: string | null;
  workspaceId: string;
  authPath?: string | null;
}) {
  const channels = await prisma.whatsAppChannel.findMany({
    where: {
      workspaceId: input.workspaceId
    },
    orderBy: [{ createdAt: "asc" }]
  });
  const existing = input.channelId
    ? channels.find((channel) => channel.id === input.channelId) ?? null
    : null;

  if (existing) {
    if (shouldDeleteChannelRecord(channels.length)) {
      await prisma.whatsAppChannel.delete({
        where: { id: existing.id }
      });
    } else {
      await clearWhatsAppChannelSession({
        workspaceId: input.workspaceId,
        channelId: existing.id,
        authPath: input.authPath
      });
      return;
    }
  } else if (!input.channelId) {
    if (channels.length <= 1) {
      const lastChannel = channels[0] ?? null;
      if (lastChannel) {
        await clearWhatsAppChannelSession({
          workspaceId: input.workspaceId,
          channelId: lastChannel.id,
          authPath: input.authPath
        });
        return;
      }
    } else {
      await prisma.whatsAppChannel.deleteMany({
        where: { workspaceId: input.workspaceId }
      });
    }
  }

  if (input.authPath) {
    await rm(input.authPath, { recursive: true, force: true }).catch(() => null);
  }
}

export async function deleteWhatsAppChannelRecord(input: {
  workspaceId: string;
  channelId: string;
}) {
  const existing = await prisma.whatsAppChannel.findFirst({
    where: {
      id: input.channelId,
      workspaceId: input.workspaceId
    },
    select: {
      id: true
    }
  });

  if (!existing) {
    return null;
  }

  await prisma.whatsAppChannel.delete({
    where: {
      id: existing.id
    }
  });

  return existing;
}

export async function clearWhatsAppChannelInboxData(input: {
  workspaceId: string;
  channelId: string;
}) {
  const conversations = await prisma.conversation.findMany({
    where: {
      workspaceId: input.workspaceId,
      channelId: input.channelId
    },
    select: {
      id: true,
      contactId: true
    }
  });

  if (!conversations.length) {
    await prisma.whatsAppMessageEnvelope.deleteMany({
      where: {
        workspaceId: input.workspaceId,
        channelId: input.channelId
      }
    });

    return {
      deletedContactCount: 0,
      deletedConversationCount: 0
    };
  }

  const conversationIds = conversations.map((conversation) => conversation.id);
  const contactIds = Array.from(new Set(conversations.map((conversation) => conversation.contactId)));
  let deletedContactCount = 0;

  await prisma.$transaction(async (tx) => {
    await tx.whatsAppMessageEnvelope.deleteMany({
      where: {
        workspaceId: input.workspaceId,
        channelId: input.channelId
      }
    });

    await tx.conversation.deleteMany({
      where: {
        workspaceId: input.workspaceId,
        channelId: input.channelId,
        id: {
          in: conversationIds
        }
      }
    });

    for (const contactId of contactIds) {
      const remainingConversationCount = await tx.conversation.count({
        where: {
          workspaceId: input.workspaceId,
          contactId
        }
      });

      if (remainingConversationCount === 0) {
        await tx.contact.delete({
          where: {
            id: contactId
          }
        }).then(() => {
          deletedContactCount += 1;
        }).catch(() => null);
      }
    }
  });

  return {
    deletedContactCount,
    deletedConversationCount: conversationIds.length
  };
}

export async function deleteWorkspaceWhatsAppSession(
  workspaceId: string,
  authPath?: string | null
) {
  return deleteWhatsAppSession({ workspaceId, authPath });
}
