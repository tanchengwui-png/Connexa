import { NextRequest, NextResponse } from "next/server";
import { requireApiPlatformAdmin } from "@/lib/platform-auth/current-user";
import { sendBrandedTestEmail } from "@/lib/test-email";

export async function POST(request: NextRequest) {
  try {
    await requireApiPlatformAdmin();
    const body = (await request.json()) as {
      to?: string;
    };

    const to = String(body.to ?? "").trim();

    if (!to) {
      return NextResponse.json({ error: "Recipient email is required." }, { status: 400 });
    }

    await sendBrandedTestEmail(to);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to send test email.";
    return NextResponse.json({ error: message === "UNAUTHORIZED" ? "Unauthorized." : message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}
