import { applyHumanTakeoverPause } from "@/lib/automation-engine";
import { MALAYSIA_TIME_ZONE, parseMalaysiaDateTimeLocalInput } from "@/lib/malaysia-time";
import { resolveMediaAssetUrl } from "@/lib/media-library-urls";
import { CampaignRunRecipientStatus, ConversationStatus, OutboundMessageJobStatus } from "@/lib/db-types";
import { enqueueOutboundMessage } from "@/lib/outbound-message-jobs";
import { assertWorkspaceHasWhatsAppCampaignCapacity } from "@/lib/package-feature-limits";
import { prisma } from "@/lib/prisma";
import { getAllVisibleContactsData } from "@/lib/contacts";
import { getQuickRepliesData } from "@/lib/quick-replies";
import { requireCurrentApiAgent, requireCurrentWorkspaceId } from "@/lib/auth/current-user";
import { resolveWorkspaceDefaultChannelId } from "@/lib/whatsapp-channel-routing";

type CampaignTemplateInput = {
  name: string;
  languageCode?: string | null;
  components?: unknown[] | null;
  variables?: unknown[] | null;
  bodyVariables?: unknown[] | null;
  headerVariables?: unknown[] | null;
};

export type CampaignDraftRecord = {
  id: string;
  name: string;
  messageBody: string;
  scheduleAt: string;
  selectedContactIds: string[];
  selectedAttachmentIds: string[];
  updatedAt: string;
  createdAt: string;
  createdByName: string | null;
};

export type CampaignRunRecord = {
  id: string;
  name: string;
  messageBody: string;
  scheduleAt: string;
  selectedAttachmentIds: string[];
  recipientCount: number;
  queuedJobCount: number;
  excludedCount: number;
  pendingJobCount: number;
  processingJobCount: number;
  sentJobCount: number;
  failedJobCount: number;
  canceledJobCount: number;
  createdAt: string;
  createdByName: string | null;
};

export async function getCampaignEditorData() {
  const [workspaceId, { contacts, agents }, { quickReplies, mediaAssets }] = await Promise.all([
    requireCurrentWorkspaceId(),
    getAllVisibleContactsData(),
    getQuickRepliesData()
  ]);

  const [drafts, runs] = await Promise.all([listCampaignDrafts(workspaceId), listCampaignRuns(workspaceId)]);

  return {
    contacts: contacts.map((contact) => ({
      id: contact.id,
      displayName: contact.displayName,
      phone: contact.phone,
      photoUrl: contact.photoUrl,
      ownerId: contact.ownerId,
      ownerName: contact.ownerName,
      tags: contact.tags,
      isHotLead: contact.isHotLead,
      lastInteractionAt: contact.lastInteractionAt,
      lastMessagePreview: contact.lastMessagePreview
    })),
    agents,
    quickReplies,
    mediaAssets,
    drafts,
    runs
  };
}

export async function getCampaignsData() {
  return getCampaignEditorData();
}

export async function getCampaignDraftListData() {
  const workspaceId = await requireCurrentWorkspaceId();
  const [drafts, runs] = await Promise.all([listCampaignDrafts(workspaceId), listCampaignRuns(workspaceId)]);

  return {
    drafts,
    runs
  };
}

export async function getCampaignDraftById(id: string, workspaceId?: string) {
  const resolvedWorkspaceId = workspaceId ?? (await requireCurrentWorkspaceId());
  const draft = await prisma.campaignDraft.findFirst({
    where: {
      id,
      workspaceId: resolvedWorkspaceId
    },
    include: {
      createdBy: {
        select: {
          name: true
        }
      }
    }
  });

  return draft ? mapCampaignDraftRecord(draft) : null;
}

export async function listCampaignDrafts(workspaceId?: string) {
  const resolvedWorkspaceId = workspaceId ?? (await requireCurrentWorkspaceId());
  const drafts = await prisma.campaignDraft.findMany({
    where: {
      workspaceId: resolvedWorkspaceId
    },
    include: {
      createdBy: {
        select: {
          name: true
        }
      }
    },
    orderBy: {
      updatedAt: "desc"
    }
  });

  return drafts.map(mapCampaignDraftRecord);
}

