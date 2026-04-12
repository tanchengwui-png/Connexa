import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/auth/session";

export async function getCurrentAgent() {
  const session = await getCurrentSession();

  if (!session) {
    return null;
  }

  return {
    id: session.agent.id,
    workspaceId: session.workspaceId,
    name: session.agent.name,
    email: session.agent.email,
    emailVerifiedAt: session.agent.emailVerifiedAt,
    role: session.agent.role
  };
}

export async function requireCurrentAgent() {
  const agent = await getCurrentAgent();

  if (!agent) {
    redirect("/login");
  }

  if (!agent.emailVerifiedAt) {
    redirect("/verify-email");
  }

  return agent;
}

export async function requireCurrentApiAgent() {
  const agent = await getCurrentAgent();

  if (!agent) {
    throw new Error("UNAUTHORIZED");
  }

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
    redirect("/inbox");
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
