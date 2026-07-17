import { activateFreeTrialAfterVerification, getCurrentSubscriptionOverview } from "@/lib/billing-management";
import { getWorkspaceWhatsAppHealth } from "@/lib/whatsapp-health";

type EntryPathAgent = {
  id: string;
  workspaceId: string;
  emailVerifiedAt: Date | null;
  role: string;
};

export async function getAgentEntryPath(agent: EntryPathAgent) {
  if (!agent.emailVerifiedAt) {
    return "/verify-email";
  }

  await activateFreeTrialAfterVerification(agent.id);
  const subscription = await getCurrentSubscriptionOverview(agent.workspaceId);
  if (subscription?.isExpired) {
    return "/account-settings/billing?expired=1";
  }

  if (agent.role === "MANAGER") {
    const whatsAppHealth = await getWorkspaceWhatsAppHealth({
      workspaceId: agent.workspaceId,
      agentId: agent.id
    });

    if (!whatsAppHealth.isInboxReady) {
      return "/onboarding";
    }
  }

  return "/inbox";
}