export async function createCampaignDraft(input: {
  name: string;
  messageBody: string;
  scheduleAt?: string | null;
  selectedContactIds?: string[];
  selectedAttachmentIds?: string[];
}) {
  const agent = await requireCurrentApiAgent();
  const normalized = await normalizeCampaignDraftInput(agent.workspaceId, input);

  const draft = await prisma.campaignDraft.create({
    data: {
      workspaceId: agent.workspaceId,
      createdById: agent.id,
      name: normalized.name,
      messageBody: normalized.messageBody,
      scheduleAt: normalized.scheduleAt,
      selectedContactIdsJson: serializeStringArray(normalized.selectedContactIds),
      selectedAttachmentIdsJson: serializeStringArray(normalized.selectedAttachmentIds)
    },
    include: {
      createdBy: {
        select: {
          name: true
        }
      }
    }
  });

  return mapCampaignDraftRecord(draft);
}

export async function updateCampaignDraft(
  id: string,
  input: {
    name?: string;
    messageBody?: string;
    scheduleAt?: string | null;
    selectedContactIds?: string[];
    selectedAttachmentIds?: string[];
  }
) {
  const agent = await requireCurrentApiAgent();
  const existing = await prisma.campaignDraft.findFirst({
    where: {
      id,
      workspaceId: agent.workspaceId
    }
  });

  if (!existing) {
    throw new Error("Campaign draft not found.");
  }

  const normalized = await normalizeCampaignDraftInput(agent.workspaceId, {
    name: input.name ?? existing.name,
    messageBody: input.messageBody ?? existing.messageBody,
    scheduleAt:
      input.scheduleAt === undefined
        ? existing.scheduleAt?.toISOString() ?? null
        : input.scheduleAt,
    selectedContactIds:
      input.selectedContactIds ?? parseStringArray(existing.selectedContactIdsJson),
    selectedAttachmentIds:
      input.selectedAttachmentIds ?? parseStringArray(existing.selectedAttachmentIdsJson)
  });

  const draft = await prisma.campaignDraft.update({
    where: {
      id: existing.id
    },
    data: {
      name: normalized.name,
      messageBody: normalized.messageBody,
      scheduleAt: normalized.scheduleAt,
      selectedContactIdsJson: serializeStringArray(normalized.selectedContactIds),
      selectedAttachmentIdsJson: serializeStringArray(normalized.selectedAttachmentIds)
    },
    include: {
      createdBy: {
        select: {
          name: true
        }
      }
    }
  });

  return mapCampaignDraftRecord(draft);
}

export async function deleteCampaignDraft(id: string) {
  const agent = await requireCurrentApiAgent();
  const existing = await prisma.campaignDraft.findFirst({
    where: {
      id,
      workspaceId: agent.workspaceId
    },
    select: {
      id: true
    }
  });

  if (!existing) {
    throw new Error("Campaign draft not found.");
  }

  await prisma.campaignDraft.delete({
    where: {
      id: existing.id
    }
  });
}

export async function listCampaignRuns(workspaceId?: string) {
  const resolvedWorkspaceId = workspaceId ?? (await requireCurrentWorkspaceId());
  const runs = await prisma.campaignRun.findMany({
    where: {
      workspaceId: resolvedWorkspaceId
    },
    include: {
      createdBy: {
        select: {
          name: true
        }
      },
      outboundMessageJobs: {
        select: {
          status: true,
          availableAt: true
        }
      }
    },
    orderBy: {
      createdAt: "desc"
    },
    take: 12
  });

  return runs.map(mapCampaignRunRecord);
}

