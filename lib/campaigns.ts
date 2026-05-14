import { CampaignRunRecipientStatus, ConversationStatus, OutboundMessageJobStatus } from "@prisma/client";
import { applyHumanTakeoverPause } from "@/lib/automation-engine";
import { MALAYSIA_TIME_ZONE, parseMalaysiaDateTimeLocalInput } from "@/lib/malaysia-time";
import { resolveMediaAssetUrl } from "@/lib/media-library-urls";
import { enqueueOutboundMessage } from "@/lib/outbound-message-jobs";
import { assertWorkspaceHasWhatsAppCampaignCapacity } from "@/lib/package-feature-limits";
import { prisma } from "@/lib/prisma";
import { getAllVisibleContactsData } from "@/lib/contacts";
import { getQuickRepliesData } from "@/lib/quick-replies";
import { requireCurrentApiAgent, requireCurrentWorkspaceId } from "@/lib/auth/current-user";

type CampaignDraftRecord = {
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

type CampaignRunRecord = {
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

export async function getCampaignsData() {
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
    recipients: run.recipients.map((recipient) => {
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
        jobs: recipient.outboundMessageJobs.map((job) => ({
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
  scheduleAt?: string | null;
  selectedContactIds?: string[];
  selectedAttachmentIds?: string[];
}) {
  const agent = await requireCurrentApiAgent();
  const normalized = await normalizeCampaignDraftInput(agent.workspaceId, input);

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

  const contactsById = new Map(contacts.map((contact) => [contact.id, contact] as const));
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
  const mediaAssetsById = new Map(selectedMediaAssets.map((asset) => [asset.id, asset] as const));

  const orderedContacts = normalized.selectedContactIds
    .map((contactId) => contactsById.get(contactId) ?? null)
    .filter(Boolean) as typeof contacts;
  const orderedMediaAssets = normalized.selectedAttachmentIds
    .map((assetId) => mediaAssetsById.get(assetId) ?? null)
    .filter(Boolean) as typeof selectedMediaAssets;

  const existingConversations = await prisma.conversation.findMany({
    where: {
      workspaceId: agent.workspaceId,
      contactId: {
        in: orderedContacts.map((contact) => contact.id)
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
          contactId: contact.id,
          status: ConversationStatus.OPEN,
          unreadCount: 0,
          isHotLead: contact.isHotLead,
          lastMessagePreview: normalized.messageBody.trim() || normalized.name,
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

    if (normalized.messageBody.trim()) {
      const textMessage = await enqueueOutboundMessage({
        workspaceId: agent.workspaceId,
        conversationId: conversation.id,
        campaignRunId: campaignRun.id,
        campaignRunRecipientId: campaignRecipient.id,
        to: phone,
        body: normalized.messageBody,
        availableAt: normalized.scheduleAt,
        senderId: agent.id,
        source: "manual-reply",
        attachmentMimeType: null,
        attachmentName: null,
        attachmentUrl: null
      });
      lastQueuedAt = textMessage.sentAt;
      queuedCount += 1;
      recipientQueuedJobCount += 1;
    }

    for (const mediaAsset of orderedMediaAssets) {
      const mediaMessage = await enqueueOutboundMessage({
        workspaceId: agent.workspaceId,
        conversationId: conversation.id,
        campaignRunId: campaignRun.id,
        campaignRunRecipientId: campaignRecipient.id,
        to: phone,
        body: "",
        availableAt: normalized.scheduleAt,
        senderId: agent.id,
        source: "manual-reply",
        attachmentMimeType: mediaAsset.mimeType,
        attachmentName: mediaAsset.originalName || mediaAsset.title,
        attachmentUrl: resolveMediaAssetUrl(mediaAsset.publicUrl)
      });
      lastQueuedAt = mediaMessage.sentAt;
      queuedCount += 1;
      recipientQueuedJobCount += 1;
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
  }
) {
  const name = input.name.trim();
  const messageBody = input.messageBody;
  const selectedContactIds = normalizeStringArray(input.selectedContactIds);
  const selectedAttachmentIds = normalizeStringArray(input.selectedAttachmentIds);

  if (!name) {
    throw new Error("Campaign name is required.");
  }

  if (!messageBody.trim() && selectedAttachmentIds.length === 0) {
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
    selectedAttachmentIds
  };
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
