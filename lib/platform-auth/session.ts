import { createHash, randomBytes } from "node:crypto";
import { cache } from "react";
import {
  createPlatformRememberSessionRecord,
  createPlatformSessionRecord,
  deletePlatformRememberSessionById,
  deletePlatformRememberSessionsByTokenHash,
  deletePlatformSessionById,
  deletePlatformSessionsByTokenHash,
  findPlatformRememberSessionWithAdminByTokenHash,
  findPlatformSessionWithAdminByTokenHash,
  type PlatformRememberSessionWithAdminRow,
  type PlatformSessionWithAdminRow,
  updatePlatformSessionRecord
} from "@/lib/db-auth";
import { getPlatformSessionConfig } from "@/lib/platform-config";
import { buildSessionExpiryDate } from "@/lib/session-timeout";

const PLATFORM_SESSION_COOKIE_NAME = "connexa_platform_session";
const PLATFORM_REMEMBER_SESSION_COOKIE_NAME = "connexa_platform_remember_session";

export type PlatformSessionState =
  | { status: "missing" }
  | { status: "invalid" }
  | { status: "expired" }
  | { status: "authenticated"; session: PlatformSessionWithAdminRow };

export type PlatformRememberSessionState =
  | { status: "missing" }
  | { status: "invalid" }
  | { status: "expired" }
  | { status: "authenticated"; session: PlatformRememberSessionWithAdminRow };

export type PlatformAuthState =
  | PlatformSessionState
  | { status: "restore_required"; rememberSession: PlatformRememberSessionWithAdminRow };

async function getCookieStore() {
  const { cookies } = await import("next/headers");
  return cookies();
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

async function buildActiveExpiryDate() {
  const { sessionTimeoutMinutes } = await getPlatformSessionConfig();
  return buildSessionExpiryDate({
    remember: false,
    sessionTimeoutMinutes
  });
}

async function buildRememberExpiryDate() {
  const { rememberMeTimeoutMinutes } = await getPlatformSessionConfig();
  return new Date(Date.now() + rememberMeTimeoutMinutes * 60 * 1000);
}

function setActiveSessionCookie(cookieStore: Awaited<ReturnType<typeof getCookieStore>>, token: string) {
  cookieStore.set(PLATFORM_SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/"
  });
}

function clearActiveSessionCookie(cookieStore: Awaited<ReturnType<typeof getCookieStore>>) {
  cookieStore.set(PLATFORM_SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0
  });
}

function setRememberSessionCookie(
  cookieStore: Awaited<ReturnType<typeof getCookieStore>>,
  token: string,
  expiresAt: Date
) {
  cookieStore.set(PLATFORM_REMEMBER_SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt
  });
}

function clearRememberSessionCookie(cookieStore: Awaited<ReturnType<typeof getCookieStore>>) {
  cookieStore.set(PLATFORM_REMEMBER_SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0
  });
}

async function createActivePlatformSession(options: {
  adminId: string;
}) {
  const token = randomBytes(32).toString("hex");
  const expiresAt = await buildActiveExpiryDate();

  await createPlatformSessionRecord({
    adminId: options.adminId,
    tokenHash: hashToken(token),
    expiresAt
  });

  const cookieStore = await getCookieStore();
  setActiveSessionCookie(cookieStore, token);
}

async function createRememberPlatformSession(options: {
  adminId: string;
}) {
  const token = randomBytes(32).toString("hex");
  const expiresAt = await buildRememberExpiryDate();

  await createPlatformRememberSessionRecord({
    adminId: options.adminId,
    tokenHash: hashToken(token),
    expiresAt
  });

  const cookieStore = await getCookieStore();
  setRememberSessionCookie(cookieStore, token, expiresAt);
}

async function clearCurrentActivePlatformSession() {
  const cookieStore = await getCookieStore();
  const token = cookieStore.get(PLATFORM_SESSION_COOKIE_NAME)?.value;

  if (token) {
    await deletePlatformSessionsByTokenHash(hashToken(token));
  }

  clearActiveSessionCookie(cookieStore);
}

async function clearCurrentRememberPlatformSession() {
  const cookieStore = await getCookieStore();
  const token = cookieStore.get(PLATFORM_REMEMBER_SESSION_COOKIE_NAME)?.value;

  if (token) {
    await deletePlatformRememberSessionsByTokenHash(hashToken(token));
  }

  clearRememberSessionCookie(cookieStore);
}

export async function hasPlatformRememberSessionCookie() {
  const cookieStore = await getCookieStore();
  return Boolean(cookieStore.get(PLATFORM_REMEMBER_SESSION_COOKIE_NAME)?.value);
}