export async function getCampaignRunDetail(runId: string) {
  const workspaceId = await requireCurrentWorkspaceId();
  const run = await prisma.campaignRun.findFirst({
    where: {
      id: runId,
      workspaceId
    },
    include: {
      createdBy: {
        select: {
          name: true
        }
      },
      recipients: {
        include: {
          contact: {
            select: {
              id: true,
              displayName: true,
              phone: true,
              owner: {
                select: {
                  id: true,
                  name: true
                }
              }
            }
          },
          outboundMessageJobs: {
            select: {
              id: true,
              status: true,
              availableAt: true,
              lastError: true,
              attachmentName: true,
              body: true
            },
            orderBy: [{ availableAt: "asc" }, { createdAt: "asc" }]
          }
        },
        orderBy: {
          createdAt: "asc"
        }
      },
      outboundMessageJobs: {
        select: {
          status: true,
          availableAt: true
        }
      }
    }
  });

  if (!run) {
    return null;
  }

  return {
    ...mapCampaignRunRecord(run),
    recipients: run.recipients.map((recipient: (typeof run.recipients)[number]) => {
      let scheduledJobCount = 0;
      let processingJobCount = 0;
      let sentJobCount = 0;
      let failedJobCount = 0;
      let canceledJobCount = 0;

      for (const job of recipient.outboundMessageJobs) {
        if (job.status === OutboundMessageJobStatus.SENT) {
          sentJobCount += 1;
          continue;
        }

        if (job.status === OutboundMessageJobStatus.FAILED) {
          failedJobCount += 1;
          continue;
        }

        if (job.status === OutboundMessageJobStatus.CANCELED) {
          canceledJobCount += 1;
          continue;
        }

        if (job.status === OutboundMessageJobStatus.RUNNING) {
          processingJobCount += 1;
          continue;
        }

        if (job.availableAt.getTime() <= Date.now()) {
          processingJobCount += 1;
        } else {
          scheduledJobCount += 1;
        }
      }

      return {
        id: recipient.id,
        status: recipient.status,
        reason: recipient.reason,
        queuedJobCount: recipient.queuedJobCount,
        conversationId: recipient.conversationId,
        contact: {
          id: recipient.contact.id,
          displayName: recipient.contact.displayName,
          phone: recipient.contact.phone,
          ownerName: recipient.contact.owner?.name ?? "Unassigned"
        },
        scheduledJobCount,
        processingJobCount,
        sentJobCount,
        failedJobCount,
        canceledJobCount,
        jobs: recipient.outboundMessageJobs.map((job: (typeof recipient.outboundMessageJobs)[number]) => ({
          id: job.id,
          status: job.status,
          availableAt: job.availableAt.toISOString(),
          lastError: job.lastError,
          preview: buildBodyPreview(job.body, job.attachmentName)
        }))
      };
    })
  };
}

