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
  sendWhatsAppWebMessage as sendEmbeddedWhatsAppWebMessage,
  syncWorkspaceHistory as syncEmbeddedWorkspaceHistory
} from "@/lib/whatsapp-web";

export function isEmbeddedWhatsAppRuntimeEnabled() {
  return !isRemoteSenderServiceEnabled();
}

export async function getWorkspaceWhatsAppRuntimeStatus(input: {
  workspaceId: string;
  agentId: string;
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
}) {
  if (isRemoteSenderServiceEnabled()) {
    return ensureRemoteWorkspaceWhatsAppClient(input);
  }

  return ensureEmbeddedWorkspaceWhatsAppClient(input);
}

export async function disconnectWorkspaceWhatsAppClient(workspaceId: string) {
  if (isRemoteSenderServiceEnabled()) {
    return disconnectRemoteWorkspaceWhatsAppClient(workspaceId);
  }

  return disconnectEmbeddedWorkspaceWhatsAppClient(workspaceId);
}

export async function deleteWorkspaceWhatsAppClientSession(workspaceId: string) {
  if (isRemoteSenderServiceEnabled()) {
    return deleteRemoteWorkspaceWhatsAppClientSession(workspaceId);
  }

  return deleteEmbeddedWorkspaceWhatsAppClientSession(workspaceId);
}

export async function syncWorkspaceHistory(workspaceId: string) {
  if (isRemoteSenderServiceEnabled()) {
    return syncRemoteWorkspaceHistory(workspaceId);
  }

  return syncEmbeddedWorkspaceHistory(workspaceId);
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
}) {
  if (isRemoteSenderServiceEnabled()) {
    return sendRemoteWhatsAppMessage(input);
  }

  return sendEmbeddedWhatsAppWebMessage(input);
}

export async function deleteWhatsAppMessageForEveryone(input: {
  workspaceId: string;
  providerMessageId: string;
}) {
  if (isRemoteSenderServiceEnabled()) {
    return deleteRemoteWhatsAppMessageForEveryone(input);
  }

  return deleteEmbeddedWhatsAppWebMessageForEveryone(input);
}