export async function readCurrentPlatformSessionState(options?: {
  cookieValue?: string | null;
  now?: Date;
  findSessionByTokenHashImpl?: typeof findPlatformSessionWithAdminByTokenHash;
  deleteSessionByIdImpl?: typeof deletePlatformSessionById;
}): Promise<PlatformSessionState> {
  const cookieStore = await getCookieStore();
  const token = options?.cookieValue ?? cookieStore.get(PLATFORM_SESSION_COOKIE_NAME)?.value;

  if (!token) {
    return { status: "missing" };
  }

  const findSessionByTokenHash = options?.findSessionByTokenHashImpl ?? findPlatformSessionWithAdminByTokenHash;
  const deleteSessionRecordById = options?.deleteSessionByIdImpl ?? deletePlatformSessionById;
  const session = await findSessionByTokenHash(hashToken(token));

  if (!session) {
    return { status: "invalid" };
  }

  if (session.expiresAt <= (options?.now ?? new Date())) {
    await deleteSessionRecordById(session.id);
    return { status: "expired" };
  }

  return { status: "authenticated", session };
}

export async function readCurrentPlatformRememberSessionState(options?: {
  cookieValue?: string | null;
  now?: Date;
  findSessionByTokenHashImpl?: typeof findPlatformRememberSessionWithAdminByTokenHash;
  deleteSessionByIdImpl?: typeof deletePlatformRememberSessionById;
}): Promise<PlatformRememberSessionState> {
  const cookieStore = await getCookieStore();
  const token =
    options?.cookieValue ?? cookieStore.get(PLATFORM_REMEMBER_SESSION_COOKIE_NAME)?.value;

  if (!token) {
    return { status: "missing" };
  }

  const findSessionByTokenHash =
    options?.findSessionByTokenHashImpl ?? findPlatformRememberSessionWithAdminByTokenHash;
  const deleteSessionRecordById =
    options?.deleteSessionByIdImpl ?? deletePlatformRememberSessionById;
  const session = await findSessionByTokenHash(hashToken(token));

  if (!session) {
    return { status: "invalid" };
  }

  if (session.expiresAt <= (options?.now ?? new Date())) {
    await deleteSessionRecordById(session.id);
    return { status: "expired" };
  }

  return { status: "authenticated", session };
}

async function refreshPlatformSession(session: PlatformSessionWithAdminRow) {
  const expiresAt = await buildActiveExpiryDate();
  await updatePlatformSessionRecord(session.id, expiresAt);
}

async function restorePlatformSessionFromRemember(
  rememberSession: PlatformRememberSessionWithAdminRow
) {
  await createActivePlatformSession({
    adminId: rememberSession.admin.id
  });

  return {
    status: "authenticated" as const,
    session: {
      id: `restored:${rememberSession.id}`,
      adminId: rememberSession.admin.id,
      tokenHash: "",
      expiresAt: await buildActiveExpiryDate(),
      lastUsedAt: new Date(),
      createdAt: new Date(),
      admin: rememberSession.admin
    }
  };
}

export async function resolvePlatformAuthState(options: {
  mode: "page" | "api";
}): Promise<PlatformAuthState> {
  const activeState = await readCurrentPlatformSessionState();

  if (activeState.status === "authenticated") {
    await refreshPlatformSession(activeState.session);
    return activeState;
  }

  const rememberState = await readCurrentPlatformRememberSessionState();

  if (rememberState.status === "authenticated") {
    if (options.mode === "api") {
      await clearCurrentActivePlatformSession();
      return restorePlatformSessionFromRemember(rememberState.session);
    }

    return {
      status: "restore_required",
      rememberSession: rememberState.session
    };
  }

  if (activeState.status === "expired" || rememberState.status === "expired") {
    return { status: "expired" };
  }

  return activeState.status === "invalid" ? { status: "invalid" } : { status: "missing" };
}

export const getCurrentPlatformSessionState = cache(async () => {
  return readCurrentPlatformSessionState();
});

export const getCurrentPlatformSession = cache(async () => {
  const state = await getCurrentPlatformSessionState();
  return state.status === "authenticated" ? state.session : null;
});

export async function createPlatformSession(options: {
  adminId: string;
  remember: boolean;
}) {
  await clearCurrentActivePlatformSession();
  await createActivePlatformSession({ adminId: options.adminId });

  if (options.remember) {
    await clearCurrentRememberPlatformSession();
    await createRememberPlatformSession({ adminId: options.adminId });
    return;
  }

  await clearCurrentRememberPlatformSession();
}

export async function restorePlatformSessionFromRememberCookie() {
  const rememberState = await readCurrentPlatformRememberSessionState();

  if (rememberState.status !== "authenticated") {
    await clearPlatformSession();
    return { restored: false as const };
  }

  await clearCurrentActivePlatformSession();
  await createActivePlatformSession({
    adminId: rememberState.session.admin.id
  });

  return { restored: true as const };
}

export async function clearPlatformSession() {
  await clearCurrentActivePlatformSession();
  await clearCurrentRememberPlatformSession();
}
