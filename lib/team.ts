import { requireManager } from "@/lib/auth/current-user";
import { createInvite, listWorkspaceInvites } from "@/lib/auth/invites";
import { getWorkspaceAvailabilitySummary } from "@/lib/availability";
import { getWorkspaceTeamCapacity } from "@/lib/team-capacity";
import { AgentRole, AgentStatus } from "@/lib/db-types";
import { MALAYSIA_TIME_ZONE } from "@/lib/malaysia-time";
import {
  countWorkspaceManagers,
  deleteInviteById,
  deleteTeamMember,
  findPendingInviteById,
  findWorkspaceNameById,
  findTeamMember,
  listWorkspaceAgents,
  updateTeamMember
} from "@/lib/db-auth";

export async function getTeamPageData() {
  const manager = await requireManager();

  const [workspace, agents, invites, capacity, availabilitySummary] = await Promise.all([
    findWorkspaceNameById(manager.workspaceId),
    listWorkspaceAgents(manager.workspaceId),
    listWorkspaceInvites(manager.workspaceId),
    getWorkspaceTeamCapacity(manager.workspaceId),
    getWorkspaceAvailabilitySummary(manager.workspaceId)
  ]);

  if (!workspace) {
    throw new Error("Workspace not found.");
  }

  return {
    workspaceName: workspace.name,
    teamCapacity: capacity,
    availabilitySummary,
    agents: agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      email: agent.email,
      phone: agent.phone,
      role: agent.role,
      status: agent.status,
      isCurrentManager: agent.id === manager.id,
      availabilityLabel: availabilitySummary.find((item) => item.agentId === agent.id)?.status.label ?? "No schedule set",
      availabilityTone: availabilitySummary.find((item) => item.agentId === agent.id)?.status.tone ?? "off"
    })),
    invites: invites.map((invite) => ({
      id: invite.id,
      email: invite.email,
      role: invite.role,
      expiresAt: new Intl.DateTimeFormat("en-MY", {
        dateStyle: "medium",
        timeZone: MALAYSIA_TIME_ZONE
      }).format(invite.expiresAt)
    }))
  };
}

export async function updateWorkspaceMember(input: {
  agentId: string;
  role: AgentRole;
  status: AgentStatus;
  phone?: string | null;
}) {
  const manager = await requireManager();

  const member = await findTeamMember(manager.workspaceId, input.agentId);

  if (!member) {
    throw new Error("Team member not found.");
  }

  if (member.id === manager.id && input.role !== AgentRole.MANAGER) {
    throw new Error("You cannot remove your own manager role.");
  }

  if (member.role === AgentRole.MANAGER && input.role !== AgentRole.MANAGER) {
    const managerCount = await countWorkspaceManagers(manager.workspaceId);

    if (managerCount <= 1) {
      throw new Error("At least one manager must remain in the workspace.");
    }
  }

  return updateTeamMember(member.id, {
    role: input.role,
    status: input.status,
    phone: input.phone ?? null
  });
}

export async function removeWorkspaceMember(agentId: string) {
  const manager = await requireManager();

  const member = await findTeamMember(manager.workspaceId, agentId);

  if (!member) {
    throw new Error("Team member not found.");
  }

  if (member.id === manager.id) {
    throw new Error("You cannot remove your own account.");
  }

  if (member.role === AgentRole.MANAGER) {
    const managerCount = await countWorkspaceManagers(manager.workspaceId);

    if (managerCount <= 1) {
      throw new Error("At least one manager must remain in the workspace.");
    }
  }

  await deleteTeamMember(member.id);
}

export async function revokeWorkspaceInvite(inviteId: string) {
  const manager = await requireManager();

  const invite = await findPendingInviteById(manager.workspaceId, inviteId);

  if (!invite) {
    throw new Error("Invite not found.");
  }

  await deleteInviteById(invite.id);
}

export async function resendWorkspaceInvite(inviteId: string) {
  const manager = await requireManager();

  const [workspace, invite] = await Promise.all([
    findWorkspaceNameById(manager.workspaceId),
    findPendingInviteById(manager.workspaceId, inviteId)
  ]);

  if (!workspace) {
    throw new Error("Workspace not found.");
  }

  if (!invite) {
    throw new Error("Invite not found.");
  }

  await createInvite({
    workspaceId: manager.workspaceId,
    invitedById: manager.id,
    inviterName: manager.name,
    workspaceName: workspace.name,
    email: invite.email,
    role: invite.role as AgentRole
  });
}
