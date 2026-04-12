export type InboxConversation = {
  id: string;
  contactName: string;
  photoUrl: string | null;
  phone: string;
  status: string;
  snoozedUntil: string | null;
  snoozedUntilIso: string | null;
  unreadCount: number;
  isHotLead: boolean;
  assigneeId: string | null;
  assignee: string;
  lastMessagePreview: string;
  lastMessageAt: string;
  lastMessageAtIso: string;
};

export type InboxFilterKey = "all" | "mine" | "unassigned" | "unread" | "hot";

export type InboxQuickReply = {
  id: string;
  title: string;
  shortcut: string;
  category: string;
  isPinned: boolean;
  body: string;
};

export type InboxWhatsAppStatus = {
  callbackUrl: string;
  isConfigured: boolean;
  mode: "live" | "mock" | "webjs";
  phoneNumberId: string | null;
  updatedAt: string | null;
};

export type InboxAgent = {
  id: string;
  name: string;
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

export type InboxMessage = {
  id: string;
  attachmentMimeType: string | null;
  attachmentName: string | null;
  attachmentUrl: string | null;
  body: string;
  direction: "inbound" | "outbound";
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
  } | null;
  phone: string;
  status: string;
  snoozedUntil: string | null;
  snoozedUntilIso: string | null;
  assignee: string;
  assigneeId: string | null;
  tags: string[];
  notes: InboxNote[];
  messages: InboxMessage[];
} | null;
