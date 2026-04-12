import {
  disconnectRemoteWorkspaceWhatsAppClient,
  ensureRemoteWorkspaceWhatsAppClient,
  getRemoteWhatsAppRuntimeStatus,
  isRemoteSenderServiceEnabled,
  sendRemoteWhatsAppMessage,
  syncRemoteWorkspaceHistory
} from "@/lib/sender-service-client";
import {
  disconnectWorkspaceWhatsAppClient as disconnectEmbeddedWorkspaceWhatsAppClient,
  ensureWorkspaceWhatsAppClient as ensureEmbeddedWorkspaceWhatsAppClient,
  getWorkspaceWhatsAppRuntimeStatus as getEmbeddedWhatsAppRuntimeStatus,
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

export async function syncWorkspaceHistory(workspaceId: string) {
  if (isRemoteSenderServiceEnabled()) {
    return syncRemoteWorkspaceHistory(workspaceId);
  }

  return syncEmbeddedWorkspaceHistory(workspaceId);
}

export async function sendWhatsAppMessage(input: {
  workspaceId: string;
  to: string;
  body: string;
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
