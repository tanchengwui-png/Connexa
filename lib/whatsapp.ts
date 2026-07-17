import crypto from "node:crypto";
import { randomUUID } from "node:crypto";
import { processInboundAutomation } from "@/lib/automation-engine";
import { queryOne } from "@/lib/db";
import { emitConversationSnoozeEvent, isConversationSnoozed } from "@/lib/conversation-snooze";
import { ConversationSnoozeStatus, ConversationStatus, MessageDirection } from "@/lib/db-types";
import { emitChatStateToInbox } from "@/lib/inbox-realtime";
import { emitMessageToInbox } from "@/lib/inbox-realtime";
import { prisma } from "@/lib/prisma";
import { normalizeStoredPhone } from "@/lib/phone";
import { resolveWorkspaceDefaultChannelId } from "@/lib/whatsapp-channel-routing";
import { upsertWhatsAppMessageEnvelopeFromPayload } from "@/lib/whatsapp-message-envelope";

type WhatsAppWebhookPayload = {
  entry?: Array<{
    changes?: Array<{
      value?: {
        contacts?: Array<{
          profile?: {
            name?: string;
          };
          wa_id?: string;
        }>;
        metadata?: {
          phone_number_id?: string;
        };
        messages?: Array<{
          from?: string;
          id?: string;
          timestamp?: string;
          type?: string;
          text?: {
            body?: string;
          };
        }>;
      };
    }>;
  }>;
};

type PrismaExecutor = {
  $queryRawUnsafe: <T = unknown>(query: string, ...values: unknown[]) => Promise<T>;
};

type ReusableConversationRecord = {
  id: string;
  channelId: string | null;
  contactId: string;
  whatsAppRemoteId: string | null;
  unreadCount: number;
  lastMessagePreview: string | null;
  updatedAt: Date;
  lastMessageAt: Date;
  contact: {
    id: string;
    phone: string;
    displayName?: string | null;
    displayNameManualOverride?: boolean;
    photoUrl?: string | null;
  };
};

export function pickReusableConversation(
  conversations: ReusableConversationRecord[],
  resolvedChannelId?: string | null,
  whatsAppRemoteId?: string | null,
  contactPhone?: string | null
) {
  if (!conversations.length) {
    return null;
  }

  const remoteId = whatsAppRemoteId?.trim() || null;
  const normalizedContactPhone = contactPhone ? normalizeStoredPhone(contactPhone) : null;
  const candidatePools = resolvedChannelId
    ? [
        conversations.filter((conversation) => conversation.channelId === resolvedChannelId),
        conversations.filter((conversation) => conversation.channelId === null),
        conversations
      ]
    : [conversations];

  if (remoteId) {
    for (const pool of candidatePools) {
      if (!pool.length) {
        continue;
      }

      const exactRemoteMatch = pool.find((conversation) => conversation.whatsAppRemoteId === remoteId);

      if (exactRemoteMatch) {
        return exactRemoteMatch;
      }

      const preferredDirectConversation = pickPreferredDirectConversation(pool, remoteId, normalizedContactPhone);
      if (preferredDirectConversation) {
        return preferredDirectConversation;
      }

      const emptyRemoteMatch = pool.find((conversation) => !conversation.whatsAppRemoteId);
      if (emptyRemoteMatch) {
        return emptyRemoteMatch;
      }
    }

    return null;
  }

  for (const pool of candidatePools) {
    if (pool.length) {
      return pool[0];
    }
  }

  return null;
}

function pickPreferredDirectConversation(
  conversations: ReusableConversationRecord[],
  desiredRemoteId: string,
  contactPhone?: string | null
) {
  if (desiredRemoteId.endsWith("@g.us")) {
    return null;
  }

  const normalizedContactPhone = contactPhone ? normalizeStoredPhone(contactPhone) : null;
  const candidates = conversations.filter((conversation) => !conversation.whatsAppRemoteId || !conversation.whatsAppRemoteId.endsWith("@g.us"));

  if (!candidates.length) {
    return null;
  }

  const scoredCandidates = candidates
    .map((conversation) => ({
      conversation,
      score: scoreDirectConversationCandidate(conversation, desiredRemoteId, normalizedContactPhone)
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);

  return scoredCandidates[0]?.conversation ?? null;
}

function scoreDirectConversationCandidate(
  conversation: ReusableConversationRecord,
  desiredRemoteId: string,
  normalizedContactPhone?: string | null
) {
  const candidateRemoteId = conversation.whatsAppRemoteId?.trim() || null;
  if (!candidateRemoteId) {
    return 50;
  }

  if (candidateRemoteId === desiredRemoteId) {
    return 100;
  }

  if (candidateRemoteId.endsWith("@lid")) {
    return desiredRemoteId.endsWith("@c.us") ? 95 : 90;
  }

  const candidatePhone = toRemoteCandidatePhone(candidateRemoteId);
  if (normalizedContactPhone && candidatePhone === normalizedContactPhone) {
    return desiredRemoteId.endsWith("@lid") ? 85 : 80;
  }

  return 60;
}

async function findReusableConversationByRemote(input: {
  workspaceId: string;
  channelId?: string | null;
  whatsAppRemoteId?: string | null;
}, tx?: {
  conversation: {
    findMany: typeof prisma.conversation.findMany;
  };
}) {
  const remoteId = input.whatsAppRemoteId?.trim();
  if (!remoteId) {
    return null;
  }

  const conversations = await (tx?.conversation ?? prisma.conversation).findMany({
    where: {
      workspaceId: input.workspaceId,
      whatsAppRemoteId: remoteId,
      ...(input.channelId
        ? {
            OR: [{ channelId: input.channelId }, { channelId: null }]
          }
        : {})
    },
    select: {
      id: true,
      channelId: true,
      contactId: true,
      whatsAppRemoteId: true,
      unreadCount: true,
      lastMessagePreview: true,
      updatedAt: true,
      lastMessageAt: true,
      contact: {
        select: {
          id: true,
          phone: true,
          displayName: true,
          displayNameManualOverride: true,
          photoUrl: true
        }
      }
    },
    orderBy: [{ updatedAt: "desc" }, { lastMessageAt: "desc" }],
    take: 10
  });

  return pickReusableConversation(conversations, input.channelId ?? null);
}

async function findReusableConversationByContact(input: {
  workspaceId: string;
  channelId?: string | null;
  contactId: string;
  whatsAppRemoteId?: string | null;
}, tx?: {
  conversation: {
    findMany: typeof prisma.conversation.findMany;
  };
}) {
  const conversations = await (tx?.conversation ?? prisma.conversation).findMany({
    where: {
      workspaceId: input.workspaceId,
      contactId: input.contactId,
      ...(input.channelId
        ? {
            OR: [{ channelId: input.channelId }, { channelId: null }]
          }
        : {})
    },
    select: {
      id: true,
      channelId: true,
      contactId: true,
      whatsAppRemoteId: true,
      unreadCount: true,
      lastMessagePreview: true,
      updatedAt: true,
      lastMessageAt: true,
      contact: {
        select: {
          id: true,
          phone: true,
          displayName: true,
          displayNameManualOverride: true,
          photoUrl: true
        }
      }
    },
    orderBy: [{ updatedAt: "desc" }, { lastMessageAt: "desc" }],
    take: 10
  });

  return pickReusableConversation(
    conversations,
    input.channelId ?? null,
    input.whatsAppRemoteId ?? null,
    conversations[0]?.contact.phone ?? null
  );
}

async function acquireConversationIdentityLock(executor: PrismaExecutor, workspaceId: string, phone: string) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const rows = await executor.$queryRawUnsafe<Array<{ locked: boolean }>>(
      "SELECT pg_try_advisory_xact_lock(hashtext($1), hashtext($2)) AS locked",
      workspaceId,
      phone
    );

    if (rows[0]?.locked) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error("Timed out acquiring conversation identity lock.");
}

export async function findOrCreateReusableConversation(input: {
  executor: PrismaExecutor & {
    conversation: {
      findMany: typeof prisma.conversation.findMany;
      create: typeof prisma.conversation.create;
    };
  };
  workspaceId: string;
  channelId?: string | null;
  contactId: string;
  phone: string;
  whatsAppRemoteId?: string | null;
  subject?: string | null;
  lastMessagePreview: string | null;
  lastMessageAt: Date;
}) {
  await acquireConversationIdentityLock(input.executor, input.workspaceId, input.phone);

  const existingConversationByRemote = await findReusableConversationByRemote(
    {
      workspaceId: input.workspaceId,
      channelId: input.channelId,
      whatsAppRemoteId: input.whatsAppRemoteId
    },
    input.executor
  );

  if (existingConversationByRemote) {
    return existingConversationByRemote;
  }

  const existingConversationByContact = await findReusableConversationByContact(
    {
      workspaceId: input.workspaceId,
      channelId: input.channelId,
      contactId: input.contactId,
      whatsAppRemoteId: input.whatsAppRemoteId
    },
    input.executor
  );

  if (existingConversationByContact) {
    return existingConversationByContact;
  }

  return input.executor.conversation.create({
    data: {
      workspaceId: input.workspaceId,
      channelId: input.channelId ?? null,
      contactId: input.contactId,
      whatsAppRemoteId: input.whatsAppRemoteId ?? null,
      subject: input.subject?.trim() || null,
      status: ConversationStatus.OPEN,
      unreadCount: 0,
      isHotLead: false,
      lastMessagePreview: input.lastMessagePreview,
      lastMessageAt: input.lastMessageAt
    },
    select: {
      id: true,
      channelId: true,
      contactId: true,
      whatsAppRemoteId: true,
      unreadCount: true,
      lastMessagePreview: true,
      updatedAt: true,
      lastMessageAt: true,
      contact: {
        select: {
          id: true,
          phone: true,
          displayName: true,
          displayNameManualOverride: true,
          photoUrl: true
        }
      }
    }
  });
}

export function getWebhookPhoneNumberId(payload: WhatsAppWebhookPayload) {
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const phoneNumberId = change.value?.metadata?.phone_number_id;
      if (phoneNumberId) {
        return phoneNumberId;
      }
    }
  }

  return null;
}

