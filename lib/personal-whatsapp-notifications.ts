import { prisma } from "@/lib/prisma";

/** Notification-only lifecycle; deliberately independent of QR/authentication. */
export type PersonalWhatsAppNotificationState = "STARTING" | "RECONCILING" | "LIVE" | "DISCONNECTED";

export const PERSONAL_WHATSAPP_NOTIFICATION_CLOCK_SKEW_MS = 2 * 60 * 1000;

export type PersonalWhatsAppNotificationDecision = {
  eligible: boolean;
  kind: "live-individual" | "historical-summary" | null;
  reason: string;
  deduplicationKey: string | null;
};

export function classifyNotificationEligibility(input: {
  provider: "personal-whatsapp-web" | "cloud";
  state: PersonalWhatsAppNotificationState;
  eventPath: "message" | "message_create" | "history";
  providerMessageId: string | null;
  fromMe: boolean;
  messageType: string | null | undefined;
  messageTimestampMs: number | null;
  liveWatermarkAt: number | null;
}) : PersonalWhatsAppNotificationDecision {
  if (input.provider !== "personal-whatsapp-web") return { eligible: true, kind: null, reason: "provider-bypass", deduplicationKey: null };
  if (input.fromMe) return { eligible: false, kind: null, reason: "outbound", deduplicationKey: null };
  if (!input.providerMessageId) return { eligible: false, kind: null, reason: "missing-provider-message-id", deduplicationKey: null };
  if (input.eventPath !== "message" || input.state !== "LIVE") return { eligible: false, kind: null, reason: "not-live-message-path", deduplicationKey: null };
  if (!isEligiblePersonalWhatsAppMessageType(input.messageType)) return { eligible: false, kind: null, reason: "unsupported-message-type", deduplicationKey: null };
  if (
    input.liveWatermarkAt !== null &&
    input.messageTimestampMs !== null &&
    input.messageTimestampMs < input.liveWatermarkAt - PERSONAL_WHATSAPP_NOTIFICATION_CLOCK_SKEW_MS
  ) return { eligible: false, kind: null, reason: "before-live-watermark", deduplicationKey: null };
  return {
    eligible: true,
    kind: "live-individual",
    reason: "live-incoming-message",
    deduplicationKey: `message:${input.providerMessageId}`
  };
}

export function isEligiblePersonalWhatsAppMessageType(type: string | null | undefined) {
  return !new Set([
    "e2e_notification", "notification", "group_notification", "protocol", "revoked",
    "reaction", "call_log", "gp2", "ciphertext", "unknown"
  ]).has((type ?? "chat").toLowerCase());
}

/** Atomically reserves a delivery across workers/restarts. No message contents are stored. */
export async function reservePersonalWhatsAppNotification(input: {
  workspaceId: string;
  channelId: string;
  chatId: string;
  fingerprint: string;
  kind: "LIVE_MESSAGE" | "HISTORICAL_UNREAD";
}) {
  try {
    await prisma.personalWhatsAppNotificationLedger.create({
      data: { workspaceId: input.workspaceId, channelId: input.channelId, chatId: input.chatId, fingerprint: input.fingerprint, kind: input.kind }
    });
    return true;
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && (error as { code?: string }).code === "P2002") return false;
    throw error;
  }
}
