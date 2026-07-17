import { normalizeWorkspacePackageKey } from "@/lib/billing";
import { countVisibleContacts } from "@/lib/db-contacts";
import { OutboundMessageJobStatus } from "@/lib/db-types";
import { findWorkspaceById } from "@/lib/db-auth";
import { getPlatformPackageSettings } from "@/lib/platform-packages";
import { prisma } from "@/lib/prisma";
import { getPublicPackageDefinition } from "@/lib/public-packages";
import { getWorkspacePlanSettings } from "@/lib/workspace-plan";

export async function getWorkspacePackageFeatureLimits(workspaceId: string) {
  const workspace = await findWorkspaceById(workspaceId);

  if (!workspace) {
    throw new Error("Workspace not found.");
  }

  const packageKey = normalizeWorkspacePackageKey(workspace.plan);
  const packageDefinition = getPublicPackageDefinition(packageKey);
  const packageSettings = await getPlatformPackageSettings();
  const packageConfig = packageSettings.find((item) => item.packageKey === packageKey);

  return {
    packageKey,
    packageLabel: packageDefinition.name,
    mediaLibraryStorageLimitBytes:
      packageConfig?.mediaLibraryStorageLimitBytes ?? packageDefinition.limits.mediaLibraryStorageLimitBytes,
    maxOutboundMessages: packageConfig?.maxOutboundMessages ?? packageDefinition.limits.maxOutboundMessages,
    maxActiveContacts: packageConfig?.maxActiveContacts ?? packageDefinition.limits.maxActiveContacts,
    maxActiveAutomations: packageConfig?.maxActiveAutomations ?? packageDefinition.limits.maxActiveAutomations,
    maxWhatsAppCampaigns: packageConfig?.maxWhatsAppCampaigns ?? packageDefinition.limits.maxWhatsAppCampaigns
  };
}

export async function assertWorkspaceHasActiveContactCapacity(workspaceId: string, requestedCount = 1) {
  const [limits, currentActiveContacts] = await Promise.all([
    getWorkspacePackageFeatureLimits(workspaceId),
    countVisibleContacts({ workspaceId })
  ]);

  if (
    limits.maxActiveContacts !== null &&
    currentActiveContacts + requestedCount > limits.maxActiveContacts
  ) {
    throw new Error(
      `${limits.packageLabel} package allows up to ${limits.maxActiveContacts} active contacts. Remove unused contacts or upgrade the package before adding more.`
    );
  }

  return {
    ...limits,
    currentActiveContacts,
    remainingActiveContacts:
      limits.maxActiveContacts === null
        ? null
        : Math.max(limits.maxActiveContacts - currentActiveContacts, 0)
  };
}

export async function assertWorkspaceHasOutboundMessageCapacity(workspaceId: string, requestedCount = 1) {
  const [limits, currentOutboundMessages] = await Promise.all([
    getWorkspacePackageFeatureLimits(workspaceId),
    prisma.message.count({
      where: {
        conversation: {
          workspaceId
        },
        outboundJob: {
          is: {
            status: OutboundMessageJobStatus.SENT
          }
        }
      }
    })
  ]);

  if (
    limits.maxOutboundMessages !== null &&
    currentOutboundMessages + requestedCount > limits.maxOutboundMessages
  ) {
    throw new Error(
      `${limits.packageLabel} package allows up to ${limits.maxOutboundMessages} outbound messages. This action would exceed the current package limit.`
    );
  }

  return {
    ...limits,
    currentOutboundMessages,
    remainingOutboundMessages:
      limits.maxOutboundMessages === null
        ? null
        : Math.max(limits.maxOutboundMessages - currentOutboundMessages, 0)
  };
}

export async function assertWorkspaceHasActiveAutomationCapacity(workspaceId: string, requestedCount = 1) {
  const [limits, currentActiveAutomations] = await Promise.all([
    getWorkspacePackageFeatureLimits(workspaceId),
    prisma.automationRule.count({
      where: {
        workspaceId,
        enabled: true
      }
    })
  ]);

  if (
    limits.maxActiveAutomations !== null &&
    currentActiveAutomations + requestedCount > limits.maxActiveAutomations
  ) {
    throw new Error(
      `${limits.packageLabel} package allows up to ${limits.maxActiveAutomations} active automations. Disable an existing automation or upgrade the package before enabling more.`
    );
  }

  return {
    ...limits,
    currentActiveAutomations,
    remainingActiveAutomations:
      limits.maxActiveAutomations === null
        ? null
        : Math.max(limits.maxActiveAutomations - currentActiveAutomations, 0)
  };
}

