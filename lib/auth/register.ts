import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { createEmailVerification } from "@/lib/auth/verification";
import {
  getPackageBillingSnapshot,
  getSubscriptionStatusForNewWorkspace,
  normalizeWorkspacePackageKey
} from "@/lib/billing";
import { AgentRole, AgentStatus } from "@/lib/db-types";
import { createAccountRecord, createWorkspaceAndManager, findAccountByEmail, findWorkspaceBySlug } from "@/lib/db-auth";
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

  const existingAccount = await findAccountByEmail(email);

  if (existingAccount && !verifyPassword(password, existingAccount.passwordHash)) {
    throw new Error("This email already belongs to an existing account. Use the same password to add another workspace.");
  }

  const workspaceSlug = await generateWorkspaceSlug(workspaceName);
  const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  const packageSnapshot = await getPackageBillingSnapshot(normalizeWorkspacePackageKey(plan));
  const passwordHash = existingAccount?.passwordHash ?? hashPassword(password);
  const account =
    existingAccount ??
    (await createAccountRecord({
      email,
      passwordHash
    }));

  const result = await createWorkspaceAndManager({
      accountId: account?.id ?? null,
      workspaceName,
      slug: workspaceSlug,
      plan,
      trialEndsAt,
      packageCode: packageSnapshot.code,
      packageName: packageSnapshot.name,
      packageDescription: packageSnapshot.description,
      packagePriceAmount: packageSnapshot.priceAmount,
      packageCurrency: packageSnapshot.currency,
      packageBillingPeriod: packageSnapshot.billingPeriod,
      subscriptionStatus: getSubscriptionStatusForNewWorkspace(true),
      agentName: name,
      agentEmail: email,
      passwordHash,
    role: AgentRole.MANAGER,
    status: AgentStatus.ACTIVE
  });
  const agent = result.agent;

  await createSession({
    agentId: agent.id,
    workspaceId: agent.workspaceId,
    remember: input.remember
  });

  if (!existingAccount?.emailVerifiedAt) {
    await createEmailVerification(agent.id);
  }

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
    const existingWorkspace = await findWorkspaceBySlug(slug);

    if (!existingWorkspace) {
      return slug;
    }
  }

  throw new Error("Unable to create a unique workspace slug.");
}
