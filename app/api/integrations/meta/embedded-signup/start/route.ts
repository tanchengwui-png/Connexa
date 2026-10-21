import { NextRequest, NextResponse } from "next/server";
import { requireApiManager } from "@/lib/auth/current-user";
import { getMetaEmbeddedSignupConfig } from "@/lib/meta-whatsapp";
import { assertWhatsAppCloudEnabled, assertWhatsAppCoexistenceEnabled } from "@/lib/whatsapp-cloud/feature-flags";
import { createMetaOnboardingAttempt } from "@/lib/whatsapp-cloud/onboarding";

export async function POST(request: NextRequest) {
  try {
    const manager = await requireApiManager();
    const body = (await request.json().catch(() => null)) as {
      channelId?: string;
      mode?: string;
    } | null;
    const channelId = body?.channelId?.trim() ?? "";
    const mode = body?.mode === "coexistence" ? "coexistence" : "standard";
    if (!channelId) {
      throw new Error("WHATSAPP_CHANNEL_REQUIRED");
    }

    assertWhatsAppCloudEnabled(manager.workspaceId);
    if (mode === "coexistence") {
      assertWhatsAppCoexistenceEnabled(manager.workspaceId);
    }

    const config = await getMetaEmbeddedSignupConfig();
    if (!config.enabled || !config.configId) {
      throw new Error("META_EMBEDDED_SIGNUP_NOT_CONFIGURED");
    }
    const attempt = await createMetaOnboardingAttempt({
      workspaceId: manager.workspaceId,
      channelId,
      initiatedByAgentId: manager.id,
      configId: config.configId,
      mode
    });

    return NextResponse.json({
      attemptId: attempt.id,
      state: attempt.state,
      expiresAt: attempt.expiresAt.toISOString(),
      mode
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "META_ONBOARDING_START_FAILED";
    const status = code === "UNAUTHORIZED" ? 401 : code === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: code }, { status });
  }
}
