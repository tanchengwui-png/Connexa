import { prisma } from "@/lib/prisma";
import { requireManager } from "@/lib/auth/current-user";
import { createInvite, listWorkspaceInvites } from "@/lib/auth/invites";
import { getWorkspaceAvailabilitySummary } from "@/lib/availability";
import { getWorkspaceTeamCapacity } from "@/lib/team-capacity";
import { AgentRole, AgentStatus } from "@prisma/client";

export async function getTeamPageData() {
  const manager = await requireManager();

  const [workspace, invites, capacity, availabilitySummary] = await Promise.all([
    prisma.workspace.findUnique({
      where: {
        id: manager.workspaceId
      },
      include: {
        agents: {
          orderBy: {
            createdAt: "asc"
          }
        }
      }
    }),
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
    agents: workspace.agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      email: agent.email,
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
      expiresAt: new Intl.DateTimeFormat("en-MY", { dateStyle: "medium" }).format(invite.expiresAt)
    }))
  };
}

export async function updateWorkspaceMember(input: {
  agentId: string;
  role: AgentRole;
  status: AgentStatus;
}) {
  const manager = await requireManager();

  const member = await prisma.agent.findFirst({
    where: {
      id: input.agentId,
      workspaceId: manager.workspaceId
    }
  });

  if (!member) {
    throw new Error("Team member not found.");
  }

  if (member.id === manager.id && input.role !== AgentRole.MANAGER) {
    throw new Error("You cannot remove your own manager role.");
  }

  if (member.role === AgentRole.MANAGER && input.role !== AgentRole.MANAGER) {
    const managerCount = await prisma.agent.count({
      where: {
        workspaceId: manager.workspaceId,
        role: AgentRole.MANAGER
      }
    });

    if (managerCount <= 1) {
      throw new Error("At least one manager must remain in the workspace.");
    }
  }

  return prisma.agent.update({
    where: {
      id: member.id
    },
    data: {
      role: input.role,
      status: input.status
    }
  });
}

export async function removeWorkspaceMember(agentId: string) {
  const manager = await requireManager();

  const member = await prisma.agent.findFirst({
    where: {
      id: agentId,
      workspaceId: manager.workspaceId
    }
  });

  if (!member) {
    throw new Error("Team member not found.");
  }

  if (member.id === manager.id) {
    throw new Error("You cannot remove your own account.");
  }

  if (member.role === AgentRole.MANAGER) {
    const managerCount = await prisma.agent.count({
      where: {
        workspaceId: manager.workspaceId,
        role: AgentRole.MANAGER
      }
    });

    if (managerCount <= 1) {
      throw new Error("At least one manager must remain in the workspace.");
    }
  }

  await prisma.agent.delete({
    where: {
      id: member.id
    }
  });
}

export async function revokeWorkspaceInvite(inviteId: string) {
  const manager = await requireManager();

  const invite = await prisma.invite.findFirst({
    where: {
      id: inviteId,
      workspaceId: manager.workspaceId,
      acceptedAt: null
    },
    select: {
      id: true
    }
  });

  if (!invite) {
    throw new Error("Invite not found.");
  }

  await prisma.invite.delete({
    where: {
      id: invite.id
    }
  });
}

export async function resendWorkspaceInvite(inviteId: string) {
  const manager = await requireManager();

  const [workspace, invite] = await Promise.all([
    prisma.workspace.findUnique({
      where: {
        id: manager.workspaceId
      },
      select: {
        name: true
      }
    }),
    prisma.invite.findFirst({
      where: {
        id: inviteId,
        workspaceId: manager.workspaceId,
        acceptedAt: null
      }
    })
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
    role: invite.role
  });
}
