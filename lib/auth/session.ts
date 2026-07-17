import { createHash, randomBytes } from "node:crypto";
import { cache } from "react";
import {
  createRememberSessionRecord,
  createSessionRecord,
  deleteRememberSessionById,
  deleteRememberSessionsByTokenHash,
  deleteSessionById,
  deleteSessionsByTokenHash,
  findRememberSessionWithAgentByTokenHash,
  findSessionWithAgentByTokenHash,
  touchRememberSessionRecord,
  type RememberSessionWithAgentRow,
  type SessionWithAgentRow,
  updateRememberSessionContext,
  updateSessionRecord
} from "@/lib/db-auth";
import { getPlatformSessionConfig } from "@/lib/platform-config";
import { buildSessionExpiryDate } from "@/lib/session-timeout";

const SESSION_COOKIE_NAME = "connexa_session";
const REMEMBER_SESSION_COOKIE_NAME = "connexa_remember_session";

export type SessionState =
  | { status: "missing" }
  | { status: "invalid" }
  | { status: "expired" }
  | { status: "authenticated"; session: SessionWithAgentRow };

export type RememberSessionState =
  | { status: "missing" }
  | { status: "invalid" }
  | { status: "expired" }
  | { status: "authenticated"; session: RememberSessionWithAgentRow };

export type AgentAuthState =
  | SessionState
  | { status: "restore_required"; rememberSession: RememberSessionWithAgentRow };

async function getCookieStore() {
  const { cookies } = await import("next/headers");
  return cookies();
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function buildRememberExpiryDate(rememberMeTimeoutMinutes: number) {
  return new Date(Date.now() + rememberMeTimeoutMinutes * 60 * 1000);
}

async function buildActiveExpiryDate() {
  const { sessionTimeoutMinutes } = await getPlatformSessionConfig();
  return buildSessionExpiryDate({
    remember: false,
    sessionTimeoutMinutes
  });
}

async function buildRememberSessionExpiryDate() {
  const { rememberMeTimeoutMinutes } = await getPlatformSessionConfig();
  return buildRememberExpiryDate(rememberMeTimeoutMinutes);
}

function setActiveSessionCookie(cookieStore: Awaited<ReturnType<typeof getCookieStore>>, token: string) {
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/"
  });
}

function clearActiveSessionCookie(cookieStore: Awaited<ReturnType<typeof getCookieStore>>) {
  cookieStore.set(SESSION_COOKIE_NAME, "", {
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
  cookieStore.set(REMEMBER_SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt
  });
}

function clearRememberSessionCookie(cookieStore: Awaited<ReturnType<typeof getCookieStore>>) {
  cookieStore.set(REMEMBER_SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0
  });
}

async function createActiveSession(options: {
  agentId: string;
  workspaceId: string;
  remember: boolean;
}) {
  const token = randomBytes(32).toString("hex");
  const expiresAt = await buildActiveExpiryDate();

  await createSessionRecord({
    agentId: options.agentId,
    workspaceId: options.workspaceId,
    tokenHash: hashToken(token),
    remember: options.remember,
    expiresAt
  });

  const cookieStore = await getCookieStore();
  setActiveSessionCookie(cookieStore, token);

  return { token, expiresAt };
}

async function createRememberSession(options: {
  agentId: string;
  workspaceId: string;
  expiresAt?: Date;
}) {
  const token = randomBytes(32).toString("hex");
  const expiresAt = options.expiresAt ?? (await buildRememberSessionExpiryDate());

  await createRememberSessionRecord({
    agentId: options.agentId,
    workspaceId: options.workspaceId,
    tokenHash: hashToken(token),
    expiresAt
  });

  const cookieStore = await getCookieStore();
  setRememberSessionCookie(cookieStore, token, expiresAt);

  return { token, expiresAt };
}

async function clearCurrentActiveSession() {
  const cookieStore = await getCookieStore();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (token) {
    await deleteSessionsByTokenHash(hashToken(token));
  }

  clearActiveSessionCookie(cookieStore);
}

async function clearCurrentRememberSession() {
  const cookieStore = await getCookieStore();
  const token = cookieStore.get(REMEMBER_SESSION_COOKIE_NAME)?.value;

  if (token) {
    await deleteRememberSessionsByTokenHash(hashToken(token));
  }

  clearRememberSessionCookie(cookieStore);
}

export async function hasRememberSessionCookie() {
  const cookieStore = await getCookieStore();
  return Boolean(cookieStore.get(REMEMBER_SESSION_COOKIE_NAME)?.value);
}

