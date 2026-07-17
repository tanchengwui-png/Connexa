import { NextRequest, NextResponse } from "next/server";
import { requireApiManager } from "@/lib/auth/current-user";
import { decryptSecret, sanitizeSensitiveText } from "@/lib/crypto";
import { testMetaPhoneNumberConnection } from "@/lib/meta-whatsapp";
import { prisma } from "@/lib/prisma";
import { logWhatsAppRuntimeEvent } from "@/lib/whatsapp-runtime-events";

export async function POST(request: NextRequest) {
  try {
    const manager = await requireApiManager();
    const body = (await request.json().catch(() => null)) as
      | {
          channelId?: string;
        }
      | null;

    const channelId = body?.channelId?.trim() || "";
    if (!channelId) {
      throw new Error("WHATSAPP_CHANNEL_REQUIRED");
    }

    const channel = await prisma.whatsAppChannel.findFirst({
      where: {
        id: channelId,
        workspaceId: manager.workspaceId
      },
      select: {
        id: true,
        workspaceId: true,
        sessionClientId: true,
        phoneNumberId: true,
        accessTokenCiphertext: true
      }
    });

    if (!channel) {
      throw new Error("FORBIDDEN");
    }

    const accessToken = channel.accessTokenCiphertext ? decryptSecret(channel.accessTokenCiphertext) : "";
    const payload = await testMetaPhoneNumberConnection({
      accessToken,
      phoneNumberId: channel.phoneNumberId ?? ""
    });

    await logWhatsAppRuntimeEvent({
      workspaceId: channel.workspaceId,
      sessionClientId: channel.sessionClientId,
      eventType: "CLOUD_TEST_SUCCESS",
      message: "Meta Cloud connection test passed.",
      metadata: {
        channelId: channel.id,
        phoneNumberId: channel.phoneNumberId
      }
    });

    return NextResponse.json(
      {
        ok: true,
        phoneNumber: {
          id: payload.id ?? channel.phoneNumberId ?? null,
          displayPhoneNumber: payload.display_phone_number ?? null,
          verifiedName: payload.verified_name ?? null,
          qualityRating: payload.quality_rating ?? null,
          codeVerificationStatus: payload.code_verification_status ?? null
        }
      },
      { status: 200 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error && error.message === "UNAUTHORIZED"
            ? "Unauthorized."
            : error instanceof Error && error.message === "FORBIDDEN"
              ? "Forbidden."
              : error instanceof Error && error.message === "WHATSAPP_CHANNEL_REQUIRED"
                ? "Choose a WhatsApp channel before testing the Meta connection."
              : error instanceof Error
                ? sanitizeSensitiveText(error.message)
                : "Unable to test Meta connection."
      },
      {
        status:
          error instanceof Error && error.message === "UNAUTHORIZED"
            ? 401
            : error instanceof Error && error.message === "FORBIDDEN"
              ? 403
              : 400
      }
    );
  }
}