export async function launchCampaign(input: {
  name: string;
  messageBody: string;
  channelId?: string | null;
  scheduleAt?: string | null;
  selectedContactIds?: string[];
  selectedAttachmentIds?: string[];
  template?: CampaignTemplateInput | null;
}) {
  const agent = await requireCurrentApiAgent();
  const normalized = await normalizeCampaignDraftInput(agent.workspaceId, input);
  const channelId = input.channelId ?? (await resolveWorkspaceDefaultChannelId(agent.workspaceId));
  const channelKind = await resolveCampaignChannelKind(channelId);

  await assertWorkspaceHasWhatsAppCampaignCapacity(agent.workspaceId);

  if (!normalized.selectedContactIds.length) {
    throw new Error("Choose at least one contact before launching a campaign.");
  }

  const contacts = await prisma.contact.findMany({
    where: {
      workspaceId: agent.workspaceId,
      id: {
        in: normalized.selectedContactIds
      }
    },
    select: {
      id: true,
      phone: true,
      displayName: true,
      isHotLead: true
    }
  });

  if (!contacts.length) {
    throw new Error("No selected contacts were found.");
  }

  const contactsById = new Map(contacts.map((contact: (typeof contacts)[number]) => [contact.id, contact] as const));
  const selectedMediaAssets = normalized.selectedAttachmentIds.length
    ? await prisma.workspaceMediaAsset.findMany({
        where: {
          workspaceId: agent.workspaceId,
          id: {
            in: normalized.selectedAttachmentIds
          }
        }
      })
    : [];
  const mediaAssetsById = new Map(
    selectedMediaAssets.map((asset: (typeof selectedMediaAssets)[number]) => [asset.id, asset] as const)
  );

  const orderedContacts = normalized.selectedContactIds
    .map((contactId) => contactsById.get(contactId) ?? null)
    .filter(Boolean) as typeof contacts;
  const orderedMediaAssets = normalized.selectedAttachmentIds
    .map((assetId) => mediaAssetsById.get(assetId) ?? null)
    .filter(Boolean) as typeof selectedMediaAssets;

  if (normalized.template && channelKind !== "cloud") {
    throw new Error("Template broadcasts require a WhatsApp Cloud channel.");
  }

  if (normalized.template && orderedMediaAssets.length > 0) {
    throw new Error("Template campaigns do not support attachments in the same broadcast yet.");
  }

  const existingConversations = await prisma.conversation.findMany({
    where: {
      workspaceId: agent.workspaceId,
      ...(channelId ? { channelId } : {}),
      contactId: {
        in: orderedContacts.map((contact: (typeof orderedContacts)[number]) => contact.id)
      }
    },
    orderBy: [{ contactId: "asc" }, { updatedAt: "desc" }]
  });

  const conversationByContactId = new Map<string, (typeof existingConversations)[number]>();
  for (const conversation of existingConversations) {
    if (!conversationByContactId.has(conversation.contactId)) {
      conversationByContactId.set(conversation.contactId, conversation);
    }
  }

  const campaignRun = await prisma.campaignRun.create({
    data: {
      workspaceId: agent.workspaceId,
      channelId,
      createdById: agent.id,
      name: normalized.name,
      messageBody: normalized.messageBody,
      scheduleAt: normalized.scheduleAt,
      selectedAttachmentIdsJson: serializeStringArray(normalized.selectedAttachmentIds)
    }
  });

  let queuedCount = 0;
  let excludedCount = 0;
  let recipientCount = 0;
  let providerMessageIndex = 0;

  for (const contact of orderedContacts) {
    const phone = contact.phone.trim();
    if (!phone) {
      await prisma.campaignRunRecipient.create({
        data: {
          workspaceId: agent.workspaceId,
          campaignRunId: campaignRun.id,
          contactId: contact.id,
          status: CampaignRunRecipientStatus.EXCLUDED,
          reason: "Missing phone number",
          queuedJobCount: 0
        }
      });
      excludedCount += 1;
      continue;
    }

    recipientCount += 1;

    const conversation =
      conversationByContactId.get(contact.id) ??
      (await prisma.conversation.create({
        data: {
          workspaceId: agent.workspaceId,
          channelId,
          contactId: contact.id,
          status: ConversationStatus.OPEN,
          unreadCount: 0,
          isHotLead: contact.isHotLead,
          lastMessagePreview: buildCampaignPreviewText(normalized.messageBody, normalized.template, normalized.name),
          lastMessageAt: normalized.scheduleAt ?? new Date()
        }
      }));

    const campaignRecipient = await prisma.campaignRunRecipient.create({
      data: {
        workspaceId: agent.workspaceId,
        campaignRunId: campaignRun.id,
        contactId: contact.id,
        conversationId: conversation.id,
        status: CampaignRunRecipientStatus.QUEUED,
        reason: null,
        queuedJobCount: 0
      }
    });

    let lastQueuedAt: Date | null = null;
    let recipientQueuedJobCount = 0;
    if (normalized.template) {
      const templateMessage = await enqueueOutboundMessage({
        workspaceId: agent.workspaceId,
        conversationId: conversation.id,
        channelId,
        campaignRunId: campaignRun.id,
        campaignRunRecipientId: campaignRecipient.id,
        to: phone,
        body: normalized.messageBody,
        availableAt: computeCampaignMessageAvailableAt({
          baseAt: normalized.scheduleAt,
          providerKind: channelKind,
          messageIndex: providerMessageIndex
        }),
        senderId: agent.id,
        source: "manual-reply",
        mediaAssetId: null,
        attachmentMimeType: null,
        attachmentName: null,
        attachmentUrl: null,
        template: normalized.template
      });
      lastQueuedAt = templateMessage.sentAt;
      queuedCount += 1;
      recipientQueuedJobCount += 1;
      providerMessageIndex += 1;
    } else if (normalized.messageBody.trim()) {
      const textMessage = await enqueueOutboundMessage({
        workspaceId: agent.workspaceId,
        conversationId: conversation.id,
        channelId,
        campaignRunId: campaignRun.id,
        campaignRunRecipientId: campaignRecipient.id,
        to: phone,
        body: normalized.messageBody,
        availableAt: computeCampaignMessageAvailableAt({
          baseAt: normalized.scheduleAt,
          providerKind: channelKind,
          messageIndex: providerMessageIndex
        }),
        senderId: agent.id,
        source: "manual-reply",
        mediaAssetId: null,
        attachmentMimeType: null,
        attachmentName: null,
        attachmentUrl: null
      });
      lastQueuedAt = textMessage.sentAt;
      queuedCount += 1;
      recipientQueuedJobCount += 1;
      providerMessageIndex += 1;
    }

    for (const mediaAsset of orderedMediaAssets) {
      const mediaMessage = await enqueueOutboundMessage({
        workspaceId: agent.workspaceId,
        conversationId: conversation.id,
        channelId,
        campaignRunId: campaignRun.id,
        campaignRunRecipientId: campaignRecipient.id,
        to: phone,
        body: "",
        availableAt: computeCampaignMessageAvailableAt({
          baseAt: normalized.scheduleAt,
          providerKind: channelKind,
          messageIndex: providerMessageIndex
        }),
        senderId: agent.id,
        source: "manual-reply",
        mediaAssetId: mediaAsset.id,
        attachmentMimeType: mediaAsset.mimeType,
        attachmentName: mediaAsset.originalName || mediaAsset.title,
        attachmentUrl: resolveMediaAssetUrl(mediaAsset.publicUrl)
      });
      lastQueuedAt = mediaMessage.sentAt;
      queuedCount += 1;
      recipientQueuedJobCount += 1;
      providerMessageIndex += 1;
    }

    await prisma.campaignRunRecipient.update({
      where: {
        id: campaignRecipient.id
      },
      data: {
        queuedJobCount: recipientQueuedJobCount
      }
    });

    if (lastQueuedAt) {
      await applyHumanTakeoverPause({
        workspaceId: agent.workspaceId,
        conversationId: conversation.id,
        pausedAt: lastQueuedAt
      });
    }
  }

  if (!queuedCount) {
    throw new Error("No selected contacts have a usable phone number.");
  }

  await prisma.campaignRun.update({
    where: {
      id: campaignRun.id
    },
    data: {
      recipientCount,
      queuedJobCount: queuedCount,
      excludedCount
    }
  });

  const persistedRun = await prisma.campaignRun.findUnique({
    where: {
      id: campaignRun.id
    },
    include: {
      createdBy: {
        select: {
          name: true
        }
      },
      outboundMessageJobs: {
        select: {
          status: true,
          availableAt: true
        }
      }
    }
  });

  return {
    runId: campaignRun.id,
    queuedCount,
    recipientCount,
    excludedCount,
    scheduledFor: normalized.scheduleAt?.toISOString() ?? null,
    run: persistedRun ? mapCampaignRunRecord(persistedRun) : null
  };
}

