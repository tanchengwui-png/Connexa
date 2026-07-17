export const IndustryType = {
  PROPERTY: "PROPERTY",
  WORKSHOP: "WORKSHOP",
  GENERIC: "GENERIC"
} as const;

export type IndustryType = (typeof IndustryType)[keyof typeof IndustryType];

export const AvailabilityOverrideType = {
  BLOCKED: "BLOCKED",
  LEAVE: "LEAVE",
  CUSTOM_AVAILABLE: "CUSTOM_AVAILABLE"
} as const;

export type AvailabilityOverrideType =
  (typeof AvailabilityOverrideType)[keyof typeof AvailabilityOverrideType];

export const AgentRole = {
  MANAGER: "MANAGER",
  AGENT: "AGENT"
} as const;

export type AgentRole = (typeof AgentRole)[keyof typeof AgentRole];

export const AgentStatus = {
  ACTIVE: "ACTIVE",
  AWAY: "AWAY"
} as const;

export type AgentStatus = (typeof AgentStatus)[keyof typeof AgentStatus];

export const ConversationStatus = {
  OPEN: "OPEN",
  PENDING: "PENDING",
  CLOSED: "CLOSED"
} as const;

export type ConversationStatus = (typeof ConversationStatus)[keyof typeof ConversationStatus];

export const ConversationSnoozeStatus = {
  ACTIVE: "ACTIVE",
  MANUAL: "MANUAL",
  EXPIRED: "EXPIRED",
  INCOMING_MESSAGE: "INCOMING_MESSAGE",
  WORKFLOW: "WORKFLOW"
} as const;

export type ConversationSnoozeStatus =
  (typeof ConversationSnoozeStatus)[keyof typeof ConversationSnoozeStatus];

export const MessageDirection = {
  INBOUND: "INBOUND",
  OUTBOUND: "OUTBOUND"
} as const;

export type MessageDirection = (typeof MessageDirection)[keyof typeof MessageDirection];

export const AppointmentStatus = {
  SCHEDULED: "SCHEDULED",
  COMPLETED: "COMPLETED",
  CANCELED: "CANCELED"
} as const;

export type AppointmentStatus = (typeof AppointmentStatus)[keyof typeof AppointmentStatus];

export const AppointmentType = {
  SITE_VISIT: "SITE_VISIT",
  CALL: "CALL",
  MEETING: "MEETING"
} as const;

export type AppointmentType = (typeof AppointmentType)[keyof typeof AppointmentType];

export const AutomationTriggerType = {
  WELCOME_MESSAGE: "WELCOME_MESSAGE",
  KEYWORD_MATCH: "KEYWORD_MATCH",
  FOLLOW_UP: "FOLLOW_UP"
} as const;

export type AutomationTriggerType = (typeof AutomationTriggerType)[keyof typeof AutomationTriggerType];

export const AutomationMatchType = {
  CONTAINS: "CONTAINS",
  EXACT: "EXACT",
  REGEX: "REGEX"
} as const;

export type AutomationMatchType = (typeof AutomationMatchType)[keyof typeof AutomationMatchType];

export const AutomationJobType = {
  FOLLOW_UP_MESSAGE: "FOLLOW_UP_MESSAGE"
} as const;

export type AutomationJobType = (typeof AutomationJobType)[keyof typeof AutomationJobType];

export const AutomationJobStatus = {
  PENDING: "PENDING",
  RUNNING: "RUNNING",
  SENT: "SENT",
  BLOCKED: "BLOCKED",
  FAILED: "FAILED",
  CANCELED: "CANCELED"
} as const;

export type AutomationJobStatus = (typeof AutomationJobStatus)[keyof typeof AutomationJobStatus];

export const MediaAssetKind = {
  IMAGE: "IMAGE",
  AUDIO: "AUDIO",
  VIDEO: "VIDEO",
  DOCUMENT: "DOCUMENT"
} as const;

export type MediaAssetKind = (typeof MediaAssetKind)[keyof typeof MediaAssetKind];

export const MediaAssetSource = {
  MEDIA_LIBRARY: "MEDIA_LIBRARY",
  INBOX: "INBOX",
  QUICK_REPLY: "QUICK_REPLY",
  CAMPAIGN: "CAMPAIGN",
  AUTOMATION_RULE: "AUTOMATION_RULE",
  AUTOMATION_WORKFLOW: "AUTOMATION_WORKFLOW",
  WHATSAPP_INBOUND: "WHATSAPP_INBOUND"
} as const;

