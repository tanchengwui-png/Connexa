export type WhatsAppTemplateComponentParameter = {
  type?: string;
  text?: string;
  payload?: string;
  currency?: {
    fallback_value?: string;
    code?: string;
    amount_1000?: number;
  };
  date_time?: {
    fallback_value?: string;
  };
  image?: {
    link?: string;
  };
  video?: {
    link?: string;
  };
  document?: {
    link?: string;
    filename?: string;
  };
  link?: string;
  filename?: string;
};

export type WhatsAppTemplateComponent = {
  type?: string;
  sub_type?: string;
  index?: string | number;
  parameters?: WhatsAppTemplateComponentParameter[];
};

export type WhatsAppProviderAccount = {
  id?: string;
  workspaceId?: string;
  channel?: string | null;
  provider?: string | null;
  phoneNumberId?: string | null;
  businessAccountId?: string | null;
  accessToken?: string | null;
  accessTokenCiphertext?: string | null;
  appSecret?: string | null;
  appSecretCiphertext?: string | null;
  phoneNumber?: string | null;
  displayName?: string | null;
};

export type WhatsAppSendMessageInput = {
  account?: WhatsAppProviderAccount | null;
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
};

export type WhatsAppSendTemplateInput = {
  account?: WhatsAppProviderAccount | null;
  channelId?: string | null;
  workspaceId?: string;
  conversationId?: string;
  to: string;
  name: string;
  body?: string;
  languageCode?: string | null;
  variables?: Array<string | number | boolean | WhatsAppTemplateComponentParameter> | null;
  bodyVariables?: Array<string | number | boolean | WhatsAppTemplateComponentParameter> | null;
  components?: WhatsAppTemplateComponent[] | null;
};

export type WhatsAppSendResult = {
  providerMessageId: string;
  status: "accepted";
};

export type WhatsAppBroadcastInput = {
  account?: WhatsAppProviderAccount | null;
  channelId?: string | null;
  workspaceId?: string;
  template?: Omit<WhatsAppSendTemplateInput, "account" | "to"> | null;
  recipients: Array<WhatsAppSendMessageInput | WhatsAppSendTemplateInput>;
};

export declare function sendMessage(input: WhatsAppSendMessageInput): Promise<WhatsAppSendResult>;
export declare function sendTemplate(input: WhatsAppSendTemplateInput): Promise<WhatsAppSendResult>;
export declare function broadcast(input: WhatsAppBroadcastInput): Promise<{
  provider: "personal" | "cloud";
  sent: number;
  results: WhatsAppSendResult[];
}>;
export declare function resolveProviderAccount(input: {
  account?: WhatsAppProviderAccount | null;
  channelId?: string | null;
}): Promise<WhatsAppProviderAccount & { channel: "personal" | "cloud" }>;