export function isValidWhatsappSignature(
  payload: string,
  signature: string | null | undefined,
  appSecret: string
) {
  if (!signature?.startsWith("sha256=")) {
    return false;
  }

  const digest = crypto.createHmac("sha256", appSecret).update(payload).digest("hex");
  const expected = Buffer.from(`sha256=${digest}`);
  const actual = Buffer.from(signature);

  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function normalizeMuteExpiration(value?: Date | string | number | null) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "number" && (!Number.isFinite(value) || value <= 0)) {
    return null;
  }

  const parsed =
    value instanceof Date
      ? value
      : typeof value === "number"
        ? new Date(value > 1_000_000_000_000 ? value : value * 1000)
        : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isMissingConversationChatStateColumnError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message.includes('column "isMuted" does not exist') ||
    error.message.includes('column "muteExpiration" does not exist') ||
    error.message.includes('column "isArchived" does not exist') ||
    error.message.includes('column "isPinned" does not exist') ||
    error.message.includes("column conv.isMuted does not exist") ||
    error.message.includes("column conv.muteExpiration does not exist") ||
    error.message.includes("column conv.isArchived does not exist") ||
    error.message.includes("column conv.isPinned does not exist")
  );
}

async function syncConversationChatStateRecord(input: {
  conversationId: string;
  channelId: string | null;
  workspaceId: string;
  isMuted?: boolean | null;
  muteExpiration?: Date | string | number | null;
  isArchived?: boolean | null;
  isPinned?: boolean | null;
  unreadCount?: number | null;
}) {
  const nextIsMuted = Boolean(input.isMuted);
  const nextMuteExpiration = nextIsMuted ? normalizeMuteExpiration(input.muteExpiration) : null;
  const nextIsArchived = Boolean(input.isArchived);
  const nextIsPinned = Boolean(input.isPinned);
  const nextUnreadCount = Math.max(0, input.unreadCount ?? 0);

  let updated: {
    id: string;
    channelId: string | null;
    isMuted: boolean;
    muteExpiration: Date | null;
    isArchived: boolean;
    isPinned: boolean;
    unreadCount: number;
    stateChanged: boolean;
  } | null = null;

  try {
    updated = await queryOne<{
      id: string;
      channelId: string | null;
      isMuted: boolean;
      muteExpiration: Date | null;
      isArchived: boolean;
      isPinned: boolean;
      unreadCount: number;
      stateChanged: boolean;
    }>(
      `WITH previous AS (
         SELECT id,
                "channelId",
                "isMuted",
                "muteExpiration",
                "isArchived",
                "isPinned",
                "unreadCount"
         FROM "Conversation"
         WHERE id = $1
       ),
       updated AS (
         UPDATE "Conversation"
         SET "isMuted" = $2,
             "muteExpiration" = $3,
             "isArchived" = $4,
             "isPinned" = $5,
             "unreadCount" = $6,
             "updatedAt" = CASE
               WHEN EXISTS (
                 SELECT 1
                 FROM previous
                 WHERE previous."isMuted" IS DISTINCT FROM $2
                   OR previous."muteExpiration" IS DISTINCT FROM $3
                   OR previous."isArchived" IS DISTINCT FROM $4
                   OR previous."isPinned" IS DISTINCT FROM $5
                   OR previous."unreadCount" IS DISTINCT FROM $6
               )
               THEN NOW()
               ELSE "updatedAt"
             END
         WHERE id = $1
         RETURNING id,
                   "channelId",
                   "isMuted",
                   "muteExpiration",
                   "isArchived",
                   "isPinned",
                   "unreadCount"
       )
       SELECT updated.*,
              EXISTS (
                SELECT 1
                FROM previous
                WHERE previous."isMuted" IS DISTINCT FROM $2
                  OR previous."muteExpiration" IS DISTINCT FROM $3
                  OR previous."isArchived" IS DISTINCT FROM $4
                  OR previous."isPinned" IS DISTINCT FROM $5
                  OR previous."unreadCount" IS DISTINCT FROM $6
              ) AS "stateChanged"
       FROM updated`,
      [
        input.conversationId,
        nextIsMuted,
        nextMuteExpiration,
        nextIsArchived,
        nextIsPinned,
        nextUnreadCount
      ]
    );
  } catch (error) {
    if (isMissingConversationChatStateColumnError(error)) {
      return null;
    }

    throw error;
  }

  if (!updated || !updated.stateChanged) {
    return updated;
  }

  await emitChatStateToInbox({
    workspaceId: input.workspaceId,
    channelId: input.channelId ?? updated.channelId ?? null,
    conversationId: updated.id,
    isMuted: updated.isMuted,
    muteExpiration: updated.muteExpiration?.toISOString() ?? null,
    isArchived: updated.isArchived,
    isPinned: updated.isPinned,
    unreadCount: updated.unreadCount,
    timestamp: new Date().toISOString()
  });

  return updated;
}

