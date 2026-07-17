import { prisma } from "@/lib/prisma";
import { getPreferredWhatsAppChannelLabel } from "@/lib/whatsapp-channel-label";
import { ensureWorkspaceDefaultWhatsAppChannel, getWhatsAppChannelStatusById, getWorkspaceWhatsAppChannelStatus } from "@/lib/whatsapp-channel";

export async function resolveWorkspaceDefaultChannelId(workspaceId: string) {
  const channel = await ensureWorkspaceDefaultWhatsAppChannel(workspaceId);
  return channel?.id ?? null;
}

export async function resolveConversationChannelId(input: {
  workspaceId: string;
  conversationId: string;
  fallbackChannelId?: string | null;
}) {
  const conversation = await prisma.conversation.findFirst({
    where: {
      id: input.conversationId,
      workspaceId: input.workspaceId
    },
    select: {
      id: true,
      channelId: true
    }
  });

  if (!conversation) {
    return null;
  }

  if (conversation.channelId) {
    return conversation.channelId;
  }

  const fallbackChannelId =
    input.fallbackChannelId ??
    (await getWorkspaceWhatsAppChannelStatus(input.workspaceId))?.id ??
    (await resolveWorkspaceDefaultChannelId(input.workspaceId));

  if (!fallbackChannelId) {
    return null;
  }

  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { channelId: fallbackChannelId }
  });

  return fallbackChannelId;
}

export async function resolveOutboundJobChannelId(input: {
  workspaceId: string;
  conversationId: string;
  explicitChannelId?: string | null;
}) {
  if (input.explicitChannelId) {
    return input.explicitChannelId;
  }

  return resolveConversationChannelId({
    workspaceId: input.workspaceId,
    conversationId: input.conversationId
  });
}

export async function formatChannelLabel(channelId: string | null | undefined) {
  if (!channelId) {
    return null;
  }

  const channel = await getWhatsAppChannelStatusById(channelId);
  if (!channel) {
    return null;
  }

  return getPreferredWhatsAppChannelLabel({
    displayName: channel.displayName,
    phoneNumber: channel.phoneNumber,
    fallbackLabel: `Channel ${channel.id.slice(0, 8)}`
  });
}
