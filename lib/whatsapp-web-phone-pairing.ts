import { requestWhatsAppWebPairingCode } from "@/lib/whatsapp-runtime";
import { getWhatsAppChannelStatusById } from "@/lib/whatsapp-channel";
import { normalizeWhatsAppWebPairingPhone } from "@/lib/phone-pairing-number";
import { encryptSecret } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";

const PAIRING_CODE_COOLDOWN_MS = 30_000;
const PAIRING_CODE_TTL_MS = 3 * 60_000;

type PairingRequestState = {
  generatedAt: Date;
  expiresAt: Date;
};

const pairingRequestStates = new Map<string, PairingRequestState>();

export type PhonePairingErrorCode =
  | "WHATSAPP_PHONE_PAIRING_CHANNEL_REQUIRED"
  | "WHATSAPP_PHONE_PAIRING_UNSUPPORTED_CHANNEL"
  | "WHATSAPP_PHONE_PAIRING_INVALID_NUMBER"
  | "WHATSAPP_PHONE_PAIRING_RATE_LIMITED"
  | "WHATSAPP_PHONE_PAIRING_CLIENT_UNAVAILABLE"
  | "WHATSAPP_PHONE_PAIRING_UNSUPPORTED_VERSION"
  | "WHATSAPP_PHONE_PAIRING_CODE_UNAVAILABLE"
  | "WHATSAPP_PHONE_PAIRING_GENERATION_FAILED";

function pairingStateKey(agentId: string, channelId: string) {
  return `${agentId}:${channelId}`;
}

export async function requestWhatsAppWebPhonePairingCode(input: {
  agentId: string;
  workspaceId: string;
  channelId: string;
  countryCode: string;
  phoneNumber: string;
}) {
  if (!input.channelId.trim()) {
    throw new Error("WHATSAPP_PHONE_PAIRING_CHANNEL_REQUIRED");
  }

  const channel = await getWhatsAppChannelStatusById(input.channelId);
  if (!channel || channel.workspaceId !== input.workspaceId || channel.connectionMethod !== "web") {
    throw new Error("WHATSAPP_PHONE_PAIRING_UNSUPPORTED_CHANNEL");
  }

  const normalized = normalizeWhatsAppWebPairingPhone({
    countryCode: input.countryCode,
    phoneNumber: input.phoneNumber
  });
  const stateKey = pairingStateKey(input.agentId, channel.id);
  const previous = pairingRequestStates.get(stateKey);
  const now = new Date();
  if (previous && now.getTime() - previous.generatedAt.getTime() < PAIRING_CODE_COOLDOWN_MS) {
    throw new Error("WHATSAPP_PHONE_PAIRING_RATE_LIMITED");
  }

  let pairingCode: string;
  try {
    pairingCode = await requestWhatsAppWebPairingCode({
      workspaceId: input.workspaceId,
      agentId: input.agentId,
      channelId: channel.id,
      phoneNumber: normalized.internationalDigits
    });
  } catch (error) {
    if (
      error instanceof Error &&
      [
        "WHATSAPP_PHONE_PAIRING_CLIENT_UNAVAILABLE",
        "WHATSAPP_PHONE_PAIRING_CLIENT_PREPARING",
        "WHATSAPP_PHONE_PAIRING_UNSUPPORTED_VERSION",
        "WHATSAPP_PHONE_PAIRING_CODE_UNAVAILABLE",
        "WHATSAPP_PHONE_PAIRING_CODE_BRIDGE_UNAVAILABLE",
        "WHATSAPP_PHONE_PAIRING_BROWSER_CONTEXT_RESET",
        "WHATSAPP_PHONE_PAIRING_BROWSER_SESSION_CLOSED",
        "WHATSAPP_PHONE_PAIRING_PAIRING_MODULE_UNAVAILABLE",
        "WHATSAPP_PHONE_PAIRING_BROWSER_PROTOCOL_ERROR"
      ].includes(error.message)
    ) {
      throw error;
    }
    console.warn(
      `[whatsapp-web][phone-pairing] code generation failed workspace=${input.workspaceId} channel=${channel.id} phone=${normalized.maskedPhoneNumber}`
    );
    throw new Error("WHATSAPP_PHONE_PAIRING_GENERATION_FAILED");
  }

  const generatedAt = new Date();
  const expiresAt = new Date(generatedAt.getTime() + PAIRING_CODE_TTL_MS);
  // whatsapp-web.js clears its previous pairing interval before generating a new
  // code. Keep only metadata here so the code is never retained or logged.
  pairingRequestStates.set(stateKey, { generatedAt, expiresAt });

  await prisma.whatsAppPhonePairingAudit.create({
    data: {
      workspaceId: input.workspaceId,
      channelId: channel.id,
      agentId: input.agentId,
      phoneNumberCiphertext: encryptSecret(normalized.internationalDigits),
      pairingCodeCiphertext: encryptSecret(pairingCode),
      maskedPhoneNumber: normalized.maskedPhoneNumber,
      status: "GENERATED"
    }
  });

  return {
    pairingCode,
    generatedAt,
    expiresAt,
    maskedPhoneNumber: normalized.maskedPhoneNumber,
    status: "PENDING_PHONE_LINK" as const
  };
}