export async function readCurrentSessionState(options?: {
  cookieValue?: string | null;
  now?: Date;
  findSessionByTokenHashImpl?: typeof findSessionWithAgentByTokenHash;
  deleteSessionByIdImpl?: typeof deleteSessionById;
}): Promise<SessionState> {
  const token = options?.cookieValue ?? (await getCookieStore()).get(SESSION_COOKIE_NAME)?.value;

  if (!token) {
    return { status: "missing" };
  }

  const findSessionByTokenHash = options?.findSessionByTokenHashImpl ?? findSessionWithAgentByTokenHash;
  const deleteSessionRecordById = options?.deleteSessionByIdImpl ?? deleteSessionById;
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

export async function readCurrentRememberSessionState(options?: {
  cookieValue?: string | null;
  now?: Date;
  findSessionByTokenHashImpl?: typeof findRememberSessionWithAgentByTokenHash;
  deleteSessionByIdImpl?: typeof deleteRememberSessionById;
  touchRememberSessionImpl?: typeof touchRememberSessionRecord;
}): Promise<RememberSessionState> {
  const token =
    options?.cookieValue ?? (await getCookieStore()).get(REMEMBER_SESSION_COOKIE_NAME)?.value;

  if (!token) {
    return { status: "missing" };
  }

  const findSessionByTokenHash =
    options?.findSessionByTokenHashImpl ?? findRememberSessionWithAgentByTokenHash;
  const deleteSessionRecordById = options?.deleteSessionByIdImpl ?? deleteRememberSessionById;
  const touchRememberSession = options?.touchRememberSessionImpl ?? touchRememberSessionRecord;
  const session = await findSessionByTokenHash(hashToken(token));

  if (!session) {
    return { status: "invalid" };
  }

  if (session.expiresAt <= (options?.now ?? new Date())) {
    await deleteSessionRecordById(session.id);
    return { status: "expired" };
  }

  await touchRememberSession(session.id, options?.now ?? new Date());
  return { status: "authenticated", session };
}

async function refreshActiveSession(session: SessionWithAgentRow) {
  const expiresAt = await buildActiveExpiryDate();
  await updateSessionRecord(session.id, expiresAt, session.remember);
}

async function restoreActiveSessionFromRemember(rememberSession: RememberSessionWithAgentRow) {
  await createActiveSession({
    agentId: rememberSession.agent.id,
    workspaceId: rememberSession.workspaceId,
    remember: true
  });

  return {
    status: "authenticated" as const,
    session: {
      id: `restored:${rememberSession.id}`,
      agentId: rememberSession.agent.id,
      workspaceId: rememberSession.workspaceId,
      tokenHash: "",
      remember: true,
      expiresAt: await buildActiveExpiryDate(),
      lastUsedAt: new Date(),
      createdAt: new Date(),
      agent: rememberSession.agent
    }
  };
}

export async function resolveAgentAuthState(options: {
  mode: "page" | "api";
}): Promise<AgentAuthState> {
  const activeState = await readCurrentSessionState();

  if (activeState.status === "authenticated") {
    await refreshActiveSession(activeState.session);
    return activeState;
  }

  const rememberState = await readCurrentRememberSessionState();

  if (rememberState.status === "authenticated") {
    if (options.mode === "api") {
      await clearCurrentActiveSession();
      return restoreActiveSessionFromRemember(rememberState.session);
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

export const getCurrentSessionState = cache(async () => {
  return readCurrentSessionState();
});

export const getCurrentSession = cache(async () => {
  const state = await getCurrentSessionState();
  return state.status === "authenticated" ? state.session : null;
});

export async function getCurrentRememberSession() {
  const state = await readCurrentRememberSessionState();
  return state.status === "authenticated" ? state.session : null;
}

export async function createSession(options: {
  agentId: string;
  workspaceId: string;
  remember: boolean;
}) {
  await clearCurrentActiveSession();
  await createActiveSession(options);

  if (options.remember) {
    await clearCurrentRememberSession();
    await createRememberSession({
      agentId: options.agentId,
      workspaceId: options.workspaceId
    });
    return;
  }

  await clearCurrentRememberSession();
}

export async function replaceActiveSession(options: {
  agentId: string;
  workspaceId: string;
  remember: boolean;
}) {
  await clearCurrentActiveSession();
  await createActiveSession(options);
}

export async function updateCurrentRememberSessionWorkspace(options: {
  agentId: string;
  workspaceId: string;
}) {
  const rememberSession = await getCurrentRememberSession();

  if (!rememberSession) {
    return;
  }

  await updateRememberSessionContext({
    sessionId: rememberSession.id,
    agentId: options.agentId,
    workspaceId: options.workspaceId
  });
}

export async function restoreSessionFromRemember() {
  const rememberState = await readCurrentRememberSessionState();

  if (rememberState.status !== "authenticated") {
    await clearSession();
    return { restored: false as const };
  }

  await clearCurrentActiveSession();
  await createActiveSession({
    agentId: rememberState.session.agent.id,
    workspaceId: rememberState.session.workspaceId,
    remember: true
  });

  return {
    restored: true as const,
    agent: {
      id: rememberState.session.agent.id,
      workspaceId: rememberState.session.workspaceId,
      emailVerifiedAt: rememberState.session.agent.emailVerifiedAt,
      role: rememberState.session.agent.role
    }
  };
}

export async function clearSession() {
  await clearCurrentActiveSession();
  await clearCurrentRememberSession();
}
