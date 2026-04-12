export const FINANCING_TAG_OPTIONS = [
  "BANK_LOAN",
  "ISLAMIC_FINANCING",
  "LPPSA",
  "FLEXI_LOAN",
  "ZERO_DOWNPAYMENT",
  "LOW_BOOKING_FEE",
  "DEVELOPER_REBATE",
  "CASH_BUYER",
  "COMMERCIAL_LOAN",
  "EPF_WITHDRAWAL"
] as const;

export type FinancingTag = (typeof FINANCING_TAG_OPTIONS)[number];

export function formatFinancingTag(tag: string) {
  return tag
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