export async function ingestWhatsappWebhook(
  payload: WhatsAppWebhookPayload,
  workspaceId: string,
  expectedPhoneNumberId?: string | null
) {
  const ingestedMessageIds: string[] = [];

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      const payloadPhoneNumberId = value?.metadata?.phone_number_id;

      if (expectedPhoneNumberId && payloadPhoneNumberId && payloadPhoneNumberId !== expectedPhoneNumberId) {
        continue;
      }

      const contactsByWaId = new Map(
        (value?.contacts ?? [])
          .filter((contact) => contact.wa_id)
          .map((contact) => [
            contact.wa_id as string,
            {
              phone: normalizeStoredPhone(contact.wa_id as string),
              displayName: contact.profile?.name?.trim() || contact.wa_id || "WhatsApp contact"
            }
          ])
      );

      for (const message of value?.messages ?? []) {
        if (message.type !== "text" || !message.from || !message.id || !message.text?.body) {
          continue;
        }

        const exists = await prisma.message.findUnique({
          where: {
            providerMessageId: message.id
          },
          select: {
            id: true
          }
        });

        if (exists) {
          continue;
        }

        const contactSeed = contactsByWaId.get(message.from) ?? {
          phone: normalizeStoredPhone(message.from),
          displayName: message.from
        };

        const sentAt = message.timestamp
          ? new Date(Number(message.timestamp) * 1000)
          : new Date();
        await createInboundConversationMessage({
          workspaceId,
          providerMessageId: message.id,
          direction: "INBOUND",
          body: message.text.body,
          sentAt,
          phone: contactSeed.phone,
          displayName: contactSeed.displayName,
          rawPayload: message
        });

        ingestedMessageIds.push(message.id);
      }
    }
  }

  return {
    ingestedMessageIds
  };
}

export async function ingestSimulatedInboundMessage(input: {
  workspaceId: string;
  body: string;
  phone?: string | null;
  displayName?: string | null;
  conversationId?: string | null;
  sentAt?: Date | null;
  ignoreAutomationPause?: boolean;
  isTest?: boolean;
}) {
  const normalizedBody = input.body.trim();
  if (!normalizedBody) {
    throw new Error("Message body is required.");
  }

  const sentAt = input.sentAt ?? new Date();
  const providerMessageId = `mock-inbound-${sentAt.getTime()}`;

  return createInboundConversationMessage({
    workspaceId: input.workspaceId,
    providerMessageId,
    direction: "INBOUND",
    body: normalizedBody,
    sentAt,
    phone: input.phone ? normalizeStoredPhone(input.phone) : undefined,
    displayName: input.displayName?.trim() || undefined,
    conversationId: input.conversationId ?? undefined,
    ignoreAutomationPause: input.ignoreAutomationPause,
    isTest: input.isTest,
    rawPayload: {
      source: input.isTest ? "automation-test" : "simulated-inbound",
      body: normalizedBody
    }
  });
}

export async function ingestWhatsAppClientMessage(input: {
  workspaceId: string;
  channelId?: string | null;
  providerMessageId: string;
  body: string;
  direction?: "INBOUND" | "OUTBOUND";
  mediaAssetId?: string | null;
  attachmentMimeType?: string | null;
  attachmentName?: string | null;
  attachmentUrl?: string | null;
  phone?: string | null;
  displayName?: string | null;
  photoUrl?: string | null;
  sentAt?: Date | null;
  rawPayload: unknown;
}) {
  const normalizedBody = input.body.trim();
  const resolvedBody = sanitizeSyncedMessageText(
    getSyncedMessageBody({
      body: normalizedBody,
      type: readStringField(input.rawPayload, "type"),
      caption: readStringField(input.rawPayload, "caption"),
      mimetype: readStringField(input.rawPayload, "mimetype"),
      hasMedia: readBooleanField(input.rawPayload, "hasMedia") ?? Boolean(input.attachmentUrl),
      rawPayload: input.rawPayload
    })
  );

  if (!resolvedBody) {
    throw new Error("Message body is required.");
  }

  if (!input.phone) {
    throw new Error("Phone is required.");
  }

  return createInboundConversationMessage({
    workspaceId: input.workspaceId,
    channelId: input.channelId ?? null,
    providerMessageId: input.providerMessageId,
    direction: input.direction ?? "INBOUND",
    body: resolvedBody,
    mediaAssetId: input.mediaAssetId ?? null,
    attachmentMimeType: input.attachmentMimeType ?? null,
    attachmentName: input.attachmentName ?? null,
    attachmentUrl: input.attachmentUrl ?? null,
    sentAt: input.sentAt ?? new Date(),
    phone: normalizeStoredPhone(input.phone),
    displayName: input.displayName?.trim() || undefined,
    photoUrl: input.photoUrl === null ? null : input.photoUrl?.trim() || undefined,
    rawPayload: input.rawPayload
  });
}

