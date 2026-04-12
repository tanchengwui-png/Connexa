import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";

export async function loginWithPassword(input: {
  email: string;
  password: string;
  remember: boolean;
}) {
  const email = input.email.trim().toLowerCase();
  const password = input.password;

  if (!email || !password) {
    throw new Error("Email and password are required.");
  }

  const agent = await prisma.agent.findFirst({
    where: {
      email
    }
  });

  if (!agent?.passwordHash || !verifyPassword(password, agent.passwordHash)) {
    throw new Error("Invalid email or password.");
  }

  if (!agent.emailVerifiedAt) {
    throw new Error("Please verify your email before signing in.");
  }

  await prisma.agent.update({
    where: {
      id: agent.id
    },
    data: {
      lastLoginAt: new Date()
    }
  });

  await createSession({
    agentId: agent.id,
    workspaceId: agent.workspaceId,
    remember: input.remember
  });

  return agent;
}