async function normalizeCampaignDraftInput(
  workspaceId: string,
  input: {
    name: string;
    messageBody: string;
    scheduleAt?: string | null;
    selectedContactIds?: string[];
    selectedAttachmentIds?: string[];
    template?: CampaignTemplateInput | null;
  }
) {
  const name = input.name.trim();
  const messageBody = input.messageBody;
  const selectedContactIds = normalizeStringArray(input.selectedContactIds);
  const selectedAttachmentIds = normalizeStringArray(input.selectedAttachmentIds);
  const template = normalizeCampaignTemplate(input.template);

  if (!name) {
    throw new Error("Campaign name is required.");
  }

  if (!messageBody.trim() && selectedAttachmentIds.length === 0 && !template) {
    throw new Error("Campaign draft needs message text or at least one media item.");
  }

  const scheduleAt = normalizeScheduledAt(input.scheduleAt);

  if (selectedContactIds.length) {
    const contactCount = await prisma.contact.count({
      where: {
        workspaceId,
        id: {
          in: selectedContactIds
        }
      }
    });

    if (contactCount !== selectedContactIds.length) {
      throw new Error("One or more selected contacts were not found.");
    }
  }

  if (selectedAttachmentIds.length) {
    const mediaCount = await prisma.workspaceMediaAsset.count({
      where: {
        workspaceId,
        id: {
          in: selectedAttachmentIds
        }
      }
    });

    if (mediaCount !== selectedAttachmentIds.length) {
      throw new Error("One or more selected media assets were not found.");
    }
  }

  return {
    name,
    messageBody,
    scheduleAt,
    selectedContactIds,
    selectedAttachmentIds,
    template
  };
}

