export type NormalizedDirection = "inbound" | "outbound" | null;

export interface NormalizedMessage {
  channel: "personal" | "cloud";
  account_id: string | null;
  from: string | null;
  to: string | null;
  message: string;
  timestamp: Date;
  direction: NormalizedDirection;
}

export function normalizePersonalMessage(input: unknown): NormalizedMessage;
export function normalizeCloudMessage(input: unknown): NormalizedMessage;
export function normalizeMessage(input: unknown): NormalizedMessage;

declare const _default: {
  normalizeMessage: typeof normalizeMessage;
  normalizeCloudMessage: typeof normalizeCloudMessage;
  normalizePersonalMessage: typeof normalizePersonalMessage;
};

export default _default;
