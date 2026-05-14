import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { cache } from "react";
import {
  createPlatformSessionRecord,
  deletePlatformSessionById,
  deletePlatformSessionsByTokenHash,
  findPlatformSessionWithAdminByTokenHash
} from "@/lib/db-auth";

const PLATFORM_SESSION_COOKIE_NAME = "connexa_platform_session";
const SHORT_SESSION_SECONDS = 60 * 60 * 24;
const LONG_SESSION_SECONDS = 60 * 60 * 24 * 30;

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function buildExpiry(remember: boolean) {
  return new Date(Date.now() + (remember ? LONG_SESSION_SECONDS : SHORT_SESSION_SECONDS) * 1000);
}

export const getCurrentPlatformSession = cache(async () => {
  const cookieStore = await cookies();
  const token = cookieStore.get(PLATFORM_SESSION_COOKIE_NAME)?.value;

  if (!token) {
    return null;
  }

  const session = await findPlatformSessionWithAdminByTokenHash(hashToken(token));

  if (!session) {
    return null;
  }

  if (session.expiresAt <= new Date()) {
    await deletePlatformSessionById(session.id);
    return null;
  }

  return session;
});

export async function createPlatformSession(options: {
  adminId: string;
  remember: boolean;
}) {
  const token = randomBytes(32).toString("hex");
  const expiresAt = buildExpiry(options.remember);

  await createPlatformSessionRecord({
    adminId: options.adminId,
    tokenHash: hashToken(token),
    expiresAt
  });

  const cookieStore = await cookies();
  cookieStore.set(PLATFORM_SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt
  });
}

export async function clearPlatformSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(PLATFORM_SESSION_COOKIE_NAME)?.value;

  if (token) {
    await deletePlatformSessionsByTokenHash(hashToken(token));
  }

  cookieStore.set(PLATFORM_SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0
  });
}