export async function syncWhatsAppHistoryConversation(input: {
  workspaceId: string;
  channelId?: string | null;
  phone?: string | null;
  displayName?: string | null;
  photoUrl?: string | null;
  isMuted?: boolean | null;
  muteExpiration?: Date | string | number | null;
  isArchived?: boolean | null;
  isPinned?: boolean | null;
  unreadCount?: number;
  messages: Array<{
    id: string;
    author?: string | null;
    chatId?: string | null;
    mediaAssetId?: string | null;
    attachmentMimeType?: string | null;
    attachmentName?: string | null;
    attachmentUrl?: string | null;
    body?: string | null;
    fromMe: boolean;
    timestamp?: number | null;
    type?: string | null;
    hasMedia?: boolean;
    rawPayload?: unknown;
  }>;
}) {
  if (!input.phone) {
    return { conversationId: null, importedCount: 0 };
  }

  const phone = normalizeStoredPhone(input.phone);
  if (!phone) {
    return { conversationId: null, importedCount: 0 };
  }
  const sortedMessages = [...input.messages]
    .sort((left, right) => (left.timestamp ?? 0) - (right.timestamp ?? 0))
    .filter((message) => sanitizeSyncedMessageText(getSyncedMessageBody(message)));

  if (!sortedMessages.length) {
    return { conversationId: null, importedCount: 0 };
  }

  const resolvedChannelId = input.channelId ?? (await resolveWorkspaceDefaultChannelId(input.workspaceId));
  const normalizedSubject = input.displayName?.trim() || null;
  const latestInboundRemoteId = [...input.messages]
    .reverse()
    .filter((message) => !message.fromMe)
    .map((message) => extractWhatsAppRemoteId(message.rawPayload ?? message, phone))
    .find((value): value is string => Boolean(value));
  const latestConversationRemoteId =
    latestInboundRemoteId ??
    [...input.messages]
      .reverse()
      .map((message) => extractWhatsAppRemoteId(message.rawPayload ?? message, phone))
      .find((value): value is string => Boolean(value));
  const existingConversationByRemote = await findReusableConversationByRemote({
    workspaceId: input.workspaceId,
    channelId: resolvedChannelId,
    whatsAppRemoteId: latestConversationRemoteId
  });

  const existingContact = await prisma.contact.findUnique({
    where: {
      workspaceId_phone: {
        workspaceId: input.workspaceId,
        phone
      }
    },
    select: {
      id: true,
      tags: true,
      syncedTags: true,
      tagsManualOverride: true,
      photoUrl: true,
      phone: true,
      displayName: true,
      syncedDisplayName: true,
      displayNameManualOverride: true,
      lastInteractionAt: true
    }
  });
  const remoteMatchedContact = existingConversationByRemote?.contact ?? null;
  const contactPhoneConflict =
    remoteMatchedContact && remoteMatchedContact.phone !== phone
      ? await prisma.contact.findUnique({
          where: {
            workspaceId_phone: {
              workspaceId: input.workspaceId,
              phone
            }
          },
          select: {
            id: true
          }
        })
      : null;
  const shouldRepairRemoteMatchedPhone = Boolean(
    remoteMatchedContact &&
      remoteMatchedContact.phone !== phone &&
      (!contactPhoneConflict || contactPhoneConflict.id === remoteMatchedContact.id)
  );

  const syncedDisplayName = input.displayName?.trim() || phone;
  const syncedTags = mergeWhatsappTag(existingContact?.syncedTags ?? existingContact?.tags);
  const contact = await prisma.contact.upsert({
    where: {
      workspaceId_phone: {
        workspaceId: input.workspaceId,
        phone
      }
    },
    update: {
      displayName: existingContact?.displayNameManualOverride
        ? existingContact.displayName
        : syncedDisplayName,
      syncedDisplayName,
      ...(normalizePhotoUrlUpdate(input.photoUrl) !== undefined
      ? { photoUrl: normalizePhotoUrlUpdate(input.photoUrl) }
      : { photoUrl: existingContact?.photoUrl ?? null }),
      tags: existingContact?.tagsManualOverride ? existingContact.tags : syncedTags,
      syncedTags,
      lastInteractionAt: sortedMessages.length
        ? new Date((sortedMessages[sortedMessages.length - 1].timestamp ?? Date.now() / 1000) * 1000)
        : new Date()
    },
    create: {
      workspaceId: input.workspaceId,
      displayName: syncedDisplayName,
      syncedDisplayName,
      phone,
      photoUrl: input.photoUrl?.trim() || null,
      tags: "whatsapp",
      syncedTags: "whatsapp",
      lastInteractionAt: sortedMessages.length
        ? new Date((sortedMessages[sortedMessages.length - 1].timestamp ?? Date.now() / 1000) * 1000)
        : new Date()
    }
  });

  const latestMessagePreview = sortedMessages[sortedMessages.length - 1]
    ? sanitizeSyncedMessageText(getSyncedMessageBody(sortedMessages[sortedMessages.length - 1]))
    : null;
  const conversation = await prisma.$transaction((tx) =>
      findOrCreateReusableConversation({
        executor: tx,
        workspaceId: input.workspaceId,
        channelId: resolvedChannelId,
        contactId: contact.id,
        phone,
        whatsAppRemoteId: latestConversationRemoteId ?? null,
        subject: isGroupRemoteId(latestConversationRemoteId) ? normalizedSubject : null,
        lastMessagePreview: latestMessagePreview,
        lastMessageAt: sortedMessages.length
        ? new Date((sortedMessages[sortedMessages.length - 1].timestamp ?? Date.now() / 1000) * 1000)
        : new Date()
    })
  );
  let importedCount = 0;

  for (const message of sortedMessages) {
    const providerMessageId = message.id?.trim();
    if (!providerMessageId) {
      continue;
    }

    const exists = await prisma.message.findUnique({
      where: {
        providerMessageId
      },
      select: {
        id: true
      }
    });

    if (exists) {
      await upsertWhatsAppMessageEnvelopeFromPayload({
        workspaceId: input.workspaceId,
        channelId: resolvedChannelId,
        conversationId: conversation.id,
        messageId: exists.id,
        providerMessageId,
        body: sanitizeSyncedMessageText(getSyncedMessageBody(message)) || message.body || null,
        direction: message.fromMe ? "OUTBOUND" : "INBOUND",
        sentAt: new Date((message.timestamp ?? Date.now() / 1000) * 1000),
        mediaAssetId: message.mediaAssetId ?? null,
        attachmentMimeType: message.attachmentMimeType ?? null,
        attachmentName: message.attachmentName ?? null,
        attachmentUrl: message.attachmentUrl ?? null,
        rawPayload: message.rawPayload ?? message
      });
      continue;
    }

    const body = sanitizeSyncedMessageText(getSyncedMessageBody(message));
    if (!body) {
      continue;
    }

    const sentAt = new Date((message.timestamp ?? Date.now() / 1000) * 1000);

    const createdMessage = await insertMessageRecord(prisma, {
      conversationId: conversation.id,
      providerMessageId,
      direction: message.fromMe ? MessageDirection.OUTBOUND : MessageDirection.INBOUND,
      body,
      mediaAssetId: message.mediaAssetId ?? null,
      attachmentMimeType: message.attachmentMimeType ?? null,
      attachmentName: message.attachmentName ?? null,
      attachmentUrl: message.attachmentUrl ?? null,
      rawPayload: JSON.stringify(message.rawPayload ?? message),
      sentAt
    });

    await upsertWhatsAppMessageEnvelopeFromPayload({
      workspaceId: input.workspaceId,
      channelId: resolvedChannelId,
      conversationId: conversation.id,
      messageId: createdMessage.id,
      providerMessageId,
      body,
      direction: message.fromMe ? "OUTBOUND" : "INBOUND",
      sentAt,
      mediaAssetId: message.mediaAssetId ?? null,
      attachmentMimeType: message.attachmentMimeType ?? null,
      attachmentName: message.attachmentName ?? null,
      attachmentUrl: message.attachmentUrl ?? null,
      rawPayload: message.rawPayload ?? message
    });

    importedCount += 1;
  }

  const latestMessage = sortedMessages[sortedMessages.length - 1];
  const inboundCount = await prisma.message.count({
    where: {
      conversationId: conversation.id,
      direction: MessageDirection.INBOUND
    }
  });

  const hotLead = inboundCount >= 3;
  const mergedTags = mergeWhatsappTag(contact.syncedTags ?? contact.tags);
  const nextMuteExpiration = input.isMuted ? normalizeMuteExpiration(input.muteExpiration) : null;

  await prisma.$transaction(async (tx) => {
    await tx.conversation.update({
      where: {
        id: conversation.id
      },
      data: {
        channelId: resolvedChannelId ?? conversation.channelId ?? null,
        whatsAppRemoteId: resolveSafeConversationRemoteId({
          candidateRemoteId: latestInboundRemoteId,
          currentRemoteId: conversation.whatsAppRemoteId,
          contactPhone: contact.phone
        }) ?? null,
        ...(isGroupRemoteId(latestConversationRemoteId) && normalizedSubject ? { subject: normalizedSubject } : {}),
        status: ConversationStatus.OPEN,
        isHotLead: hotLead,
        lastMessagePreview: latestMessage ? sanitizeSyncedMessageText(getSyncedMessageBody(latestMessage)) : conversation.lastMessagePreview,
        lastMessageAt: latestMessage
          ? new Date((latestMessage.timestamp ?? Date.now() / 1000) * 1000)
          : conversation.lastMessageAt
      }
    });

    await tx.contact.update({
      where: {
        id: contact.id
      },
      data: {
        displayName: contact.displayNameManualOverride
          ? contact.displayName
          : syncedDisplayName,
        syncedDisplayName,
        ...(normalizePhotoUrlUpdate(input.photoUrl) !== undefined
          ? { photoUrl: normalizePhotoUrlUpdate(input.photoUrl) }
          : { photoUrl: contact.photoUrl }),
        isHotLead: hotLead,
        tags: contact.tagsManualOverride ? contact.tags : mergedTags,
        syncedTags: mergedTags,
        lastInteractionAt: latestMessage
          ? new Date((latestMessage.timestamp ?? Date.now() / 1000) * 1000)
          : contact.lastInteractionAt
      }
    });

    if (shouldRepairRemoteMatchedPhone && remoteMatchedContact) {
      await tx.contact.update({
        where: {
          id: remoteMatchedContact.id
        },
        data: {
          phone
        }
      });
    }
  });

  await syncConversationChatStateRecord({
    workspaceId: input.workspaceId,
    channelId: resolvedChannelId ?? conversation.channelId ?? null,
    conversationId: conversation.id,
    isMuted: input.isMuted,
    muteExpiration: nextMuteExpiration,
    isArchived: input.isArchived,
    isPinned: input.isPinned,
    unreadCount: input.unreadCount ?? conversation.unreadCount
  });

  return {
    conversationId: conversation.id,
    importedCount
  };
}

