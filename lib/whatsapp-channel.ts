import { rm } from "fs/promises";
import { prisma } from "@/lib/prisma";

export type WhatsAppProviderMode = "webjs";

type SaveWhatsAppChannelConnectionInput = {
  workspaceId: string;
  agentId?: string | null;
  sessionClientId?: string | null;
  connectionStatus: string;
  displayName?: string | null;
  phoneNumber?: string | null;
  lastError?: string | null;
  connectedAt?: Date | null;
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
    lastError: channel.lastError,
    connectedAt: channel.connectedAt,
    lastSeenAt: channel.lastSeenAt,
    updatedAt: channel.updatedAt
  };
}

export async function saveWorkspaceWhatsAppChannelConnection(
  input: SaveWhatsAppChannelConnectionInput
) {
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
          input.agentId !== undefined ? input.agentId : existing.connectedByAgentId,
        sessionClientId:
          input.sessionClientId !== undefined ? input.sessionClientId : existing.sessionClientId,
        connectionStatus: input.connectionStatus,
        displayName: input.displayName !== undefined ? input.displayName : existing.displayName,
        phoneNumber: input.phoneNumber !== undefined ? input.phoneNumber : existing.phoneNumber,
        lastError: input.lastError !== undefined ? input.lastError : existing.lastError,
        connectedAt: input.connectedAt !== undefined ? input.connectedAt : existing.connectedAt,
        lastSeenAt: new Date()
      }
    });
  }

  return prisma.whatsAppChannel.create({
    data: {
      workspaceId: input.workspaceId,
      connectedByAgentId: input.agentId ?? null,
      sessionClientId: input.sessionClientId ?? null,
      connectionStatus: input.connectionStatus,
      displayName: input.displayName ?? null,
      phoneNumber: input.phoneNumber ?? null,
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
      lastError: lastError ?? null,
      connectedAt: null,
      lastSeenAt: new Date()
    },
    create: {
      workspaceId,
      connectionStatus: "DISCONNECTED",
      lastError: lastError ?? null,
      lastSeenAt: new Date()
    }
  });

  if (authPath) {
    await rm(authPath, { recursive: true, force: true }).catch(() => null);
  }
}
