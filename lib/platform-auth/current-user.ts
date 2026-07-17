import { redirect } from "next/navigation";
import { getCurrentPlatformSession, resolvePlatformAuthState } from "@/lib/platform-auth/session";

async function getCurrentRequestPath() {
  const { headers } = await import("next/headers");
  const value = (await headers()).get("x-connexa-return-to");
  return value && value.startsWith("/") ? value : "/platform";
}

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

type CurrentPlatformAdmin = NonNullable<Awaited<ReturnType<typeof getCurrentPlatformAdmin>>>;

export async function requireCurrentPlatformAdmin(): Promise<CurrentPlatformAdmin> {
  const sessionState = await resolvePlatformAuthState({ mode: "page" });

  if (sessionState.status === "restore_required") {
    const returnTo = await getCurrentRequestPath();
    redirect(`/api/platform/auth/session/restore?returnTo=${encodeURIComponent(returnTo)}`);
  }

  if (sessionState.status !== "authenticated") {
    redirect(sessionState.status === "expired" ? "/platform/login?reason=session-expired" : "/platform/login");
  }

  if (sessionState.status !== "authenticated") {
    throw new Error("Current platform admin session is required");
  }

  const admin = {
    id: sessionState.session.admin.id,
    name: sessionState.session.admin.name,
    email: sessionState.session.admin.email
  };

  return admin;
}

export async function requireApiPlatformAdmin(): Promise<CurrentPlatformAdmin> {
  const sessionState = await resolvePlatformAuthState({ mode: "api" });

  if (sessionState.status !== "authenticated") {
    throw new Error("UNAUTHORIZED");
  }

  const admin = {
    id: sessionState.session.admin.id,
    name: sessionState.session.admin.name,
    email: sessionState.session.admin.email
  };

  return admin;
}
