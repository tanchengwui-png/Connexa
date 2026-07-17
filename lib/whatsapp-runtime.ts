import {
  deleteRemoteWorkspaceWhatsAppClientSession,
  deleteRemoteWhatsAppMessageForEveryone,
  disconnectRemoteWorkspaceWhatsAppClient,
  ensureRemoteWorkspaceWhatsAppClient,
  getRemoteSenderServiceMetrics,
  getRemoteWhatsAppRuntimeStatus,
  isRemoteSenderServiceEnabled,
  listRemoteWhatsAppMentionCandidates,
  resolveRemoteWhatsAppContacts,
  setRemoteWhatsAppChatMute,
  sendRemoteWhatsAppChatSeen,
  sendRemoteWhatsAppMessage,
  syncRemoteWorkspaceHistory
} from "@/lib/sender-service-client";
import {
  deleteWhatsAppWebMessageForEveryone as deleteEmbeddedWhatsAppWebMessageForEveryone,
  deleteWorkspaceWhatsAppClientSession as deleteEmbeddedWorkspaceWhatsAppClientSession,
  disconnectWorkspaceWhatsAppClient as disconnectEmbeddedWorkspaceWhatsAppClient,
  ensureWorkspaceWhatsAppClient as ensureEmbeddedWorkspaceWhatsAppClient,
  getWhatsAppSenderNodeMetrics as getEmbeddedWhatsAppSenderNodeMetrics,
  getWorkspaceWhatsAppRuntimeStatus as getEmbeddedWhatsAppRuntimeStatus,
  listWhatsAppMentionCandidates as listEmbeddedWhatsAppMentionCandidates,
  resolveWhatsAppContacts as resolveEmbeddedWhatsAppContacts,
  setWhatsAppWebChatMute as setEmbeddedWhatsAppWebChatMute,
  sendWhatsAppWebChatSeen as sendEmbeddedWhatsAppWebChatSeen,
  sendWhatsAppWebMessage as sendEmbeddedWhatsAppWebMessage,
  syncWorkspaceHistory as syncEmbeddedWorkspaceHistory
} from "@/lib/whatsapp-web";

export function isEmbeddedWhatsAppRuntimeEnabled() {
  return !isRemoteSenderServiceEnabled();
}

export async function getWorkspaceWhatsAppRuntimeStatus(input: {
  workspaceId: string;
  agentId: string;
  channelId?: string | null;
}) {
  if (isRemoteSenderServiceEnabled()) {
    return getRemoteWhatsAppRuntimeStatus(input);
  }

  return getEmbeddedWhatsAppRuntimeStatus(input);
}

export async function getWhatsAppSenderNodeMetrics() {
  if (isRemoteSenderServiceEnabled()) {
    return getRemoteSenderServiceMetrics();
  }

  return getEmbeddedWhatsAppSenderNodeMetrics();
}

export async function ensureWorkspaceWhatsAppClient(input: {
  workspaceId: string;
  agentId: string;
  channelId?: string | null;
}) {
  if (isRemoteSenderServiceEnabled()) {
    return ensureRemoteWorkspaceWhatsAppClient(input);
  }

  return ensureEmbeddedWorkspaceWhatsAppClient(input);
}

export async function disconnectWorkspaceWhatsAppClient(workspaceId: string, channelId?: string | null) {
  if (isRemoteSenderServiceEnabled()) {
    return disconnectRemoteWorkspaceWhatsAppClient(workspaceId, channelId);
  }

  return disconnectEmbeddedWorkspaceWhatsAppClient(workspaceId, channelId);
}

export async function deleteWorkspaceWhatsAppClientSession(workspaceId: string, channelId?: string | null) {
  if (isRemoteSenderServiceEnabled()) {
    return deleteRemoteWorkspaceWhatsAppClientSession(workspaceId, channelId);
  }

  return deleteEmbeddedWorkspaceWhatsAppClientSession(workspaceId, channelId);
}

export async function syncWorkspaceHistory(
  workspaceId: string,
  channelIdOrOptions?: string | { triggeredBy?: "manual" | "background" } | null,
  options: { triggeredBy?: "manual" | "background" } = {}
) {
  if (isRemoteSenderServiceEnabled()) {
    return syncRemoteWorkspaceHistory(workspaceId, channelIdOrOptions, options);
  }

  return syncEmbeddedWorkspaceHistory(workspaceId, channelIdOrOptions, options);
}

export async function resolveWhatsAppContacts(input: {
  workspaceId: string;
  mentionIds: string[];
}) {
  if (isRemoteSenderServiceEnabled()) {
    return resolveRemoteWhatsAppContacts(input);
  }

  return resolveEmbeddedWhatsAppContacts(input);
}

export async function listWhatsAppMentionCandidates(input: {
  workspaceId: string;
  conversationId: string;
  query?: string | null;
}) {
  if (isRemoteSenderServiceEnabled()) {
    return listRemoteWhatsAppMentionCandidates(input);
  }

  return listEmbeddedWhatsAppMentionCandidates(input);
}

export async function sendWhatsAppMessage(input: {
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
  if (isRemoteSenderServiceEnabled()) {
    return sendRemoteWhatsAppMessage(input);
  }

  return sendEmbeddedWhatsAppWebMessage(input);
}

export async function deleteWhatsAppMessageForEveryone(input: {
  workspaceId: string;
  channelId?: string | null;
  providerMessageId: string;
}) {
  if (isRemoteSenderServiceEnabled()) {
    return deleteRemoteWhatsAppMessageForEveryone(input);
  }

  return deleteEmbeddedWhatsAppWebMessageForEveryone(input);
}

export async function sendWhatsAppChatSeen(input: {
  workspaceId: string;
  channelId?: string | null;
  conversationId: string;
}) {
  if (isRemoteSenderServiceEnabled()) {
    return sendRemoteWhatsAppChatSeen(input);
  }

  return sendEmbeddedWhatsAppWebChatSeen(input);
}

export async function setWhatsAppChatMute(input: {
  workspaceId: string;
  channelId?: string | null;
  conversationId: string;
  mute: boolean;
  muteUntil?: Date | null;
}) {
  if (isRemoteSenderServiceEnabled()) {
    return setRemoteWhatsAppChatMute({
      ...input,
      muteUntil: input.muteUntil?.toISOString() ?? null
    });
  }

  return setEmbeddedWhatsAppWebChatMute(input);
}
