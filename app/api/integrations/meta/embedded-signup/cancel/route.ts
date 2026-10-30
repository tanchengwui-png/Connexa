import { NextRequest, NextResponse } from "next/server";
import { requireApiManager } from "@/lib/auth/current-user";
import { assertWhatsAppCloudEnabled } from "@/lib/whatsapp-cloud/feature-flags";
import { cancelMetaOnboardingAttempt } from "@/lib/whatsapp-cloud/onboarding";

export async function POST(request: NextRequest) {
  try {
    const manager = await requireApiManager();
    const body = (await request.json().catch(() => null)) as {
      attemptId?: string;
      channelId?: string;
    } | null;
    const attemptId = body?.attemptId?.trim() ?? "";
    const channelId = body?.channelId?.trim() ?? "";
    if (!attemptId || !channelId) {
      throw new Error("META_ONBOARDING_ATTEMPT_REQUIRED");
    }
    assertWhatsAppCloudEnabled(manager.workspaceId);
    const result = await cancelMetaOnboardingAttempt({
      attemptId,
      workspaceId: manager.workspaceId,
      channelId,
      initiatedByAgentId: manager.id
    });
    return NextResponse.json({
      cancelled: result.cancelled,
      cancelledAt: result.cancelledAt.toISOString()
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "META_ONBOARDING_CANCEL_FAILED";
    const status = code === "UNAUTHORIZED" ? 401 : code === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: code }, { status });
  }
}