function normalizeCampaignTemplate(input: CampaignTemplateInput | null | undefined) {
  if (!input?.name?.trim()) {
    return null;
  }

  return {
    name: input.name.trim(),
    languageCode: input.languageCode?.trim() || "en_US",
    components: Array.isArray(input.components) ? input.components : [],
    variables: Array.isArray(input.variables) ? input.variables : [],
    bodyVariables: Array.isArray(input.bodyVariables) ? input.bodyVariables : [],
    headerVariables: Array.isArray(input.headerVariables) ? input.headerVariables : []
  };
}

function buildCampaignPreviewText(
  messageBody: string,
  template: CampaignTemplateInput | null,
  fallbackName: string
) {
  const normalizedBody = messageBody.trim();
  if (normalizedBody) {
    return normalizedBody;
  }

  if (template?.name?.trim()) {
    return `Template: ${template.name.trim()}`;
  }

  return fallbackName;
}

async function resolveCampaignChannelKind(channelId?: string | null) {
  if (!channelId) {
    return "personal" as const;
  }

  const channel = await prisma.whatsAppChannel.findUnique({
    where: {
      id: channelId
    },
    select: {
      phoneNumberId: true,
      accessTokenCiphertext: true
    }
  });

  if (channel?.phoneNumberId && channel.accessTokenCiphertext) {
    return "cloud" as const;
  }

  return "personal" as const;
}

function computeCampaignMessageAvailableAt(input: {
  baseAt: Date | null;
  providerKind: "personal" | "cloud";
  messageIndex: number;
}) {
  const batchSize = getCampaignProviderBatchSize(input.providerKind);
  const batchWindowMs = getCampaignProviderBatchWindowMs(input.providerKind);
  const batchIndex = Math.floor(Math.max(0, input.messageIndex) / batchSize);
  const baseAt = input.baseAt ?? new Date();

  return new Date(baseAt.getTime() + batchIndex * batchWindowMs);
}

function getCampaignProviderBatchSize(providerKind: "personal" | "cloud") {
  const fallback = providerKind === "cloud" ? 100 : 25;
  const configured = Number.parseInt(
    process.env[
      providerKind === "cloud"
        ? "WHATSAPP_CLOUD_BROADCAST_BATCH_SIZE"
        : "WHATSAPP_PERSONAL_BROADCAST_BATCH_SIZE"
    ] ?? `${fallback}`,
    10
  );

  return Number.isFinite(configured) && configured > 0 ? configured : fallback;
}

function getCampaignProviderBatchWindowMs(providerKind: "personal" | "cloud") {
  const fallback = providerKind === "cloud" ? 60_000 : 90_000;
  const configured = Number.parseInt(
    process.env[
      providerKind === "cloud"
        ? "WHATSAPP_CLOUD_BROADCAST_BATCH_WINDOW_MS"
        : "WHATSAPP_PERSONAL_BROADCAST_BATCH_WINDOW_MS"
    ] ?? `${fallback}`,
    10
  );

  return Number.isFinite(configured) && configured > 0 ? configured : fallback;
}