export type MediaAssetSource = (typeof MediaAssetSource)[keyof typeof MediaAssetSource];

export const OutboundMessageJobStatus = {
  PENDING: "PENDING",
  RUNNING: "RUNNING",
  SENT: "SENT",
  FAILED: "FAILED",
  CANCELED: "CANCELED"
} as const;

export type OutboundMessageJobStatus = (typeof OutboundMessageJobStatus)[keyof typeof OutboundMessageJobStatus];

export const CampaignRunRecipientStatus = {
  QUEUED: "QUEUED",
  EXCLUDED: "EXCLUDED"
} as const;

export type CampaignRunRecipientStatus =
  (typeof CampaignRunRecipientStatus)[keyof typeof CampaignRunRecipientStatus];

export const ConversationAuditEventType = {
  ASSIGNED: "ASSIGNED",
  REASSIGNED: "REASSIGNED",
  RELEASED: "RELEASED",
  TAKEN_OVER: "TAKEN_OVER"
} as const;

export type ConversationAuditEventType =
  (typeof ConversationAuditEventType)[keyof typeof ConversationAuditEventType];

export const LeadPriority = {
  LOW: "LOW",
  MEDIUM: "MEDIUM",
  HIGH: "HIGH",
  URGENT: "URGENT"
} as const;

export type LeadPriority = (typeof LeadPriority)[keyof typeof LeadPriority];

export const LeadNextActionType = {
  CALL_CUSTOMER: "CALL_CUSTOMER",
  SEND_QUOTATION: "SEND_QUOTATION",
  FOLLOW_UP: "FOLLOW_UP",
  BOOK_APPOINTMENT: "BOOK_APPOINTMENT",
  SEND_PAYMENT_LINK: "SEND_PAYMENT_LINK",
  CUSTOM: "CUSTOM"
} as const;

export type LeadNextActionType = (typeof LeadNextActionType)[keyof typeof LeadNextActionType];

export const LeadActivityType = {
  LEAD_CREATED: "LEAD_CREATED",
  MESSAGE_RECEIVED: "MESSAGE_RECEIVED",
  MESSAGE_SENT: "MESSAGE_SENT",
  STAGE_CHANGED: "STAGE_CHANGED",
  OWNER_CHANGED: "OWNER_CHANGED",
  NEXT_ACTION_UPDATED: "NEXT_ACTION_UPDATED",
  NOTE_UPDATED: "NOTE_UPDATED",
  VALUE_UPDATED: "VALUE_UPDATED",
  CUSTOM_FIELD_UPDATED: "CUSTOM_FIELD_UPDATED"
} as const;

export type LeadActivityType = (typeof LeadActivityType)[keyof typeof LeadActivityType];

export const LeadSource = {
  WHATSAPP: "WHATSAPP",
  META_ADS: "META_ADS",
  WEBSITE: "WEBSITE",
  QR_CODE: "QR_CODE",
  REFERRAL: "REFERRAL",
  MANUAL: "MANUAL",
  IMPORT: "IMPORT",
  MARKETPLACE: "MARKETPLACE",
  OTHER: "OTHER",
  // Deprecated legacy values retained while existing databases are backfilled.
  PROPERTY_PORTAL: "PROPERTY_PORTAL",
  WEBSITE_CHAT: "WEBSITE_CHAT",
  REFERRAL_QR: "REFERRAL_QR"
} as const;

export type LeadSource = (typeof LeadSource)[keyof typeof LeadSource];

export const LeadStage = {
  NEW_LEAD: "NEW_LEAD",
  CONTACTED: "CONTACTED",
  QUALIFIED: "QUALIFIED",
  FOLLOW_UP: "FOLLOW_UP",
  NEGOTIATION: "NEGOTIATION",
  CLOSED_WON: "CLOSED_WON",
  CLOSED_LOST: "CLOSED_LOST",
  // Deprecated legacy value retained while existing databases are backfilled.
  SITE_VISIT_BOOKED: "SITE_VISIT_BOOKED"
} as const;

export type LeadStage = (typeof LeadStage)[keyof typeof LeadStage];
