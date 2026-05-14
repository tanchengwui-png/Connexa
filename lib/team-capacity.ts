import { countPendingInvites, findWorkspaceWithAgentCount } from "@/lib/db-auth";
import { getWorkspacePlanSettings, normalizeWorkspacePlan } from "@/lib/workspace-plan";

type TeamCapacityOptions = {
  excludeInviteEmail?: string;
};

export async function getWorkspaceTeamCapacity(workspaceId: string, options: TeamCapacityOptions = {}) {
  const workspace = await findWorkspaceWithAgentCount(workspaceId);

  if (!workspace) {
    throw new Error("Workspace not found.");
  }

  const normalizedExcludedEmail = options.excludeInviteEmail?.trim().toLowerCase();
  const pendingInvites = await countPendingInvites(workspaceId, normalizedExcludedEmail);

  const planKey = normalizeWorkspacePlan(workspace.plan);
  const planSettings = getWorkspacePlanSettings(workspace.plan);
  const activeMembers = workspace.agentCount;
  const seatsUsed = activeMembers + pendingInvites;
  const memberLimit = planSettings.memberLimit;

  return {
    planKey,
    planLabel: planSettings.label,
    memberLimit,
    activeMembers,
    pendingInvites,
    seatsUsed,
    seatsRemaining: memberLimit === null ? null : Math.max(memberLimit - seatsUsed, 0),
    isAtCapacity: memberLimit !== null && seatsUsed >= memberLimit
  };
}

export async function assertWorkspaceHasInviteCapacity(workspaceId: string, options: TeamCapacityOptions = {}) {
  const capacity = await getWorkspaceTeamCapacity(workspaceId, options);

  if (capacity.memberLimit !== null && capacity.seatsUsed >= capacity.memberLimit) {
    throw new Error(
      `${capacity.planLabel} plan allows up to ${capacity.memberLimit} team members including pending invites. Remove someone, revoke an invite, or upgrade the plan before inviting more teammates.`
    );
  }

  return capacity;
}

export async function assertWorkspaceHasAcceptanceCapacity(workspaceId: string) {
  const workspace = await findWorkspaceWithAgentCount(workspaceId);

  if (!workspace) {
    throw new Error("Workspace not found.");
  }

  const planSettings = getWorkspacePlanSettings(workspace.plan);

  if (planSettings.memberLimit !== null && workspace.agentCount >= planSettings.memberLimit) {
    throw new Error(
      `This workspace has reached the ${planSettings.label.toLowerCase()} plan team limit of ${planSettings.memberLimit} members. Ask a manager to free a seat or upgrade the plan.`
    );
  }
}
