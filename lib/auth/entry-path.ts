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
