import { NextRequest, NextResponse } from "next/server";
import { requireApiManager } from "@/lib/auth/current-user";
import { requestWhatsAppWebPhonePairingCode } from "@/lib/whatsapp-web-phone-pairing";

function pairingErrorResponse(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  const messages: Record<string, string> = {
    WHATSAPP_PHONE_PAIRING_CHANNEL_REQUIRED: "Choose a personal WhatsApp Web channel first.",
    WHATSAPP_PHONE_PAIRING_UNSUPPORTED_CHANNEL: "Phone pairing is available only for personal WhatsApp Web channels.",
    WHATSAPP_PHONE_PAIRING_INVALID_NUMBER: "Enter a valid international phone number.",
    WHATSAPP_PHONE_PAIRING_RATE_LIMITED: "Please wait before generating another pairing code.",
    WHATSAPP_PHONE_PAIRING_CLIENT_UNAVAILABLE: "The WhatsApp Web client is still preparing. Try again shortly.",
    WHATSAPP_PHONE_PAIRING_CLIENT_PREPARING: "WhatsApp Web is still loading phone pairing. Try again shortly.",
    WHATSAPP_PHONE_PAIRING_UNSUPPORTED_VERSION: "This WhatsApp Web runtime does not support phone pairing.",
    WHATSAPP_PHONE_PAIRING_CODE_UNAVAILABLE: "WhatsApp received the pairing request but did not return a code. Wait a moment, then generate a new code.",
    WHATSAPP_PHONE_PAIRING_CODE_BRIDGE_UNAVAILABLE: "WhatsApp could not return the generated code. Try again shortly.",
    WHATSAPP_PHONE_PAIRING_BROWSER_CONTEXT_RESET: "WhatsApp Web refreshed while creating the code. Try again shortly.",
    WHATSAPP_PHONE_PAIRING_BROWSER_SESSION_CLOSED: "The WhatsApp Web session restarted. Wait a moment, then try again.",
    WHATSAPP_PHONE_PAIRING_PAIRING_MODULE_UNAVAILABLE: "WhatsApp Web is still loading phone pairing. Try again shortly.",
    WHATSAPP_PHONE_PAIRING_BROWSER_PROTOCOL_ERROR: "WhatsApp Web did not complete the pairing request. Try again shortly.",
    WHATSAPP_PHONE_PAIRING_GENERATION_FAILED: "WhatsApp could not generate a pairing code. Try again shortly."
  };

  return NextResponse.json(
    { error: messages[code] ?? "Unable to generate a WhatsApp pairing code." },
    { status: code === "UNAUTHORIZED" ? 401 : code === "FORBIDDEN" ? 403 : code === "WHATSAPP_PHONE_PAIRING_RATE_LIMITED" ? 429 : 400 }
  );
}

export async function POST(request: NextRequest) {
  try {
    const manager = await requireApiManager();
    const body = (await request.json().catch(() => null)) as {
      channelId?: string;
      countryCode?: string;
      phoneNumber?: string;
    } | null;
    const pairing = await requestWhatsAppWebPhonePairingCode({
      agentId: manager.id,
      workspaceId: manager.workspaceId,
      channelId: body?.channelId?.trim() ?? "",
      countryCode: body?.countryCode?.trim() ?? "",
      phoneNumber: body?.phoneNumber?.trim() ?? ""
    });

    return NextResponse.json({ pairing }, { status: 200 });
  } catch (error) {
    return pairingErrorResponse(error);
  }
}
