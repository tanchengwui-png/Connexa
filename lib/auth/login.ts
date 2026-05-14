import { createSession } from "@/lib/auth/session";
import { createLoginChallenge, verifyLoginChallenge } from "@/lib/auth/login-challenge";
import { verifyPassword } from "@/lib/auth/password";
import { attachAgentToAccount, findAccountByEmail, findAgentsByEmail, touchAccountLastLogin, touchAgentLastLogin } from "@/lib/db-auth";

type LoginWorkspaceOption = {
  agentId: string;
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
  role: string;
};

type DirectLoginResult = {
  type: "authenticated";
  agent: {
    id: string;
    workspaceId: string;
    emailVerifiedAt: Date | null;
    role: string;
  };
};

type WorkspaceSelectionResult = {
  type: "workspace_selection_required";
  challengeToken: string;
  options: LoginWorkspaceOption[];
};

export type LoginWithPasswordResult = DirectLoginResult | WorkspaceSelectionResult;

export async function loginWithPassword(input: {
  email: string;
  password: string;
  remember: boolean;
}): Promise<LoginWithPasswordResult> {
  const email = input.email.trim().toLowerCase();
  const password = input.password;

  if (!email || !password) {
    throw new Error("Email and password are required.");
  }

  const agents = await findAgentsByEmail(email);
  const matchingAgents = agents.filter(
    (agent) => agent.effectivePasswordHash && verifyPassword(password, agent.effectivePasswordHash)
  );

  if (!matchingAgents.length) {
    throw new Error("Invalid email or password.");
  }

  if (matchingAgents.length > 1) {
    const options = matchingAgents.map((agent) => ({
      agentId: agent.id,
      workspaceId: agent.workspaceId,
      workspaceName: agent.workspaceName,
      workspaceSlug: agent.workspaceSlug,
      role: agent.role
    }));

    return {
      type: "workspace_selection_required",
      challengeToken: createLoginChallenge({
        email,
        remember: input.remember,
        candidates: options
      }),
      options
    };
  }

  const [agent] = matchingAgents;

  if (!agent.effectiveEmailVerifiedAt) {
    throw new Error("Please verify your email before signing in.");
  }

  await touchAgentLastLogin(agent.id);
  if (agent.accountId) {
    await touchAccountLastLogin(agent.accountId);
  } else {
    const account = await findAccountByEmail(agent.email);
    if (account) {
      await attachAgentToAccount(agent.id, account.id);
      await touchAccountLastLogin(account.id);
    }
  }

  await createSession({
    agentId: agent.id,
    workspaceId: agent.workspaceId,
    remember: input.remember
  });

  return {
    type: "authenticated",
    agent: {
      id: agent.id,
      workspaceId: agent.workspaceId,
      emailVerifiedAt: agent.effectiveEmailVerifiedAt,
      role: agent.role
    }
  };
}

export async function loginWithWorkspaceSelection(input: {
  challengeToken: string;
  agentId: string;
}) {
  const challenge = await verifyLoginChallenge(input.challengeToken);
  const selectedAgent = challenge.candidates.find((candidate) => candidate.agentId === input.agentId);

  if (!selectedAgent) {
    throw new Error("Selected workspace is not available for this login attempt.");
  }

  const agents = await findAgentsByEmail(challenge.email);
  const agent = agents.find((candidate) => candidate.id === selectedAgent.agentId);

  if (!agent?.effectivePasswordHash) {
    throw new Error("This workspace login is no longer available. Sign in again.");
  }

  if (!agent.effectiveEmailVerifiedAt) {
    throw new Error("Please verify your email before signing in.");
  }

  await touchAgentLastLogin(agent.id);
  if (agent.accountId) {
    await touchAccountLastLogin(agent.accountId);
  } else {
    const account = await findAccountByEmail(agent.email);
    if (account) {
      await attachAgentToAccount(agent.id, account.id);
      await touchAccountLastLogin(account.id);
    }
  }

  await createSession({
    agentId: agent.id,
    workspaceId: agent.workspaceId,
    remember: challenge.remember
  });

  return {
    id: agent.id,
    workspaceId: agent.workspaceId,
    emailVerifiedAt: agent.effectiveEmailVerifiedAt,
    role: agent.role
  };
}
