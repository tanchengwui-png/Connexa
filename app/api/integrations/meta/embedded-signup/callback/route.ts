import { NextRequest, NextResponse } from "next/server";
import { requireApiManager } from "@/lib/auth/current-user";
import { sanitizeSensitiveText } from "@/lib/crypto";
import {
  buildManagedWebhookVerifyToken,
  exchangeMetaEmbeddedSignupCode,
  fetchMetaEmbeddedSignupPhoneNumbers,
  registerMetaCloudPhoneNumber,
  subscribeMetaWabaApp
} from "@/lib/meta-whatsapp";
import { getResolvedPlatformMetaConfig } from "@/lib/platform-config";
import { saveWhatsAppCloudCredentials } from "@/lib/whatsapp-channel";
import { sanitizeWhatsAppChannelDisplayName } from "@/lib/whatsapp-channel-label";
import { assertWhatsAppCloudEnabled } from "@/lib/whatsapp-cloud/feature-flags";
import {
  completeMetaOnboardingAttempt,
  consumeMetaAuthorizationState,
  failMetaOnboardingAttempt,
  loadMetaOnboardingSelection,
  storeMetaOnboardingAssets
} from "@/lib/whatsapp-cloud/onboarding";

type CallbackBody = {
  code?: string;
  state?: string;
  attemptId?: string;
  workspaceId?: string;
  channelId?: string;
  connectionName?: string | null;
  wabaId?: string;
  phoneNumberId?: string;
  pin?: string;
  confirmRegistration?: boolean;
};

function publicError(error: unknown) {
  const code = error instanceof Error ? error.message : "META_EMBEDDED_SIGNUP_FAILED";
  const messages: Record<string, string> = {
    WHATSAPP_CLOUD_DISABLED: "Official WhatsApp Cloud onboarding is not enabled for this workspace.",
    META_ONBOARDING_STATE_INVALID: "The Meta setup request expired or does not belong to this workspace.",
    META_ONBOARDING_STATE_REPLAYED: "This Meta setup response has already been used.",
    META_ONBOARDING_ATTEMPT_EXPIRED: "The Meta setup session expired. Start again.",
    META_PHONE_NUMBER_REQUIRED: "Choose a verified WhatsApp phone number.",
    META_BUSINESS_ACCOUNT_REQUIRED: "Meta did not return the WhatsApp Business Account for this number.",
    META_EMBEDDED_SIGNUP_SESSION_MISMATCH: "Meta's completed signup selection could not be verified against the authorized account. Start again.",
    META_WEBHOOK_SUBSCRIPTION_CONFIGURATION_REQUIRED: "Meta webhook subscription is not configured.",
    META_STANDARD_REGISTRATION_CONSENT_REQUIRED: "Confirm that this API-only number may be registered before continuing.",
    META_COEXISTENCE_NOT_VERIFIED: "Meta did not confirm that this number is eligible for Business App Coexistence. No migration was attempted."
  };
  return messages[code] ?? sanitizeSensitiveText(code);
}

