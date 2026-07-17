import { NextRequest, NextResponse } from "next/server";
import { requireApiPlatformAdmin } from "@/lib/platform-auth/current-user";
import { getPlatformConfigForAdmin, updatePlatformConfig } from "@/lib/platform-config";

export async function GET() {
  try {
    await requireApiPlatformAdmin();
    const settings = await getPlatformConfigForAdmin();
    return NextResponse.json({ settings });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load platform settings.";
    return NextResponse.json({ error: message === "UNAUTHORIZED" ? "Unauthorized." : message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    await requireApiPlatformAdmin();
    const body = (await request.json()) as {
      smtpHost?: string;
      smtpPort?: number;
      smtpSecure?: boolean;
      smtpUser?: string;
      smtpPass?: string;
      smtpFrom?: string;
      supportEmail?: string;
      emailBrandName?: string;
      emailBrandTagline?: string;
      billplzApiKey?: string;
      billplzXSignatureKey?: string;
      billplzCollectionId?: string;
      billplzSandbox?: boolean;
      automationWorkflowIdleHours?: number;
      automationWorkflowExpireHours?: number;
      freeTrialDurationDays?: number;
      expiredAccountCleanupDays?: number;
      sessionTimeoutMinutes?: number;
      rememberMeTimeoutMinutes?: number;
    };

    await updatePlatformConfig({
      smtpHost: body.smtpHost ?? "",
      smtpPort: Number(body.smtpPort ?? 587),
      smtpSecure: Boolean(body.smtpSecure),
      smtpUser: body.smtpUser ?? "",
      smtpPass: body.smtpPass ?? "",
      smtpFrom: body.smtpFrom ?? "",
      supportEmail: body.supportEmail ?? "",
      emailBrandName: body.emailBrandName ?? "",
      emailBrandTagline: body.emailBrandTagline ?? "",
      billplzApiKey: body.billplzApiKey ?? "",
      billplzXSignatureKey: body.billplzXSignatureKey ?? "",
      billplzCollectionId: body.billplzCollectionId ?? "",
      billplzSandbox: Boolean(body.billplzSandbox),
      automationWorkflowIdleHours: Number(body.automationWorkflowIdleHours ?? 24),
      automationWorkflowExpireHours: Number(body.automationWorkflowExpireHours ?? 72),
      freeTrialDurationDays: Number(body.freeTrialDurationDays ?? 14),
      expiredAccountCleanupDays: Number(body.expiredAccountCleanupDays ?? 60),
      sessionTimeoutMinutes: Number(body.sessionTimeoutMinutes ?? 60),
      rememberMeTimeoutMinutes: Number(body.rememberMeTimeoutMinutes ?? 43_200)
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save platform settings.";
    return NextResponse.json({ error: message === "UNAUTHORIZED" ? "Unauthorized." : message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}
