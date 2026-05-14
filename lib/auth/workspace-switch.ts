import { getAgentEntryPath } from "@/lib/auth/entry-path";
import { clearSession, createSession, getCurrentSession } from "@/lib/auth/session";
import { findAgentsByAccountId } from "@/lib/db-auth";

export async function switchWorkspaceSession(input: {
  currentAccountId: string | null;
  targetAgentId: string;
}) {
  if (!input.currentAccountId || !input.targetAgentId) {
    throw new Error("A target workspace is required.");
  }

  const memberships = await findAgentsByAccountId(input.currentAccountId);
  const target = memberships.find((membership) => membership.id === input.targetAgentId);

  if (!target) {
    throw new Error("Selected workspace is not available for this account.");
  }

  if (!target.effectiveEmailVerifiedAt) {
    throw new Error("Verify your email before switching to this workspace.");
  }

  const currentSession = await getCurrentSession();

  if (!currentSession) {
    throw new Error("UNAUTHORIZED");
  }

  await clearSession();
  await createSession({
    agentId: target.id,
    workspaceId: target.workspaceId,
    remember: currentSession.remember
  });

  return {
    redirectTo: await getAgentEntryPath({
      id: target.id,
      workspaceId: target.workspaceId,
      emailVerifiedAt: target.effectiveEmailVerifiedAt,
      role: target.role
    })
  };
}