export async function POST(request: NextRequest) {
  let claimedAttemptId: string | null = null;
  try {
    const manager = await requireApiManager();
    const body = (await request.json().catch(() => null)) as CallbackBody | null;
    const workspaceId = body?.workspaceId?.trim() ?? "";
    const channelId = body?.channelId?.trim() ?? "";
    if (!workspaceId || workspaceId !== manager.workspaceId) {
      throw new Error("FORBIDDEN");
    }
    if (!channelId) {
      throw new Error("WHATSAPP_CHANNEL_REQUIRED");
    }
    assertWhatsAppCloudEnabled(workspaceId);

    if (!body?.attemptId) {
      const attempt = await consumeMetaAuthorizationState({
        workspaceId,
        channelId,
        initiatedByAgentId: manager.id,
        state: body?.state?.trim() ?? ""
      });
      claimedAttemptId = attempt.id;
      const { accessToken, tokenExpiresAt } = await exchangeMetaEmbeddedSignupCode(body?.code?.trim() ?? "");
      const phoneNumbers = await fetchMetaEmbeddedSignupPhoneNumbers(accessToken);
      const reportedWabaId = body?.wabaId?.trim() ?? "";
      const reportedPhoneNumberId = body?.phoneNumberId?.trim() ?? "";
      const verifiedPhoneNumbers = reportedWabaId || reportedPhoneNumberId
        ? phoneNumbers.filter(
            (phoneNumber) =>
              (!reportedWabaId || phoneNumber.businessAccountId === reportedWabaId) &&
              (!reportedPhoneNumberId || phoneNumber.phoneNumberId === reportedPhoneNumberId)
          )
        : phoneNumbers;
      if (
        ((reportedWabaId || reportedPhoneNumberId) && verifiedPhoneNumbers.length === 0) ||
        (reportedPhoneNumberId && verifiedPhoneNumbers.length !== 1)
      ) {
        throw new Error("META_EMBEDDED_SIGNUP_SESSION_MISMATCH");
      }
      await storeMetaOnboardingAssets({
        attemptId: attempt.id,
        accessToken,
        tokenExpiresAt,
        phoneNumbers: verifiedPhoneNumbers
      });
      return NextResponse.json({
        attemptId: attempt.id,
        mode: attempt.mode,
        phoneNumbers: verifiedPhoneNumbers
      });
    }

    const selection = await loadMetaOnboardingSelection({
      attemptId: body.attemptId,
      workspaceId,
      channelId,
      initiatedByAgentId: manager.id
    });
    claimedAttemptId = selection.attempt.id;
    const phoneNumberId = body.phoneNumberId?.trim() ?? "";
    const selectedPhoneNumber = selection.phoneNumbers.find((phone) => phone.phoneNumberId === phoneNumberId);
    if (!selectedPhoneNumber) {
      throw new Error("META_PHONE_NUMBER_REQUIRED");
    }

    if (selection.attempt.mode === "coexistence") {
      if (selectedPhoneNumber.isOnBizApp !== true) {
        throw new Error("META_COEXISTENCE_NOT_VERIFIED");
      }
      // Coexistence numbers are already registered by Meta's hosted flow.
      // Never invoke /register or silently fall back to an API-only migration.
    } else {
      if (body.confirmRegistration !== true) {
        throw new Error("META_STANDARD_REGISTRATION_CONSENT_REQUIRED");
      }
      await registerMetaCloudPhoneNumber({
        accessToken: selection.accessToken,
        phoneNumberId,
        pin: body.pin?.trim() ?? ""
      });
    }

    const businessAccountId = selectedPhoneNumber.businessAccountId?.trim() ?? "";
    if (!businessAccountId) {
      throw new Error("META_BUSINESS_ACCOUNT_REQUIRED");
    }
    await subscribeMetaWabaApp({
      accessToken: selection.accessToken,
      businessAccountId
    });

    const platformConfig = await getResolvedPlatformMetaConfig();
    const channel = await saveWhatsAppCloudCredentials({
      workspaceId,
      channelId,
      phoneNumberId,
      businessAccountId,
      legacyWabaId: businessAccountId,
      messagingAccountId: businessAccountId,
      integrationIdentity: platformConfig.appId.trim() || "meta_direct",
      accountModelVersion: "legacy_compatible",
      onboardingMode: selection.attempt.mode === "coexistence" ? "coexistence" : "standard",
      accessToken: selection.accessToken,
      appSecret: platformConfig.appSecret.trim() || null,
      verifyToken: await buildManagedWebhookVerifyToken(),
      displayName:
        sanitizeWhatsAppChannelDisplayName(body.connectionName) ||
        selectedPhoneNumber.displayPhoneNumber ||
        selectedPhoneNumber.verifiedName,
      phoneNumber: selectedPhoneNumber.displayPhoneNumber,
      provider: "meta_direct",
      channelType: "cloud_api",
      tokenExpiresAt: selection.tokenExpiresAt
    });

    await completeMetaOnboardingAttempt(selection.attempt.id);
    return NextResponse.json({
      channel: {
        id: channel.id,
        displayName: channel.displayName,
        phoneNumber: channel.phoneNumber,
        phoneNumberId: channel.phoneNumberId,
        businessAccountId: channel.businessAccountId,
        connectionStatus: channel.connectionStatus,
        onboardingMode: selection.attempt.mode
      },
      fundingRequired: true
    });
  } catch (error) {
    if (claimedAttemptId) {
      await failMetaOnboardingAttempt(
        claimedAttemptId,
        error instanceof Error ? error.message : "META_EMBEDDED_SIGNUP_FAILED"
      ).catch(() => null);
    }
    const code = error instanceof Error ? error.message : "META_EMBEDDED_SIGNUP_FAILED";
    return NextResponse.json(
      { error: publicError(error) },
      { status: code === "UNAUTHORIZED" ? 401 : code === "FORBIDDEN" ? 403 : 400 }
    );
  }
}
