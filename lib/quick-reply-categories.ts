export const QUICK_REPLY_CATEGORIES = [
  "General",
  "Lead Capture",
  "Viewing",
  "Pricing",
  "Follow-up",
  "Docs",
  "Closing"
] as const;

export type QuickReplyCategory = (typeof QUICK_REPLY_CATEGORIES)[number];