async function createInboundConversationMessage(input: {
  workspaceId: string;
  channelId?: string | null;
  providerMessageId: string;
  direction: "INBOUND" | "OUTBOUND";
  body: string;
  mediaAssetId?: string | null;
  attachmentMimeType?: string | null;
  attachmentName?: string | null;
  attachmentUrl?: string | null;
  sentAt: Date;
  phone?: string;
  displayName?: string;
  photoUrl?: string | null;
  conversationId?: string;
  ignoreAutomationPause?: boolean;
  isTest?: boolean;
  rawPayload: unknown;
}) {
  const existingMessage = await prisma.message.findUnique({
    where: {
      providerMessageId: input.providerMessageId
    },
    select: {
      id: true
    }
  });

  if (existingMessage) {
    throw new Error("This inbound message has already been processed.");
  }

  let contactId = "";
  let conversationId = "";
  const inboundRemoteId = extractWhatsAppRemoteId(input.rawPayload, input.phone);
  const normalizedSubject = input.displayName?.trim() || null;
  const resolvedChannelId = input.channelId ?? (await resolveWorkspaceDefaultChannelId(input.workspaceId));

  if (!input.conversationId && inboundRemoteId) {
    const existingConversationByRemote = await findReusableConversationByRemote({
      workspaceId: input.workspaceId,
      channelId: resolvedChannelId,
      whatsAppRemoteId: inboundRemoteId
    });

    if (existingConversationByRemote) {
      contactId = existingConversationByRemote.contactId;
      conversationId = existingConversationByRemote.id;

      if (input.displayName || input.photoUrl !== undefined) {
        const syncedDisplayName = input.displayName;
        await prisma.contact.update({
          where: {
            id: existingConversationByRemote.contactId
          },
          data: {
            ...(input.displayName
              ? {
                  ...(existingConversationByRemote.contact.displayNameManualOverride
                    ? {}
                    : { displayName: syncedDisplayName }),
                  syncedDisplayName
                }
              : {}),
            ...(normalizePhotoUrlUpdate(input.photoUrl) !== undefined
            ? { photoUrl: normalizePhotoUrlUpdate(input.photoUrl) }
            : {})
          }
        });
      }

      if (input.phone && input.phone !== existingConversationByRemote.contact.phone) {
        const conflictingContact = await prisma.contact.findUnique({
          where: {
            workspaceId_phone: {
              workspaceId: input.workspaceId,
              phone: input.phone
            }
          },
          select: {
            id: true
          }
        });

        if (!conflictingContact || conflictingContact.id === existingConversationByRemote.contactId) {
          await prisma.contact.update({
            where: {
              id: existingConversationByRemote.contactId
            },
            data: {
              phone: input.phone
            }
          });
        }
      }
    }
  }

  if (!conversationId && input.conversationId) {
    const existingConversation = await prisma.conversation.findFirst({
      where: {
        id: input.conversationId,
        workspaceId: input.workspaceId
      },
      include: {
        contact: true
      }
    });

    if (!existingConversation) {
      throw new Error("Conversation not found.");
    }

    contactId = existingConversation.contactId;
    conversationId = existingConversation.id;

    if (input.displayName || input.photoUrl !== undefined) {
      const syncedDisplayName = input.displayName;
      await prisma.contact.update({
        where: {
          id: existingConversation.contactId
        },
        data: {
          ...(input.displayName
            ? {
                ...(existingConversation.contact.displayNameManualOverride
                  ? {}
                  : { displayName: syncedDisplayName }),
                syncedDisplayName
              }
            : {}),
          ...(normalizePhotoUrlUpdate(input.photoUrl) !== undefined
            ? { photoUrl: normalizePhotoUrlUpdate(input.photoUrl) }
            : {})
        }
      });
    }
  } else if (!conversationId) {
    if (!input.phone) {
      throw new Error("Phone is required when no conversation is selected.");
    }

    const existingContact = await prisma.contact.findUnique({
      where: {
        workspaceId_phone: {
          workspaceId: input.workspaceId,
          phone: input.phone
        }
      },
      select: {
        id: true,
        displayName: true,
        displayNameManualOverride: true,
        photoUrl: true,
        syncedDisplayName: true,
        tags: true,
        syncedTags: true
      }
    });

    const contact = await prisma.contact.upsert({
      where: {
        workspaceId_phone: {
          workspaceId: input.workspaceId,
          phone: input.phone
        }
      },
      update: {
        ...(input.displayName
          ? {
              syncedDisplayName: input.displayName,
              ...(existingContact?.displayNameManualOverride ? {} : { displayName: input.displayName })
            }
          : {}),
        ...(normalizePhotoUrlUpdate(input.photoUrl) !== undefined
          ? { photoUrl: normalizePhotoUrlUpdate(input.photoUrl) }
          : existingContact?.photoUrl
            ? { photoUrl: existingContact.photoUrl }
            : {}),
        ...(input.isTest
          ? {
              tags: mergeTags(existingContact?.tags ?? null, ["whatsapp", "simulated", "automation-test"]).join(", "),
              syncedTags: mergeTags(existingContact?.syncedTags ?? null, ["whatsapp", "simulated", "automation-test"]).join(", ")
            }
          : {}),
        lastInteractionAt: input.sentAt
      },
      create: {
        workspaceId: input.workspaceId,
        displayName: input.displayName || input.phone,
        syncedDisplayName: input.displayName || input.phone,
        phone: input.phone,
        photoUrl: normalizePhotoUrlUpdate(input.photoUrl) ?? null,
        tags: input.isTest ? "whatsapp, simulated, automation-test" : "whatsapp, simulated",
        syncedTags: input.isTest ? "whatsapp, simulated, automation-test" : "whatsapp, simulated",
        lastInteractionAt: input.sentAt
      }
    });

    const conversation = await prisma.$transaction((tx) =>
      findOrCreateReusableConversation({
        executor: tx,
        workspaceId: input.workspaceId,
        channelId: resolvedChannelId,
        contactId: contact.id,
        phone: input.phone as string,
        whatsAppRemoteId: inboundRemoteId ?? null,
        subject: isGroupRemoteId(inboundRemoteId) ? normalizedSubject : null,
        lastMessagePreview: input.body,
        lastMessageAt: input.sentAt
      })
    );

    contactId = contact.id;
    conversationId = conversation.id;
  }

  let createdMessageId = "";
  let incomingUnsnoozeMetadata:
    | {
        channelId: string | null;
        conversationId: string;
        workspaceId: string;
      }
    | null = null;

  await prisma.$transaction(async (tx) => {
    const conversation = await tx.conversation.findUnique({
      where: {
        id: conversationId
      },
      select: {
        channelId: true,
        whatsAppRemoteId: true,
        unreadCount: true,
        snoozedUntil: true,
        snoozeStatus: true,
        contact: {
          select: {
            phone: true
          }
        }
      }
    });

    if (!conversation) {
      throw new Error("Conversation not found.");
    }

    const replyToMessageId = await resolveInboundReplyTargetMessageId(tx, {
      conversationId,
      rawPayload: input.rawPayload
    });

    const createdMessage = await insertMessageRecord(tx, {
      conversationId,
      providerMessageId: input.providerMessageId,
      replyToMessageId,
      direction:
        input.direction === "OUTBOUND" ? MessageDirection.OUTBOUND : MessageDirection.INBOUND,
      body: input.body,
      mediaAssetId: input.mediaAssetId ?? null,
      attachmentMimeType: input.attachmentMimeType ?? null,
      attachmentName: input.attachmentName ?? null,
      attachmentUrl: input.attachmentUrl ?? null,
      rawPayload: JSON.stringify(input.rawPayload),
      sentAt: input.sentAt
    });
    createdMessageId = createdMessage.id;

    const nextUnreadCount =
      input.direction === "OUTBOUND" ? conversation.unreadCount : conversation.unreadCount + 1;
    const hotLead = await shouldMarkHotLead(tx, input.workspaceId, conversationId, contactId);
    const shouldUnsnoozeFromInboundReply =
      input.direction === "INBOUND" &&
      isConversationSnoozed({
        snoozedUntil: conversation.snoozedUntil,
        snoozeStatus: conversation.snoozeStatus
      });

    await tx.conversation.update({
      where: {
        id: conversationId
      },
      data: {
        channelId: resolvedChannelId ?? undefined,
        whatsAppRemoteId: resolveSafeConversationRemoteId({
          candidateRemoteId: inboundRemoteId,
          currentRemoteId: conversation.whatsAppRemoteId,
          contactPhone: conversation.contact.phone
        }) ?? undefined,
        ...(isGroupRemoteId(inboundRemoteId) && normalizedSubject ? { subject: normalizedSubject } : {}),
        status: ConversationStatus.OPEN,
        unreadCount: nextUnreadCount,
        isHotLead: hotLead,
        lastMessagePreview: input.body,
        lastMessageAt: input.sentAt,
        ...(shouldUnsnoozeFromInboundReply
          ? {
              snoozedUntil: null,
              snoozedById: null,
              snoozeReason: null,
              snoozeStatus: ConversationSnoozeStatus.INCOMING_MESSAGE
            }
          : {})
      }
    });

    if (shouldUnsnoozeFromInboundReply) {
      incomingUnsnoozeMetadata = {
        channelId: resolvedChannelId ?? conversation.channelId ?? null,
        conversationId,
        workspaceId: input.workspaceId
      };
    }

    await tx.contact.update({
      where: {
        id: contactId
      },
      data: {
        isHotLead: hotLead,
        lastInteractionAt: input.sentAt
      }
    });
  });

  await upsertWhatsAppMessageEnvelopeFromPayload({
    workspaceId: input.workspaceId,
    channelId: resolvedChannelId,
    conversationId,
    messageId: createdMessageId || null,
    providerMessageId: input.providerMessageId,
    body: input.body,
    direction: input.direction ?? "INBOUND",
    sentAt: input.sentAt,
    mediaAssetId: input.mediaAssetId ?? null,
    attachmentMimeType: input.attachmentMimeType ?? null,
    attachmentName: input.attachmentName ?? null,
    attachmentUrl: input.attachmentUrl ?? null,
    rawPayload: input.rawPayload
  });

  const unsnoozeEvent = incomingUnsnoozeMetadata as
    | {
        channelId: string | null;
        conversationId: string;
        workspaceId: string;
      }
    | null;

  if (unsnoozeEvent) {
    await emitConversationSnoozeEvent({
      action: "unsnoozed",
      channelId: unsnoozeEvent.channelId,
      conversationId: unsnoozeEvent.conversationId,
      snoozeReason: null,
      snoozeStatus: ConversationSnoozeStatus.INCOMING_MESSAGE,
      snoozedUntil: null,
      trigger: "incoming_message",
      workspaceId: unsnoozeEvent.workspaceId
    });
  }

  await emitMessageToInbox({
    channel: await resolveInboxRealtimeChannelKind(resolvedChannelId, input.rawPayload),
    workspaceId: input.workspaceId,
    channelId: resolvedChannelId ?? null,
    conversationId,
    messageId: createdMessageId || null,
    from: input.phone ?? "",
    message: input.body,
    direction: "INBOUND",
    timestamp: input.sentAt.toISOString()
  });

  await processInboundAutomation({
    workspaceId: input.workspaceId,
    conversationId,
    inboundText: input.body,
    sentAt: input.sentAt,
    ignorePausedState: input.ignoreAutomationPause,
    includeDisabledRules: input.isTest
  });

  return {
    conversationId,
    providerMessageId: input.providerMessageId,
    messageId: createdMessageId || null
  };
}

