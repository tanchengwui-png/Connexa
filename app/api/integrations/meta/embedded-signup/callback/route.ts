import { NextRequest, NextResponse } from "next/server";
import { requireApiManager } from "@/lib/auth/current-user";
import {
  buildManagedWebhookVerifyToken,
  consumeMetaEmbeddedSignupSetupSession,
  createMetaEmbeddedSignupSetupSession,
  exchangeMetaEmbeddedSignupCode,
  fetchMetaEmbeddedSignupPhoneNumbers,
  registerMetaCloudPhoneNumber
} from "@/lib/meta-whatsapp";
import { sanitizeSensitiveText } from "@/lib/crypto";
import { logWhatsAppRuntimeEvent } from "@/lib/whatsapp-runtime-events";
import {
  ensureWorkspaceDefaultWhatsAppChannel,
  getWhatsAppChannelStatusById,
  saveWhatsAppCloudCredentials
} from "@/lib/whatsapp-channel";
import { sanitizeWhatsAppChannelDisplayName } from "@/lib/whatsapp-channel-label";

export async function POST(request: NextRequest) {
  try {
    const manager = await requireApiManager();
    const body = (await request.json().catch(() => null)) as
      | {
          code?: string;
          workspaceId?: string;
          channelId?: string;
          connectionName?: string | null;
          setupId?: string;
          phoneNumberId?: string;
          pin?: string;
        }
      | null;

    const workspaceId = body?.workspaceId?.trim() || "";
    if (!workspaceId || workspaceId !== manager.workspaceId) {
      throw new Error("FORBIDDEN");
    }

    const defaultChannel = await ensureWorkspaceDefaultWhatsAppChannel(workspaceId);
    const channelId = body?.channelId?.trim() || defaultChannel?.id || "";

    if (!channelId) {
      throw new Error("WHATSAPP_CHANNEL_REQUIRED");
    }

    if (body?.setupId) {
      const session = consumeMetaEmbeddedSignupSetupSession(body.setupId);
      if (!session) {
        throw new Error("META_EMBEDDED_SIGNUP_SESSION_EXPIRED");
      }

      const phoneNumberId = body.phoneNumberId?.trim() || "";
      const selectedPhoneNumber = session.phoneNumbers.find((phone) => phone.phoneNumberId === phoneNumberId);
      if (!selectedPhoneNumber) {
        throw new Error("META_PHONE_NUMBER_REQUIRED");
      }

      await registerMetaCloudPhoneNumber({
        accessToken: session.accessToken,
        phoneNumberId: selectedPhoneNumber.phoneNumberId,
        pin: body.pin?.trim() || ""
      });

      const channel = await saveWhatsAppCloudCredentials({
        workspaceId,
        channelId,
        phoneNumberId: selectedPhoneNumber.phoneNumberId,
        businessAccountId: selectedPhoneNumber.businessAccountId,
        accessToken: session.accessToken,
        appSecret: process.env.META_APP_SECRET?.trim() || null,
        verifyToken: await buildManagedWebhookVerifyToken(),
        displayName:
          sanitizeWhatsAppChannelDisplayName(body?.connectionName) ||
          selectedPhoneNumber.displayPhoneNumber ||
          selectedPhoneNumber.verifiedName ||
          defaultChannel?.displayName ||
          null,
        phoneNumber: selectedPhoneNumber.displayPhoneNumber,
        provider: "meta",
        channelType: "cloudapi",
        tokenExpiresAt: session.tokenExpiresAt
      });

      await logWhatsAppRuntimeEvent({
        workspaceId,
        sessionClientId: channel.sessionClientId,
        eventType: "CLOUD_CONNECTED",
        message: "Meta Embedded Signup completed.",
        metadata: {
          channelId: channel.id,
          provider: "meta",
          channelType: "cloudapi",
          phoneNumberId: channel.phoneNumberId,
          businessAccountId: channel.businessAccountId
        }
      });

      const channelStatus = await getWhatsAppChannelStatusById(channel.id);

      return NextResponse.json(
        {
          channel: channelStatus
        },
        { status: 200 }
      );
    }

    const { accessToken, tokenExpiresAt } = await exchangeMetaEmbeddedSignupCode(body?.code?.trim() || "");
    const phoneNumbers = await fetchMetaEmbeddedSignupPhoneNumbers(accessToken);
    const setupId = createMetaEmbeddedSignupSetupSession({
      accessToken,
      tokenExpiresAt,
      phoneNumbers
    });

    return NextResponse.json(
      {
        setupId,
        phoneNumbers
      },
      { status: 200 }
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message === "UNAUTHORIZED"
          ? "Unauthorized."
          : error.message === "FORBIDDEN"
            ? "Forbidden."
            : error.message === "WHATSAPP_CHANNEL_REQUIRED"
              ? "Choose a WhatsApp channel before starting Meta Embedded Signup."
              : error.message === "META_EMBEDDED_SIGNUP_SESSION_EXPIRED"
                ? "Facebook setup session expired. Connect with Facebook again."
              : error.message === "META_PHONE_NUMBER_REQUIRED"
                ? "Choose a WhatsApp phone number before completing setup."
              : sanitizeSensitiveText(error.message)
        : "Unable to complete Meta Embedded Signup.";

    return NextResponse.json(
      {
        error: message
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