export async function assertWorkspaceHasWhatsAppCampaignCapacity(workspaceId: string, requestedCount = 1) {
  const [limits, currentWhatsAppCampaigns] = await Promise.all([
    getWorkspacePackageFeatureLimits(workspaceId),
    prisma.campaignRun.count({
      where: {
        workspaceId
      }
    })
  ]);

  if (
    limits.maxWhatsAppCampaigns !== null &&
    currentWhatsAppCampaigns + requestedCount > limits.maxWhatsAppCampaigns
  ) {
    throw new Error(
      `${limits.packageLabel} package allows up to ${limits.maxWhatsAppCampaigns} WhatsApp campaigns. Upgrade the package before launching more campaigns.`
    );
  }

  return {
    ...limits,
    currentWhatsAppCampaigns,
    remainingWhatsAppCampaigns:
      limits.maxWhatsAppCampaigns === null
        ? null
        : Math.max(limits.maxWhatsAppCampaigns - currentWhatsAppCampaigns, 0)
  };
}

export async function getWorkspacePackageUsageOverview(workspaceId: string) {
  const [limits, currentActiveContacts, currentOutboundMessages, currentActiveAutomations, currentWhatsAppCampaigns] =
    await Promise.all([
      getWorkspacePackageFeatureLimits(workspaceId),
      countVisibleContacts({ workspaceId }),
      prisma.message.count({
        where: {
          conversation: {
            workspaceId
          },
          outboundJob: {
            is: {
              status: OutboundMessageJobStatus.SENT
            }
          }
        }
      }),
      prisma.automationRule.count({
        where: {
          workspaceId,
          enabled: true
        }
      }),
      prisma.campaignRun.count({
        where: {
          workspaceId
        }
      })
    ]);

  return {
    ...limits,
    currentActiveContacts,
    currentOutboundMessages,
    currentActiveAutomations,
    currentWhatsAppCampaigns,
    remainingActiveContacts:
      limits.maxActiveContacts === null ? null : Math.max(limits.maxActiveContacts - currentActiveContacts, 0),
    remainingOutboundMessages:
      limits.maxOutboundMessages === null ? null : Math.max(limits.maxOutboundMessages - currentOutboundMessages, 0),
    remainingActiveAutomations:
      limits.maxActiveAutomations === null
        ? null
        : Math.max(limits.maxActiveAutomations - currentActiveAutomations, 0),
    remainingWhatsAppCampaigns:
      limits.maxWhatsAppCampaigns === null
        ? null
        : Math.max(limits.maxWhatsAppCampaigns - currentWhatsAppCampaigns, 0)
  };
}

export async function assertWorkspaceHasWhatsAppNumberCapacity(workspaceId: string, requestedCount = 1) {
  const workspace = await findWorkspaceById(workspaceId);

  if (!workspace) {
    throw new Error("Workspace not found.");
  }

  const planSettings = getWorkspacePlanSettings(workspace.plan);
  const currentChannels = await prisma.whatsAppChannel.count({
    where: {
      workspaceId
    }
  });

  if (
    planSettings.numberLimit !== null &&
    currentChannels + requestedCount > planSettings.numberLimit
  ) {
    throw new Error(
      `${planSettings.label} plan allows up to ${planSettings.numberLimit} WhatsApp number${
        planSettings.numberLimit === 1 ? "" : "s"
      }. Upgrade the workspace plan before adding more numbers.`
    );
  }

  return {
    planLabel: planSettings.label,
    currentChannels,
    numberLimit: planSettings.numberLimit,
    remainingNumberSlots:
      planSettings.numberLimit === null ? null : Math.max(planSettings.numberLimit - currentChannels, 0)
  };
}
