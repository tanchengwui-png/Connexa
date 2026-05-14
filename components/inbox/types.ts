export type InboxConversation = {
  id: string;
  contactName: string;
  photoUrl: string | null;
  phone: string;
  isGroup: boolean;
  status: string;
  snoozedUntil: string | null;
  snoozedUntilIso: string | null;
  unreadCount: number;
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

export type InboxFilterKey = "all" | "mine" | "assigned-others" | "unassigned" | "unread" | "hot";

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

export type InboxMediaAsset = {
  id: string;
  title: string;
  publicUrl: string;
  kind: "IMAGE" | "AUDIO" | "VIDEO";
  mimeType: string;
  sizeLabel: string;
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
  snoozedUntil: string | null;
  snoozedUntilIso: string | null;
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
