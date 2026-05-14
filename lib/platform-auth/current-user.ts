import { redirect } from "next/navigation";
import { getCurrentPlatformSession } from "@/lib/platform-auth/session";

export async function getCurrentPlatformAdmin() {
  const session = await getCurrentPlatformSession();

  if (!session) {
    return null;
  }

  return {
    id: session.admin.id,
    name: session.admin.name,
    email: session.admin.email
  };
}

export async function requireCurrentPlatformAdmin() {
  const admin = await getCurrentPlatformAdmin();

  if (!admin) {
    redirect("/platform/login");
  }

  return admin;
}

export async function requireApiPlatformAdmin() {
  const admin = await getCurrentPlatformAdmin();

  if (!admin) {
    throw new Error("UNAUTHORIZED");
  }

  return admin;
}
