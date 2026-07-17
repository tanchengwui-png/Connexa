import { NextRequest, NextResponse } from "next/server";
import { changeCurrentUserPassword } from "@/lib/auth/change-password";
import { requireCurrentApiAgent } from "@/lib/auth/current-user";

const VALIDATION_ERRORS = new Set([
  "Current password is required.",
  "New password is required.",
  "Password must be at least 8 characters.",
  "Passwords do not match.",
  "Current password is incorrect."
]);

export async function POST(request: NextRequest) {
  try {
    const agent = await requireCurrentApiAgent();
    const body = (await request.json().catch(() => null)) as
      | {
          currentPassword?: string;
          newPassword?: string;
          confirmNewPassword?: string;
        }
      | null;

    await changeCurrentUserPassword({
      agentId: agent.id,
      currentPassword: body?.currentPassword ?? "",
      newPassword: body?.newPassword ?? "",
      confirmNewPassword: body?.confirmNewPassword ?? ""
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to change password.";
    const status =
      message === "UNAUTHORIZED"
        ? 401
        : message === "EMAIL_NOT_VERIFIED"
          ? 403
          : VALIDATION_ERRORS.has(message)
            ? 400
            : 500;

    return NextResponse.json(
      {
        error:
          message === "UNAUTHORIZED"
            ? "Unauthorized."
            : message === "EMAIL_NOT_VERIFIED"
              ? "Verify your email before changing your password."
              : status === 500
                ? "Unable to change password right now."
                : message
      },
      { status }
    );
  }
}
