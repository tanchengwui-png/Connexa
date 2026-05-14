import { findPlatformAdminByEmail, touchPlatformAdminLastLogin } from "@/lib/db-auth";
import { verifyPassword } from "@/lib/auth/password";
import { createPlatformSession } from "@/lib/platform-auth/session";

export async function loginPlatformAdmin(input: {
  email: string;
  password: string;
  remember: boolean;
}) {
  const email = input.email.trim().toLowerCase();
  const password = input.password;

  if (!email || !password) {
    throw new Error("Email and password are required.");
  }

  const admin = await findPlatformAdminByEmail(email);

  if (!admin || !verifyPassword(password, admin.passwordHash)) {
    throw new Error("Invalid email or password.");
  }

  await touchPlatformAdminLastLogin(admin.id);

  await createPlatformSession({
    adminId: admin.id,
    remember: input.remember
  });

  return admin;
}
