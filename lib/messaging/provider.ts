import { isWhatsAppMockModeEnabled } from "@/lib/whatsapp-channel";
import { sendWhatsAppMessage } from "@/lib/whatsapp-runtime";

type OutboundMessagePayload = {
  agentId?: string;
  attachmentMimeType?: string | null;
  attachmentName?: string | null;
  attachmentPath?: string | null;
  attachmentUrl?: string | null;
  interactiveButtons?: string[] | null;
  interactiveListButtonText?: string | null;
  interactiveListOptions?: string[] | null;
  conversationId: string;
  workspaceId: string;
  to: string;
  body: string;
};

export type OutboundMessageResult = {
  providerMessageId: string;
  status: "accepted";
};

export interface MessagingProvider {
  sendOutboundMessage(payload: OutboundMessagePayload): Promise<OutboundMessageResult>;
}

class WebJsWhatsAppProvider implements MessagingProvider {
  async sendOutboundMessage(payload: OutboundMessagePayload): Promise<OutboundMessageResult> {
    return sendWhatsAppMessage({
      workspaceId: payload.workspaceId,
      to: payload.to,
      body: payload.body,
      interactiveButtons: payload.interactiveButtons,
      interactiveListButtonText: payload.interactiveListButtonText,
      interactiveListOptions: payload.interactiveListOptions,
      attachmentPath: payload.attachmentPath,
      attachmentUrl: payload.attachmentUrl,
      attachmentMimeType: payload.attachmentMimeType,
      attachmentName: payload.attachmentName
    });
  }
}

class MockWhatsAppProvider implements MessagingProvider {
  async sendOutboundMessage(payload: OutboundMessagePayload): Promise<OutboundMessageResult> {
    return {
      providerMessageId: `mock-${payload.conversationId}-${Date.now()}`,
      status: "accepted"
    };
  }
}

export function getMessagingProvider() {
  if (isWhatsAppMockModeEnabled()) {
    return new MockWhatsAppProvider();
  }

  return new WebJsWhatsAppProvider();
}
