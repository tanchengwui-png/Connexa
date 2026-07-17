import { getCurrentSession, resolveAgentAuthState } from "@/lib/auth/session";
import { findAgentsByAccountId } from "@/lib/db-auth";

async function redirectTo(path: string): Promise<never> {
  const { redirect } = await import("next/navigation");
  return redirect(path);
}

async function getCurrentRequestPath() {
  const { headers } = await import("next/headers");
  const value = (await headers()).get("x-connexa-return-to");
  return value && value.startsWith("/") ? value : "/inbox";
}

export async function getCurrentAgent() {
  const session = await getCurrentSession();

  if (!session) {
    return null;
  }

  return {
    id: session.agent.id,
    accountId: session.agent.accountId,
    workspaceId: session.workspaceId,
    name: session.agent.name,
    email: session.agent.email,
    emailVerifiedAt: session.agent.emailVerifiedAt,
    role: session.agent.role
  };
}

type CurrentAgent = NonNullable<Awaited<ReturnType<typeof getCurrentAgent>>>;

export async function getCurrentAgentMemberships() {
  const agent = await getCurrentAgent();

  if (!agent) {
    return [];
  }

  if (!agent.accountId) {
    return [];
  }

  const memberships = await findAgentsByAccountId(agent.accountId);

  return memberships.map((membership) => ({
    agentId: membership.id,
    workspaceId: membership.workspaceId,
    workspaceName: membership.workspaceName,
    workspaceSlug: membership.workspaceSlug,
    role: membership.role,
    emailVerifiedAt: membership.effectiveEmailVerifiedAt,
    isCurrent: membership.id === agent.id
  }));
}

export async function requireCurrentAgent(): Promise<CurrentAgent> {
  const sessionState = await resolveAgentAuthState({ mode: "page" });

  if (sessionState.status === "restore_required") {
    const returnTo = await getCurrentRequestPath();
    await redirectTo(`/api/auth/session/restore?returnTo=${encodeURIComponent(returnTo)}`);
  }

  if (sessionState.status !== "authenticated") {
    await redirectTo(sessionState.status === "expired" ? "/login?reason=session-expired" : "/login");
  }

  if (sessionState.status !== "authenticated") {
    throw new Error("Current agent session is required");
  }

  const currentAgent = {
    id: sessionState.session.agent.id,
    accountId: sessionState.session.agent.accountId,
    workspaceId: sessionState.session.workspaceId,
    name: sessionState.session.agent.name,
    email: sessionState.session.agent.email,
    emailVerifiedAt: sessionState.session.agent.emailVerifiedAt,
    role: sessionState.session.agent.role
  };

  if (!currentAgent.emailVerifiedAt) {
    await redirectTo("/verify-email");
  }

  return currentAgent;
}

export async function requireCurrentApiAgent(): Promise<CurrentAgent> {
  const sessionState = await resolveAgentAuthState({ mode: "api" });

  if (sessionState.status !== "authenticated") {
    throw new Error("UNAUTHORIZED");
  }

  const agent = {
    id: sessionState.session.agent.id,
    accountId: sessionState.session.agent.accountId,
    workspaceId: sessionState.session.workspaceId,
    name: sessionState.session.agent.name,
    email: sessionState.session.agent.email,
    emailVerifiedAt: sessionState.session.agent.emailVerifiedAt,
    role: sessionState.session.agent.role
  };

  if (!agent.emailVerifiedAt) {
    throw new Error("EMAIL_NOT_VERIFIED");
  }

  return agent;
}

export async function requireCurrentWorkspaceId() {
  const agent = await requireCurrentAgent();
  return agent.workspaceId;
}

export async function requireManager() {
  const agent = await requireCurrentAgent();

  if (agent.role !== "MANAGER") {
    await redirectTo("/inbox");
  }

  return agent;
}

export async function requireApiManager() {
  const agent = await requireCurrentApiAgent();

  if (agent.role !== "MANAGER") {
    throw new Error("FORBIDDEN");
  }

  return agent;
}
