import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { activateFreeTrialAfterVerification } from "@/lib/billing-management";
import { saveBillingProfile } from "@/lib/billing-management";
import { createSession } from "@/lib/auth/session";
import { createEmailVerification } from "@/lib/auth/verification";
import {
  getBillingDetailsErrorMessage,
  normalizeBillingDetails,
  type BillingDetails,
  validateBillingDetails
} from "@/lib/billing-details";
import {
  getPackageBillingSnapshot,
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
  billingDetails: BillingDetails;
  remember: boolean;
  freeTrial?: boolean;
}) {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  const workspaceName = input.workspaceName.trim();
  const password = input.password;
  const plan = input.freeTrial ? "starter" : normalizeWorkspacePlan(input.plan);
  const billingDetails = normalizeBillingDetails(input.billingDetails);

  if (!name || !email || !workspaceName || !password) {
    throw new Error("Name, email, workspace name, and password are required.");
  }
  const billingValidationError = getBillingDetailsErrorMessage(validateBillingDetails(billingDetails));
  if (billingValidationError) {
    throw new Error(billingValidationError);
  }

  if (password.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }

  const existingAccount = await findAccountByEmail(email);

  if (existingAccount && !verifyPassword(password, existingAccount.passwordHash)) {
    throw new Error("This email already belongs to an existing account. Use the same password to add another workspace.");
  }

  const workspaceSlug = await generateWorkspaceSlug(workspaceName);
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
      trialEndsAt: null,
      packageCode: packageSnapshot.code,
      packageName: packageSnapshot.name,
      packageDescription: packageSnapshot.description,
      packagePriceAmount: packageSnapshot.priceAmount,
      packageCurrency: packageSnapshot.currency,
      packageBillingPeriod: packageSnapshot.billingPeriod,
      subscriptionStatus: input.freeTrial ? "PENDING" : "ACTIVE",
      agentName: name,
      agentEmail: email,
      passwordHash,
    role: AgentRole.MANAGER,
    status: AgentStatus.ACTIVE
  });
  const agent = result.agent;

  await saveBillingProfile({
    workspaceId: agent.workspaceId,
    billingName: billingDetails.billingName,
    billingEmail: email,
    billingPhoneNumber: billingDetails.billingPhoneNumber,
    billingAddressLine1: billingDetails.billingAddressLine1,
    billingAddressLine2: billingDetails.billingAddressLine2,
    billingCity: billingDetails.billingCity,
    billingState: billingDetails.billingState,
    billingPostcode: billingDetails.billingPostcode,
    billingCountry: billingDetails.billingCountry,
    billingTaxId: billingDetails.billingTaxId
  });

  await createSession({
    agentId: agent.id,
    workspaceId: agent.workspaceId,
    remember: input.remember
  });

  if (input.freeTrial && existingAccount?.emailVerifiedAt) {
    await activateFreeTrialAfterVerification(agent.id);
  } else if (!existingAccount?.emailVerifiedAt) {
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
