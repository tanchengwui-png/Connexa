import { NextResponse } from "next/server";
import { requireApiManager } from "@/lib/auth/current-user";
import { sendBrandedTestEmail } from "@/lib/test-email";

const TEST_EMAIL_RECIPIENT = "tanchengwui@hotmail.com";

export async function POST() {
  try {
    await requireApiManager();
    await sendBrandedTestEmail(TEST_EMAIL_RECIPIENT);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to send test email.";
    const status =
      message === "UNAUTHORIZED"
        ? 401
        : message === "FORBIDDEN" || message === "EMAIL_NOT_VERIFIED"
          ? 403
          : 400;

    return NextResponse.json(
      { error: status === 401 ? "Unauthorized." : status === 403 ? "Forbidden." : message },
      { status }
    );
  }
}
