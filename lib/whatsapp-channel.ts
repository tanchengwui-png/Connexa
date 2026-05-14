import { rm } from "fs/promises";
import { prisma } from "@/lib/prisma";

export type WhatsAppProviderMode = "webjs";
export type WorkspaceWhatsAppChannelStatus = {
  id: string;
  workspaceId: string;
  connectedByAgentId: string | null;
  connectedByAgentName: string | null;
  sessionClientId: string | null;
  connectionStatus: string;
  displayName: string | null;
  phoneNumber: string | null;
  qrCodeDataUrl: string | null;
  qrCodeUpdatedAt: Date | null;
  lastError: string | null;
  connectedAt: Date | null;
  lastSeenAt: Date | null;
  updatedAt: Date;
};

type SaveWhatsAppChannelConnectionInput = {
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

export async function getWorkspaceWhatsAppChannelStatus(workspaceId: string) {
  const channel = await prisma.whatsAppChannel.findUnique({
    where: {
      workspaceId
    },
    include: {
      connectedByAgent: {
        select: {
          id: true,
          name: true,
          email: true
        }
      }
    }
  });

  if (!channel) {
    return null;
  }

  return {
    id: channel.id,
    workspaceId: channel.workspaceId,
    connectedByAgentId: channel.connectedByAgentId,
    connectedByAgentName: channel.connectedByAgent?.name ?? null,
    sessionClientId: channel.sessionClientId,
    connectionStatus: channel.connectionStatus,
    displayName: channel.displayName,
    phoneNumber: channel.phoneNumber,
    qrCodeDataUrl: channel.qrCodeDataUrl,
    qrCodeUpdatedAt: channel.qrCodeUpdatedAt,
    lastError: channel.lastError,
    connectedAt: channel.connectedAt,
    lastSeenAt: channel.lastSeenAt,
    updatedAt: channel.updatedAt
  } satisfies WorkspaceWhatsAppChannelStatus;
}

export async function saveWorkspaceWhatsAppChannelConnection(
  input: SaveWhatsAppChannelConnectionInput
) {
  const workspace = await prisma.workspace.findUnique({
    where: {
      id: input.workspaceId
    },
    select: {
      id: true
    }
  });

  if (!workspace) {
    console.warn(
      `[whatsapp-channel] skipped channel save because workspace ${input.workspaceId} does not exist.`
    );
    return null;
  }

  const connectedByAgentId = input.agentId
    ? await prisma.agent
        .findFirst({
          where: {
            id: input.agentId,
            workspaceId: input.workspaceId
          },
          select: {
            id: true
          }
        })
        .then((agent) => agent?.id ?? null)
    : null;

  const existing = await prisma.whatsAppChannel.findUnique({
    where: {
      workspaceId: input.workspaceId
    }
  });

  if (existing) {
    return prisma.whatsAppChannel.update({
      where: {
        workspaceId: input.workspaceId
      },
      data: {
        connectedByAgentId:
          input.agentId !== undefined ? connectedByAgentId : existing.connectedByAgentId,
        sessionClientId:
          input.sessionClientId !== undefined ? input.sessionClientId : existing.sessionClientId,
        connectionStatus: input.connectionStatus,
        displayName: input.displayName !== undefined ? input.displayName : existing.displayName,
        phoneNumber: input.phoneNumber !== undefined ? input.phoneNumber : existing.phoneNumber,
        qrCodeDataUrl: input.qrCodeDataUrl !== undefined ? input.qrCodeDataUrl : existing.qrCodeDataUrl,
        qrCodeUpdatedAt:
          input.qrCodeUpdatedAt !== undefined ? input.qrCodeUpdatedAt : existing.qrCodeUpdatedAt,
        lastError: input.lastError !== undefined ? input.lastError : existing.lastError,
        connectedAt: input.connectedAt !== undefined ? input.connectedAt : existing.connectedAt,
        lastSeenAt: new Date()
      }
    });
  }

  return prisma.whatsAppChannel.create({
    data: {
      workspaceId: input.workspaceId,
      connectedByAgentId,
      sessionClientId: input.sessionClientId ?? null,
      connectionStatus: input.connectionStatus,
      displayName: input.displayName ?? null,
      phoneNumber: input.phoneNumber ?? null,
      qrCodeDataUrl: input.qrCodeDataUrl ?? null,
      qrCodeUpdatedAt: input.qrCodeUpdatedAt ?? null,
      lastError: input.lastError ?? null,
      connectedAt: input.connectedAt ?? null,
      lastSeenAt: new Date()
    }
  });
}

export async function clearWorkspaceWhatsAppSession(
  workspaceId: string,
  lastError?: string | null,
  authPath?: string | null
) {
  const workspace = await prisma.workspace.findUnique({
    where: {
      id: workspaceId
    },
    select: {
      id: true
    }
  });

  if (!workspace) {
    if (authPath) {
      await rm(authPath, { recursive: true, force: true }).catch(() => null);
    }
    return null;
  }

  await prisma.whatsAppChannel.upsert({
    where: {
      workspaceId
    },
    update: {
      connectedByAgentId: null,
      sessionClientId: null,
      connectionStatus: "DISCONNECTED",
      displayName: null,
      phoneNumber: null,
      qrCodeDataUrl: null,
      qrCodeUpdatedAt: null,
      lastError: lastError ?? null,
      connectedAt: null,
      lastSeenAt: new Date()
    },
    create: {
      workspaceId,
      connectionStatus: "DISCONNECTED",
      qrCodeDataUrl: null,
      qrCodeUpdatedAt: null,
      lastError: lastError ?? null,
      lastSeenAt: new Date()
    }
  });

  if (authPath) {
    await rm(authPath, { recursive: true, force: true }).catch(() => null);
  }
}

export async function markWorkspaceWhatsAppChannelDisconnected(
  input: MarkWhatsAppChannelDisconnectedInput
) {
  const workspace = await prisma.workspace.findUnique({
    where: {
      id: input.workspaceId
    },
    select: {
      id: true
    }
  });

  if (!workspace) {
    return null;
  }

  const existing = await prisma.whatsAppChannel.findUnique({
    where: {
      workspaceId: input.workspaceId
    }
  });

  if (!existing) {
    return prisma.whatsAppChannel.create({
      data: {
        workspaceId: input.workspaceId,
        connectionStatus: input.connectionStatus ?? "DISCONNECTED",
        qrCodeDataUrl: null,
        qrCodeUpdatedAt: null,
        lastError: input.lastError ?? null,
        lastSeenAt: new Date()
      }
    });
  }

  return prisma.whatsAppChannel.update({
    where: {
      workspaceId: input.workspaceId
    },
    data: {
      connectionStatus: input.connectionStatus ?? "DISCONNECTED",
      qrCodeDataUrl: null,
      qrCodeUpdatedAt: null,
      lastError: input.lastError ?? null,
      lastSeenAt: new Date()
    }
  });
}

export async function deleteWorkspaceWhatsAppSession(
  workspaceId: string,
  authPath?: string | null
) {
  await prisma.whatsAppChannel.deleteMany({
    where: {
      workspaceId
    }
  });

  if (authPath) {
    await rm(authPath, { recursive: true, force: true }).catch(() => null);
  }
}
