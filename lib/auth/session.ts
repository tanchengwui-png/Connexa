import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { cache } from "react";
import { prisma } from "@/lib/prisma";

const SESSION_COOKIE_NAME = "connexa_session";
const SHORT_SESSION_SECONDS = 60 * 60 * 24;
const LONG_SESSION_SECONDS = 60 * 60 * 24 * 30;

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function buildExpiry(remember: boolean) {
  return new Date(Date.now() + (remember ? LONG_SESSION_SECONDS : SHORT_SESSION_SECONDS) * 1000);
}

export const getCurrentSession = cache(async () => {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!token) {
    return null;
  }

  const session = await prisma.session.findUnique({
    where: {
      tokenHash: hashToken(token)
    },
    include: {
      agent: true
    }
  });

  if (!session) {
    return null;
  }

  if (session.expiresAt <= new Date()) {
    await prisma.session.delete({
      where: {
        id: session.id
      }
    });
    return null;
  }

  return session;
});

export async function createSession(options: {
  agentId: string;
  workspaceId: string;
  remember: boolean;
}) {
  const token = randomBytes(32).toString("hex");
  const expiresAt = buildExpiry(options.remember);

  await prisma.session.create({
    data: {
      agentId: options.agentId,
      workspaceId: options.workspaceId,
      tokenHash: hashToken(token),
      expiresAt
    }
  });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt
  });
}

export async function refreshSession(sessionId: string, remember: boolean) {
  const expiresAt = buildExpiry(remember);

  await prisma.session.update({
    where: {
      id: sessionId
    },
    data: {
      expiresAt,
      lastUsedAt: new Date()
    }
  });

  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (token) {
    cookieStore.set(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      expires: expiresAt
    });
  }
}

export async function clearSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (token) {
    await prisma.session.deleteMany({
      where: {
        tokenHash: hashToken(token)
      }
    });
  }

  cookieStore.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0
  });
}

export async function touchCurrentSession(remember: boolean) {
  const session = await getCurrentSession();
  if (!session) {
    return null;
  }

  await refreshSession(session.id, remember);
  return session;
}
