import assert from "node:assert/strict";
import test from "node:test";
import { readCurrentRememberSessionState, readCurrentSessionState } from "../lib/auth/session";
import {
  DEFAULT_SESSION_TIMEOUT_MINUTES,
  REMEMBER_ME_SESSION_TIMEOUT_MINUTES,
  buildSessionExpiryDate,
  convertSessionTimeoutToMinutes,
  getSessionExpiryMessage,
  normalizeSessionTimeoutMinutes
} from "../lib/session-timeout";

function createSession(overrides: Partial<{
  id: string;
  expiresAt: Date;
  remember: boolean;
}> = {}) {
  return {
    id: overrides.id ?? "session_1",
    agentId: "agent_1",
    workspaceId: "workspace_1",
    tokenHash: "hashed",
    remember: overrides.remember ?? false,
    expiresAt: overrides.expiresAt ?? new Date("2026-07-06T02:00:00.000Z"),
    lastUsedAt: new Date("2026-07-06T00:00:00.000Z"),
    createdAt: new Date("2026-07-06T00:00:00.000Z"),
    agent: {
      id: "agent_1",
      accountId: "account_1",
      workspaceId: "workspace_1",
      name: "Aisyah",
      email: "aisyah@connexa.test",
      phone: null,
      passwordHash: null,
      emailVerifiedAt: new Date("2026-07-01T00:00:00.000Z"),
      lastLoginAt: null,
      inviteAcceptedAt: null,
      role: "MANAGER",
      status: "ACTIVE",
      createdAt: new Date("2026-07-01T00:00:00.000Z"),
      updatedAt: new Date("2026-07-01T00:00:00.000Z")
    }
  };
}

function createRememberSession(overrides: Partial<{
  id: string;
  expiresAt: Date;
}> = {}) {
  return {
    id: overrides.id ?? "remember_1",
    agentId: "agent_1",
    workspaceId: "workspace_1",
    tokenHash: "hashed",
    expiresAt: overrides.expiresAt ?? new Date("2026-08-05T00:00:00.000Z"),
    lastUsedAt: new Date("2026-07-06T00:00:00.000Z"),
    createdAt: new Date("2026-07-06T00:00:00.000Z"),
    agent: createSession().agent
  };
}

test("login without remember me uses the configured timeout", () => {
  const now = new Date("2026-07-06T00:00:00.000Z");
  const expiresAt = buildSessionExpiryDate({
    now,
    remember: false,
    sessionTimeoutMinutes: 90
  });

  assert.equal(expiresAt.toISOString(), "2026-07-06T01:30:00.000Z");
});

test("login with remember me preserves the extended timeout", () => {
  const now = new Date("2026-07-06T00:00:00.000Z");
  const expiresAt = buildSessionExpiryDate({
    now,
    remember: true,
    sessionTimeoutMinutes: 15
  });

  assert.equal(
    expiresAt.getTime() - now.getTime(),
    REMEMBER_ME_SESSION_TIMEOUT_MINUTES * 60 * 1000
  );
});

test("missing session timeout config falls back to the default", () => {
  assert.equal(normalizeSessionTimeoutMinutes(undefined), DEFAULT_SESSION_TIMEOUT_MINUTES);
  assert.equal(normalizeSessionTimeoutMinutes(0), DEFAULT_SESSION_TIMEOUT_MINUTES);
});

test("session timeout conversion supports days for remember-me settings", () => {
  assert.equal(convertSessionTimeoutToMinutes(30, "days"), 43_200);
});

test("expired session is blocked and deleted", async () => {
  const deletedSessionIds: string[] = [];
  const state = await readCurrentSessionState({
    cookieValue: "plain-token",
    now: new Date("2026-07-06T03:00:00.000Z"),
    findSessionByTokenHashImpl: async () =>
      createSession({
        id: "session_expired",
        expiresAt: new Date("2026-07-06T02:00:00.000Z")
      }),
    deleteSessionByIdImpl: async (sessionId: string) => {
      deletedSessionIds.push(sessionId);
    }
  });

  assert.equal(state.status, "expired");
  assert.deepEqual(deletedSessionIds, ["session_expired"]);
});

test("expired-session message is available for the login page", () => {
  assert.equal(
    getSessionExpiryMessage("session-expired"),
    "Your session has expired. Please log in again."
  );
  assert.equal(getSessionExpiryMessage("other"), null);
});

test("remember me session is created from a fixed expiry window and not rejected before expiry", async () => {
  const state = await readCurrentRememberSessionState({
    cookieValue: "remember-token",
    now: new Date("2026-07-20T00:00:00.000Z"),
    findSessionByTokenHashImpl: async () => createRememberSession(),
    touchRememberSessionImpl: async () => undefined
  });

  assert.equal(state.status, "authenticated");
});

test("remember me session is rejected after its configured expiry", async () => {
  const deletedSessionIds: string[] = [];
  const state = await readCurrentRememberSessionState({
    cookieValue: "remember-token",
    now: new Date("2026-08-06T00:00:00.000Z"),
    findSessionByTokenHashImpl: async () =>
      createRememberSession({
        id: "remember_expired",
        expiresAt: new Date("2026-08-05T00:00:00.000Z")
      }),
    deleteSessionByIdImpl: async (sessionId: string) => {
      deletedSessionIds.push(sessionId);
    },
    touchRememberSessionImpl: async () => undefined
  });

  assert.equal(state.status, "expired");
  assert.deepEqual(deletedSessionIds, ["remember_expired"]);
});
