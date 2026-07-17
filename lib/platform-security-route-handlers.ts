import { NextResponse } from "next/server";
import { requireApiPlatformAdmin } from "@/lib/platform-auth/current-user";
import {
  sendPlatformUserPasswordResetEmail,
  sendPlatformUserVerificationEmail
} from "@/lib/platform-security";

export async function handlePlatformUserResetPasswordRequest(
  agentId: string,
  dependencies: {
    requireApiPlatformAdminImpl?: typeof requireApiPlatformAdmin;
    sendPlatformUserPasswordResetEmailImpl?: typeof sendPlatformUserPasswordResetEmail;
  } = {}
) {
  try {
    const requireApiPlatformAdminImpl =
      dependencies.requireApiPlatformAdminImpl ?? requireApiPlatformAdmin;
    const sendPlatformUserPasswordResetEmailImpl =
      dependencies.sendPlatformUserPasswordResetEmailImpl ?? sendPlatformUserPasswordResetEmail;
    const admin = await requireApiPlatformAdminImpl();
    await sendPlatformUserPasswordResetEmailImpl(agentId, admin.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to send reset password email.";
    return NextResponse.json(
      { error: message === "UNAUTHORIZED" ? "Unauthorized." : message },
      { status: message === "UNAUTHORIZED" ? 401 : 400 }
    );
  }
}

export async function handlePlatformUserResendVerificationRequest(
  agentId: string,
  dependencies: {
    requireApiPlatformAdminImpl?: typeof requireApiPlatformAdmin;
    sendPlatformUserVerificationEmailImpl?: typeof sendPlatformUserVerificationEmail;
  } = {}
) {
  try {
    const requireApiPlatformAdminImpl =
      dependencies.requireApiPlatformAdminImpl ?? requireApiPlatformAdmin;
    const sendPlatformUserVerificationEmailImpl =
      dependencies.sendPlatformUserVerificationEmailImpl ?? sendPlatformUserVerificationEmail;
    const admin = await requireApiPlatformAdminImpl();
    await sendPlatformUserVerificationEmailImpl(agentId, admin.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to resend verification email.";
    return NextResponse.json(
      { error: message === "UNAUTHORIZED" ? "Unauthorized." : message },
      { status: message === "UNAUTHORIZED" ? 401 : 400 }
    );
  }
}
