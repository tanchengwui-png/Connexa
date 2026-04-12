import { AgentRole, AgentStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { createEmailVerification } from "@/lib/auth/verification";
import { normalizeWorkspacePlan } from "@/lib/workspace-plan";

export async function registerWorkspace(input: {
  name: string;
  email: string;
  workspaceName: string;
  password: string;
  plan: string;
  remember: boolean;
}) {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  const workspaceName = input.workspaceName.trim();
  const password = input.password;
  const plan = normalizeWorkspacePlan(input.plan);

  if (!name || !email || !workspaceName || !password) {
    throw new Error("Name, email, workspace name, and password are required.");
  }

  if (password.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }

  const existingAgent = await prisma.agent.findFirst({
    where: {
      email
    },
    select: {
      id: true
    }
  });

  if (existingAgent) {
    throw new Error("An account with that email already exists.");
  }

  const workspaceSlug = await generateWorkspaceSlug(workspaceName);
  const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

  const agent = await prisma.$transaction(async (tx) => {
    const workspace = await tx.workspace.create({
      data: {
        name: workspaceName,
        slug: workspaceSlug,
        plan,
        trialEndsAt
      }
    });

    return tx.agent.create({
      data: {
        workspaceId: workspace.id,
        name,
        email,
        passwordHash: hashPassword(password),
        inviteAcceptedAt: new Date(),
        role: AgentRole.MANAGER,
        status: AgentStatus.ACTIVE
      }
    });
  });

  await createSession({
    agentId: agent.id,
    workspaceId: agent.workspaceId,
    remember: input.remember
  });

  await createEmailVerification(agent.id);

  return {
    agent
  };
}

async function generateWorkspaceSlug(workspaceName: string) {
  const baseSlug = workspaceName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  const fallbackSlug = baseSlug || "workspace";

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const slug = attempt === 0 ? fallbackSlug : `${fallbackSlug}-${attempt + 1}`;
    const existingWorkspace = await prisma.workspace.findUnique({
      where: {
        slug
      },
      select: {
        id: true
      }
    });

    if (!existingWorkspace) {
      return slug;
    }
  }

  throw new Error("Unable to create a unique workspace slug.");
}
