import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { updatePasswordForEmail } from "@/lib/db-auth";
import { getCurrentUserPasswordContext } from "@/lib/platform-security";
import { logUserSecurityEvent } from "@/lib/user-security-audit";

export async function changeCurrentUserPassword(input: {
  agentId: string;
  currentPassword: string;
  newPassword: string;
  confirmNewPassword: string;
}, dependencies: {
  getCurrentUserPasswordContextImpl?: typeof getCurrentUserPasswordContext;
  updatePasswordForEmailImpl?: typeof updatePasswordForEmail;
  logUserSecurityEventImpl?: typeof logUserSecurityEvent;
} = {}) {
  const currentPassword = input.currentPassword;
  const newPassword = input.newPassword;
  const confirmNewPassword = input.confirmNewPassword;

  if (!currentPassword) {
    throw new Error("Current password is required.");
  }

  if (!newPassword) {
    throw new Error("New password is required.");
  }

  if (newPassword.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }

  if (newPassword !== confirmNewPassword) {
    throw new Error("Passwords do not match.");
  }

  const getCurrentUserPasswordContextImpl =
    dependencies.getCurrentUserPasswordContextImpl ?? getCurrentUserPasswordContext;
  const updatePasswordForEmailImpl = dependencies.updatePasswordForEmailImpl ?? updatePasswordForEmail;
  const logUserSecurityEventImpl = dependencies.logUserSecurityEventImpl ?? logUserSecurityEvent;
  const currentUser = await getCurrentUserPasswordContextImpl(input.agentId);

  if (!currentUser.effectivePasswordHash || !verifyPassword(currentPassword, currentUser.effectivePasswordHash)) {
    await logUserSecurityEventImpl({
      email: currentUser.email,
      eventType: "password_change_failed",
      metadata: {
        reason: "invalid_current_password"
      }
    });
    throw new Error("Current password is incorrect.");
  }

  await updatePasswordForEmailImpl({
    email: currentUser.email,
    passwordHash: hashPassword(newPassword)
  });

  await logUserSecurityEventImpl({
    email: currentUser.email,
    eventType: "password_change_success"
  });

  return {
    ok: true as const
  };
}