export async function resolveInboxRealtimeChannelKind(channelId: string | null | undefined, rawPayload: unknown) {
  const payloadSource = readStringField(rawPayload, "source");
  if (payloadSource === "cloud-webhook") {
    return "cloud" as const;
  }

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

  return channel?.phoneNumberId && channel.accessTokenCiphertext ? ("cloud" as const) : ("personal" as const);
}

async function shouldMarkHotLead(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  workspaceId: string,
  conversationId: string,
  contactId: string
) {
  const inboundCount = await tx.message.count({
    where: {
      conversationId,
      direction: MessageDirection.INBOUND
    }
  });

  if (inboundCount >= 3) {
    return true;
  }

  const contactConversationCount = await tx.conversation.count({
    where: {
      workspaceId,
      contactId
    }
  });

  return contactConversationCount > 1;
}

function getSyncedMessageBody(message: {
  body?: string | null;
  caption?: string | null;
  mimetype?: string | null;
  type?: string | null;
  hasMedia?: boolean;
  rawPayload?: unknown;
}) {
  const body = message.body?.trim();
  if (body) {
    if (isRestrictedPrimaryDeviceOnlyMessage(body)) {
      return "[Security message visible only on primary device]";
    }

    if (!isEmbeddedMediaPreviewText(body)) {
      return body;
    }
  }

  const caption = message.caption?.trim();
  if (caption) {
    return caption;
  }

  const mimetype = message.mimetype?.trim().toLowerCase();
  if (mimetype?.startsWith("video/")) {
    return "[Video]";
  }

  if (mimetype?.startsWith("image/")) {
    return "[Image]";
  }

  if (mimetype?.startsWith("audio/")) {
    return "[Audio]";
  }

  if (mimetype === "application/pdf" || mimetype?.startsWith("application/")) {
    return "[Document]";
  }

  if (body) {
    return body;
  }

  const callPreview = getSyncedCallPreview(message);
  if (callPreview) {
    return callPreview;
  }

  switch (message.type) {
    case "image":
      return "[Image]";
    case "video":
      return "[Video]";
    case "audio":
    case "ptt":
      return "[Audio]";
    case "document":
      return "[Document]";
    case "sticker":
      return "[Sticker]";
    case "location":
      return "[Location]";
    case "contact":
    case "vcard":
    case "multi_vcard":
      return "[Contact]";
    case "poll_creation":
    case "poll":
      return "[Poll]";
    case "revoked":
      return "[Deleted message]";
    case "reaction":
      return "[Reaction]";
    case "call_log":
      return "[Call]";
    case "e2e_notification":
    case "notification_template":
      return "[System message or security content visible only on primary device]";
    default:
      return message.hasMedia ? "[Media]" : formatUnknownSyncedMessageType(message.type);
  }
}