function mapCampaignDraftRecord(
  draft: {
    id: string;
    name: string;
    messageBody: string;
    scheduleAt: Date | null;
    selectedContactIdsJson: string | null;
    selectedAttachmentIdsJson: string | null;
    updatedAt: Date;
    createdAt: Date;
    createdBy?: { name: string } | null;
  }
): CampaignDraftRecord {
  return {
    id: draft.id,
    name: draft.name,
    messageBody: draft.messageBody,
    scheduleAt: draft.scheduleAt?.toISOString() ?? "",
    selectedContactIds: parseStringArray(draft.selectedContactIdsJson),
    selectedAttachmentIds: parseStringArray(draft.selectedAttachmentIdsJson),
    updatedAt: draft.updatedAt.toISOString(),
    createdAt: draft.createdAt.toISOString(),
    createdByName: draft.createdBy?.name ?? null
  };
}

function mapCampaignRunRecord(
  run: {
    id: string;
    name: string;
    messageBody: string;
    scheduleAt: Date | null;
    selectedAttachmentIdsJson: string | null;
    recipientCount: number;
    queuedJobCount: number;
    excludedCount: number;
    createdAt: Date;
    createdBy?: { name: string } | null;
    outboundMessageJobs: Array<{
      status: OutboundMessageJobStatus;
      availableAt: Date;
    }>;
  }
): CampaignRunRecord {
  const now = Date.now();
  let pendingJobCount = 0;
  let processingJobCount = 0;
  let sentJobCount = 0;
  let failedJobCount = 0;
  let canceledJobCount = 0;

  for (const job of run.outboundMessageJobs) {
    if (job.status === OutboundMessageJobStatus.SENT) {
      sentJobCount += 1;
      continue;
    }

    if (job.status === OutboundMessageJobStatus.FAILED) {
      failedJobCount += 1;
      continue;
    }

    if (job.status === OutboundMessageJobStatus.CANCELED) {
      canceledJobCount += 1;
      continue;
    }

    if (job.status === OutboundMessageJobStatus.RUNNING) {
      processingJobCount += 1;
      continue;
    }

    if (job.availableAt.getTime() <= now) {
      processingJobCount += 1;
    } else {
      pendingJobCount += 1;
    }
  }

  return {
    id: run.id,
    name: run.name,
    messageBody: run.messageBody,
    scheduleAt: run.scheduleAt?.toISOString() ?? "",
    selectedAttachmentIds: parseStringArray(run.selectedAttachmentIdsJson),
    recipientCount: run.recipientCount,
    queuedJobCount: run.queuedJobCount,
    excludedCount: run.excludedCount,
    pendingJobCount,
    processingJobCount,
    sentJobCount,
    failedJobCount,
    canceledJobCount,
    createdAt: run.createdAt.toISOString(),
    createdByName: run.createdBy?.name ?? null
  };
}

function normalizeScheduledAt(value?: string | null) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  const scheduledAt =
    parseMalaysiaDateTimeLocalInput(trimmed) ??
    new Date(trimmed);
  if (Number.isNaN(scheduledAt.getTime())) {
    throw new Error("Scheduled date is invalid.");
  }

  if (scheduledAt.getTime() <= Date.now()) {
    throw new Error("Scheduled send time must be in the future.");
  }

  return scheduledAt;
}

function normalizeStringArray(value?: string[]) {
  return Array.from(new Set((value ?? []).map((item) => item.trim()).filter(Boolean)));
}

function parseStringArray(value: string | null) {
  if (!value) {
    return [] as string[];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function serializeStringArray(value: string[]) {
  return value.length ? JSON.stringify(value) : null;
}

function buildBodyPreview(body: string, attachmentName: string | null) {
  const normalized = body.trim();
  if (normalized) {
    return normalized;
  }

  if (attachmentName?.trim()) {
    return `Attachment: ${attachmentName.trim()}`;
  }

  return "Queued outbound message";
}

function formatMalaysiaDateTime(value: Date) {
  return new Intl.DateTimeFormat("en-MY", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: MALAYSIA_TIME_ZONE
  }).format(value);
}
