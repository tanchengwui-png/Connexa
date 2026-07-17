export type InboxConversation = {
  id: string;
  channelId: string | null;
  channelLabel: string | null;
  contactName: string;
  photoUrl: string | null;
  phone: string;
  isGroup: boolean;
  status: string;
  isSnoozed: boolean;
  snoozedUntil: string | null;
  snoozedUntilIso: string | null;
  snoozeReason: string | null;
  snoozeStatus: string | null;
  snoozedBy: {
    id: string;
    name: string;
  } | null;
  isMuted: boolean;
  muteExpiration: string | null;
  muteExpirationIso: string | null;
  isArchived: boolean;
  isPinned: boolean;
  unreadCount: number;
  tags: string[];
  isHotLead: boolean;
  scheduledCount: number;
  nextScheduledAt: string | null;
  nextScheduledAtIso: string | null;
  assigneeId: string | null;
  assignee: string;
  teammateIds: string[];
  teammates: Array<{
    id: string;
    name: string;
  }>;
  lastMessagePreview: string;
  lastMessageAt: string;
  lastMessageAtIso: string;
};

export const BUILT_IN_INBOX_FILTER_KEYS = [
  "all",
  "mine",
  "assigned-others",
  "unassigned",
  "unread",
  "hot",
  "snoozed"
] as const;

export type InboxBuiltInFilterKey = (typeof BUILT_IN_INBOX_FILTER_KEYS)[number];
export type InboxCustomFilterKey = `custom:${string}`;
export type InboxFilterKey = InboxBuiltInFilterKey | InboxCustomFilterKey;
export type InboxFilterCounts = Record<string, number>;
export type InboxCustomFilter = {
  key: InboxCustomFilterKey;
  label: string;
  tag: string;
};

export function isCustomInboxFilterKey(value: string): value is InboxCustomFilterKey {
  return value.startsWith("custom:");
}

export type InboxQuickReply = {
  id: string;
  title: string;
  shortcut: string;
  category: string;
  body: string;
  mediaAssetIds: string[];
};

export type InboxWhatsAppStatus = {
  callbackUrl: string;
  isConfigured: boolean;
  mode: "live" | "mock" | "webjs";
  phoneNumberId: string | null;
  channels: Array<{
    id: string;
    label: string;
    phoneNumber: string | null;
    runtimeStatus: string;
    connectionMethod: "api" | "web";
    incognitoMode: boolean;
    supportsNewNumberConversation: boolean;
  }>;
  updatedAt: string | null;
  runtimeStatus: string;
  isInboxReady: boolean;
  isHistoryStabilizing: boolean;
  isHistoryStuck: boolean;
  isLiveOnlyMode: boolean;
  importedConversationCount: number;
  importedMessageCount: number;
  lastSyncError: string | null;
};

export type InboxAgent = {
  id: string;
  name: string;
};

export type InboxContactTag = {
  id: string;
  name: string;
  description: string | null;
  source: "library" | "inferred";
};

export type InboxMediaAsset = {
  id: string;
  title: string;
  originalName?: string;
  publicUrl: string;
  kind: "IMAGE" | "AUDIO" | "VIDEO" | "DOCUMENT";
  mimeType: string;
  sizeLabel: string;
};

export type InboxComposerAttachment = {
  assetId: string;
  sendAsVoice: boolean;
};

export type InboxMentionCandidate = {
  id: string;
  label: string;
  token: string;
  phone: string | null;
  name: string | null;
  pushname: string | null;
};

export type InboxSelectedMention = {
  id: string;
  label: string;
  token: string;
};

export type InboxCurrentAgent = {
  id: string;
  name: string;
  role: "MANAGER" | "AGENT";
  workspaceId: string;
  inboxNotificationSoundsMuted: boolean;
  inboxDesktopNotificationsPromptDismissedAt: string | null;
};

export type InboxSummary = {
  open: number;
  pending: number;
  unassigned: number;
  hotLeads: number;
};

export type InboxNote = {
  id: string;
  body: string;
  author: string;
  createdAt: string;
  createdAtIso: string;
};

export type InboxConversationAuditEvent = {
  id: string;
  type: "ASSIGNED" | "REASSIGNED" | "RELEASED" | "TAKEN_OVER";
  actor: string;
  fromAssignee: string | null;
  toAssignee: string | null;
  createdAt: string;
  createdAtIso: string;
};

export type InboxMessage = {
  id: string;
  attachmentMimeType: string | null;
  attachmentName: string | null;
  attachmentUrl: string | null;
  body: string;
  deletedAt: string | null;
  direction: "inbound" | "outbound";
  isConnexaOutbound: boolean;
  outboundJobAvailableAt: string | null;
  outboundJobLastError: string | null;
  outboundJobStatus: string | null;
  providerMessageId: string | null;
  deliveryStatus: "pending" | "sent" | "delivered" | "read";
  ack: number | null;
  ackUpdatedAt: string | null;
  replyToMessageId: string | null;
  replyToMessage: {
    id: string;
    body: string | null;
    attachmentName: string | null;
    sender: string | null;
  } | null;
  reactions: Array<{
    id: string;
    emoji: string;
    sender: string;
    sentAtIso: string;
  }>;
  sender: string;
  sentAt: string;
  sentAtIso: string;
};

export type InboxSelectedConversation = {
  id: string;
  channelId: string | null;
  channelLabel: string | null;
  contactName: string;
  photoUrl: string | null;
  lead: {
    id: string;
    product: {
      id: string;
      name: string;
      description: string | null;
      area: string | null;
      location: string | null;
      mapUrl: string | null;
      websiteUrl: string | null;
      financing: string | null;
      financingTags: string[];
      brochureName: string | null;
      brochureUrl: string | null;
      priceMin: number | null;
      priceMax: number | null;
      imageUrls: string[];
      latitude: number | null;
      longitude: number | null;
    } | null;
    appointments: {
      id: string;
      title: string;
      type: string;
      startAt: string;
      startAtIso: string;
      endAt: string;
      endAtIso: string;
      location: string | null;
      note: string | null;
    }[];
    budget: string | null;
    budgetValue: number | null;
    financingStatus: string | null;
    nextActionAt: string | null;
    nextActionAtIso: string | null;
    preferredArea: string | null;
    priority: string;
    project: string;
    sourceDetail: string | null;
    stage: string;
    customData: Record<string, unknown>;
  } | null;
  phone: string;
  isGroup: boolean;
  status: string;
  isSnoozed: boolean;
  snoozedUntil: string | null;
  snoozedUntilIso: string | null;
  snoozeReason: string | null;
  snoozeStatus: string | null;
  snoozedBy: {
    id: string;
    name: string;
  } | null;
  isMuted: boolean;
  muteExpiration: string | null;
  muteExpirationIso: string | null;
  isArchived: boolean;
  isPinned: boolean;
  scheduledCount: number;
  nextScheduledAt: string | null;
  nextScheduledAtIso: string | null;
  assignee: string;
  assigneeId: string | null;
  teammateIds: string[];
  teammates: Array<{
    id: string;
    name: string;
  }>;
  tags: string[];
  notes: InboxNote[];
  auditEvents: InboxConversationAuditEvent[];
  automation: {
    automationPausedUntil: string | null;
    automationPausedUntilIso: string | null;
    activeFlowKey: string | null;
    activeFlowStep: string | null;
    lastAutoReplyAt: string | null;
    lastAutoReplyAtIso: string | null;
    lastMatchedRuleName: string | null;
    isIdle: boolean;
  } | null;
  messages: InboxMessage[];
} | null;