function isRestrictedPrimaryDeviceOnlyMessage(body: string) {
  const normalized = body.trim().toLowerCase();

  return (
    normalized === "[biz content placeholder]" ||
    normalized.includes("you received a one-time passcode") ||
    normalized.includes("you can only see it on your primary device") ||
    normalized.includes("for added security")
  );
}

function isEmbeddedMediaPreviewText(body: string) {
  const compact = body.replace(/\s+/g, "");

  if (compact.length < 512) {
    return false;
  }

  return (
    compact.startsWith("/9j/") ||
    compact.startsWith("iVBORw0KGgo") ||
    compact.startsWith("R0lGOD") ||
    compact.startsWith("UklGR")
  );
}

function formatUnknownSyncedMessageType(type?: string | null) {
  const normalized = type?.trim();
  if (!normalized) {
    return "[Unsupported message]";
  }

  const parts = normalized
    .split(/[_-]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (!parts.length) {
    return "[Unsupported message]";
  }

  return `[${parts
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")}]`;
}

function sanitizeSyncedMessageText(value?: string | null) {
  const source = value?.replace(/\r\n/g, "\n").trim() ?? "";
  if (!source) {
    return "";
  }

  const cleaned = source
    .replace(/\[\s*\]/g, " ")
    .replace(/\[biz content placeholder\]/gi, " ")
    .replace(/\[security message visible only on primary device\]/gi, " ")
    .replace(/\[system message or security content visible only on primary device\]/gi, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return cleaned;
}

function getSyncedCallPreview(message: {
  type?: string | null;
  rawPayload?: unknown;
}) {
  const rawPayload =
    message.rawPayload && typeof message.rawPayload === "object"
      ? (message.rawPayload as Record<string, unknown>)
      : null;
  const normalizedType = message.type?.trim().toLowerCase() ?? "";

  const isExplicitCallType =
    normalizedType === "call_log" || normalizedType === "call" || normalizedType.endsWith("_call");
  const isUntypedCallPayload =
    !normalizedType &&
    Boolean(
      rawPayload &&
        (rawPayload.callDuration !== undefined ||
          rawPayload.callCreator !== undefined ||
          rawPayload.callParticipants !== undefined ||
          rawPayload.callSilenceReason !== undefined ||
          rawPayload.isCallLink !== undefined)
    );
  const isCallPayload = isExplicitCallType || isUntypedCallPayload;

  if (!isCallPayload) {
    return null;
  }

  return rawPayload?.isVideoCall === true || normalizedType.includes("video")
    ? "[Video call]"
    : "[Voice call]";
}

function mergeWhatsappTag(current?: string | null) {
  const tags = new Set(
    (current ?? "")
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean)
  );
  tags.add("whatsapp");
  return Array.from(tags).join(", ");
}

function mergeTags(current?: string | null, next: string[] = []) {
  return Array.from(
    new Set(
      [
        ...(current ?? "")
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
        ...next.map((tag) => tag.trim()).filter(Boolean)
      ].filter(Boolean)
    )
  );
}

function normalizePhotoUrlUpdate(photoUrl?: string | null) {
  if (photoUrl === undefined) {
    return undefined;
  }

  const normalized = photoUrl?.trim() ?? "";
  return normalized ? normalized : null;
}

function extractWhatsAppRemoteId(rawPayload: unknown, phone?: string | null) {
  const parsed = rawPayload && typeof rawPayload === "object" ? (rawPayload as Record<string, unknown>) : null;
  const isFromMe = readBooleanField(rawPayload, "fromMe");
  const normalizedPhone = phone ? normalizeStoredPhone(phone) : null;
  const resolvedCandidates = collectWhatsAppRemoteIdCandidates(rawPayload, Boolean(isFromMe));

  const preferredGroupCandidate = resolvedCandidates.find((candidate) => candidate.value.endsWith("@g.us"));
  if (preferredGroupCandidate) {
    return preferredGroupCandidate.value;
  }

  if (normalizedPhone) {
    const exactPhoneCandidate = resolvedCandidates.find(
      (candidate) => toRemoteCandidatePhone(candidate.value) === normalizedPhone
    );
    if (exactPhoneCandidate) {
      return exactPhoneCandidate.value;
    }
  }

  if (isFromMe) {
    const outboundTargetCandidate = resolvedCandidates.find((candidate) =>
      ["chatId", "remote", "idRemote", "to"].includes(candidate.source)
    );
    if (outboundTargetCandidate) {
      return outboundTargetCandidate.value;
    }
  } else if (resolvedCandidates.length > 0) {
    return resolvedCandidates[0].value;
  }

  return normalizedPhone ? buildDirectConversationRemoteId(normalizedPhone) : null;
}

function collectWhatsAppRemoteIdCandidates(rawPayload: unknown, isFromMe: boolean) {
  const parsed = rawPayload && typeof rawPayload === "object" ? (rawPayload as Record<string, unknown>) : null;
  const idRecord = parsed?.id && typeof parsed.id === "object" ? (parsed.id as Record<string, unknown>) : null;
  const candidates = isFromMe
    ? [
        { source: "chatId", value: parsed?.chatId },
        { source: "remote", value: parsed?.remote },
        { source: "idRemote", value: idRecord?.remote },
        { source: "to", value: parsed?.to },
        { source: "serializedId", value: idRecord?._serialized },
        { source: "author", value: parsed?.author },
        { source: "from", value: parsed?.from }
      ]
    : [
        { source: "chatId", value: parsed?.chatId },
        { source: "remote", value: parsed?.remote },
        { source: "from", value: parsed?.from },
        { source: "author", value: parsed?.author },
        { source: "idRemote", value: idRecord?.remote },
        { source: "serializedId", value: idRecord?._serialized },
        { source: "to", value: parsed?.to }
      ];
  const resolvedCandidates: Array<{ source: string; value: string }> = [];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    if (typeof candidate.value !== "string") {
      continue;
    }

    const trimmed = candidate.value.trim();
    if (!trimmed) {
      continue;
    }

    const directMatch = /@(?:lid|c\.us|g\.us)$/.test(trimmed) ? trimmed : null;
    const serializedMatch = directMatch ? null : trimmed.match(/^(?:true|false)_(.+@(?:lid|c\.us|g\.us))_/);
    const resolvedValue = directMatch ?? serializedMatch?.[1] ?? null;

    if (!resolvedValue || seen.has(resolvedValue)) {
      continue;
    }

    seen.add(resolvedValue);
    resolvedCandidates.push({
      source: candidate.source,
      value: resolvedValue
    });
  }

  return resolvedCandidates;
}

function toRemoteCandidatePhone(remoteId: string) {
  if (!remoteId.endsWith("@c.us") && !remoteId.endsWith("@g.us")) {
    return null;
  }

  return normalizeStoredPhone(remoteId.slice(0, remoteId.indexOf("@")));
}

function isGroupRemoteId(remoteId?: string | null) {
  return Boolean(remoteId?.trim().toLowerCase().endsWith("@g.us"));
}

function buildDirectConversationRemoteId(phone: string) {
  const normalizedPhone = normalizeStoredPhone(phone);
  return normalizedPhone ? `${normalizedPhone}@c.us` : null;
}

export function resolveSafeConversationRemoteId(input: {
  candidateRemoteId?: string | null;
  currentRemoteId?: string | null;
  contactPhone?: string | null;
}) {
  const candidateRemoteId = input.candidateRemoteId?.trim() || null;
  const currentRemoteId = input.currentRemoteId?.trim() || null;
  const normalizedContactPhone = input.contactPhone ? normalizeStoredPhone(input.contactPhone) : null;

  if (!candidateRemoteId) {
    return currentRemoteId;
  }

  if (candidateRemoteId.endsWith("@g.us")) {
    return candidateRemoteId;
  }

  const candidatePhone = toRemoteCandidatePhone(candidateRemoteId);
  if (candidatePhone && normalizedContactPhone && candidatePhone !== normalizedContactPhone) {
    return currentRemoteId;
  }

  if (
    currentRemoteId?.endsWith("@lid") &&
    candidatePhone &&
    normalizedContactPhone &&
    candidatePhone === normalizedContactPhone
  ) {
    return currentRemoteId;
  }

  return candidateRemoteId;
}

export async function insertMessageRecord(
  executor: PrismaExecutor,
  input: {
    conversationId: string;
    providerMessageId: string;
    replyToMessageId?: string | null;
    direction: string;
    body: string;
    mediaAssetId: string | null;
    attachmentMimeType: string | null;
    attachmentName: string | null;
    attachmentUrl: string | null;
    rawPayload: string;
    sentAt: Date;
  }
) {
  const rows = await executor.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO "Message" (
      id, "conversationId", "providerMessageId", "replyToMessageId", direction, body, "mediaAssetId",
      "attachmentMimeType", "attachmentName", "attachmentUrl", "rawPayload", "sentAt"
    ) VALUES ($1, $2, $3, $4, CAST($5 AS "MessageDirection"), $6, $7, $8, $9, $10, $11, $12)
    RETURNING id`,
    randomUUID().replace(/-/g, ""),
    input.conversationId,
    input.providerMessageId,
    input.replyToMessageId ?? null,
    input.direction,
    input.body,
    input.mediaAssetId,
    input.attachmentMimeType,
    input.attachmentName,
    input.attachmentUrl,
    input.rawPayload,
    input.sentAt
  );

  const created = rows[0];
  if (!created?.id) {
    throw new Error("Unable to create message record.");
  }

  return created;
}

async function resolveInboundReplyTargetMessageId(
  executor: PrismaExecutor,
  input: {
    conversationId: string;
    rawPayload: unknown;
  }
) {
  const quotedProviderIds = collectQuotedProviderMessageIds(input.rawPayload);
  if (!quotedProviderIds.length) {
    return null;
  }

  for (const quotedProviderId of quotedProviderIds) {
    const rows = await executor.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id
       FROM "Message"
       WHERE "conversationId" = $1
         AND (
           "providerMessageId" = $2
           OR split_part(COALESCE("providerMessageId", ''), '_', 3) = $2
         )
       ORDER BY "sentAt" DESC
       LIMIT 1`,
      input.conversationId,
      quotedProviderId
    );

    if (rows[0]?.id) {
      return rows[0].id;
    }
  }

  return null;
}

function collectQuotedProviderMessageIds(rawPayload: unknown) {
  const candidates = [
    readStringField(rawPayload, "quotedMessageId"),
    readNestedStringField(rawPayload, ["quotedMsg", "_serialized"]),
    readNestedStringField(rawPayload, ["quotedMsg", "id", "_serialized"]),
    readNestedStringField(rawPayload, ["quotedMsg", "id"]),
    readNestedStringField(rawPayload, ["quotedMsg", "_data", "id", "_serialized"]),
    readNestedStringField(rawPayload, ["_data", "quotedMsg", "id", "_serialized"]),
    readNestedStringField(rawPayload, ["_data", "quotedMessageId"]),
    readNestedStringField(rawPayload, ["context", "id"]),
    readNestedStringField(rawPayload, ["contextInfo", "stanzaId"]),
    readNestedStringField(rawPayload, ["_data", "contextInfo", "stanzaId"]),
    readNestedStringField(rawPayload, ["quotedStanzaID"])
  ];

  const resolved = new Set<string>();
  for (const candidate of candidates) {
    const normalized = normalizeQuotedProviderMessageId(candidate);
    if (normalized) {
      resolved.add(normalized);
    }
  }

  return Array.from(resolved);
}

function normalizeQuotedProviderMessageId(value: string | null) {
  const normalized = value?.trim() ?? "";
  if (!normalized) {
    return null;
  }

  if (normalized.startsWith("{") || normalized.startsWith("[")) {
    return null;
  }

  return normalized;
}

function readStringField(value: unknown, key: string) {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  return typeof record?.[key] === "string" ? (record[key] as string) : null;
}

function readBooleanField(value: unknown, key: string) {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  return typeof record?.[key] === "boolean" ? (record[key] as boolean) : null;
}

function readNestedStringField(value: unknown, path: string[]) {
  let current: unknown = value;
  for (const segment of path) {
    if (!current || typeof current !== "object") {
      return null;
    }
    current = (current as Record<string, unknown>)[segment];
  }

  return typeof current === "string" ? current : null;
}
