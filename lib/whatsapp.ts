import crypto from "node:crypto";
import { ConversationStatus, MessageDirection } from "@prisma/client";
import { processInboundAutomation } from "@/lib/automation-engine";
import { prisma } from "@/lib/prisma";
import { normalizeStoredPhone } from "@/lib/phone";
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
  providerMessageId: string;
  body: string;
  direction?: "INBOUND" | "OUTBOUND";
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
    providerMessageId: input.providerMessageId,
    direction: input.direction ?? "INBOUND",
    body: resolvedBody,
    attachmentMimeType: input.attachmentMimeType ?? null,
    attachmentName: input.attachmentName ?? null,
    attachmentUrl: input.attachmentUrl ?? null,
    sentAt: input.sentAt ?? new Date(),
    phone: normalizeStoredPhone(input.phone),
    displayName: input.displayName?.trim() || undefined,
    photoUrl: input.photoUrl?.trim() || undefined,
    rawPayload: input.rawPayload
  });
}

export async function syncWhatsAppHistoryConversation(input: {
  workspaceId: string;
  phone?: string | null;
  displayName?: string | null;
  photoUrl?: string | null;
  unreadCount?: number;
  messages: Array<{
    id: string;
    author?: string | null;
    chatId?: string | null;
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
  const latestInboundRemoteId = [...input.messages]
    .reverse()
    .map((message) => extractWhatsAppRemoteId(message.rawPayload ?? message, phone))
    .find((value): value is string => Boolean(value));
  const existingConversationByRemote = latestInboundRemoteId
    ? await prisma.conversation.findFirst({
        where: {
          workspaceId: input.workspaceId,
          whatsAppRemoteId: latestInboundRemoteId
        },
        select: {
          id: true,
          contactId: true,
          contact: {
            select: {
              id: true,
              phone: true
            }
          }
        }
      })
    : null;

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

  const sortedMessages = [...input.messages].sort(
    (left, right) => (left.timestamp ?? 0) - (right.timestamp ?? 0)
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
      photoUrl: input.photoUrl?.trim() || existingContact?.photoUrl || null,
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
  const existingConversation =
    (await prisma.conversation.findFirst({
      where: {
        workspaceId: input.workspaceId,
        contactId: contact.id
      },
      orderBy: {
        updatedAt: "desc"
      }
    })) ??
    null;
  const conversation =
    existingConversation ??
    (await prisma.conversation.create({
      data: {
        workspaceId: input.workspaceId,
        contactId: contact.id,
        whatsAppRemoteId: latestInboundRemoteId ?? null,
        status: ConversationStatus.OPEN,
        unreadCount: 0,
        isHotLead: false,
        lastMessagePreview: latestMessagePreview,
        lastMessageAt: sortedMessages.length
          ? new Date((sortedMessages[sortedMessages.length - 1].timestamp ?? Date.now() / 1000) * 1000)
          : new Date()
      }
    }));
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
        conversationId: conversation.id,
        messageId: exists.id,
        providerMessageId,
        body: sanitizeSyncedMessageText(getSyncedMessageBody(message)) || message.body || null,
        direction: message.fromMe ? "OUTBOUND" : "INBOUND",
        sentAt: new Date((message.timestamp ?? Date.now() / 1000) * 1000),
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

    const createdMessage = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        providerMessageId,
        direction: message.fromMe ? MessageDirection.OUTBOUND : MessageDirection.INBOUND,
        body,
        attachmentMimeType: message.attachmentMimeType ?? null,
        attachmentName: message.attachmentName ?? null,
        attachmentUrl: message.attachmentUrl ?? null,
        rawPayload: JSON.stringify(message.rawPayload ?? message),
        sentAt
      }
    });

    await upsertWhatsAppMessageEnvelopeFromPayload({
      workspaceId: input.workspaceId,
      conversationId: conversation.id,
      messageId: createdMessage.id,
      providerMessageId,
      body,
      direction: message.fromMe ? "OUTBOUND" : "INBOUND",
      sentAt,
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

  await prisma.$transaction(async (tx) => {
    await tx.conversation.update({
      where: {
        id: conversation.id
      },
      data: {
        whatsAppRemoteId: latestInboundRemoteId ?? conversation.whatsAppRemoteId ?? null,
        status: ConversationStatus.OPEN,
        unreadCount: input.unreadCount ?? conversation.unreadCount,
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
        photoUrl: input.photoUrl?.trim() || contact.photoUrl,
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

  return {
    conversationId: conversation.id,
    importedCount
  };
}

async function createInboundConversationMessage(input: {
  workspaceId: string;
  providerMessageId: string;
  direction: "INBOUND" | "OUTBOUND";
  body: string;
  attachmentMimeType?: string | null;
  attachmentName?: string | null;
  attachmentUrl?: string | null;
  sentAt: Date;
  phone?: string;
  displayName?: string;
  photoUrl?: string;
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

  if (!input.conversationId && inboundRemoteId) {
    const existingConversationByRemote = await prisma.conversation.findFirst({
      where: {
        workspaceId: input.workspaceId,
        whatsAppRemoteId: inboundRemoteId
      },
      include: {
        contact: true
      }
    });

    if (existingConversationByRemote) {
      contactId = existingConversationByRemote.contactId;
      conversationId = existingConversationByRemote.id;

      if (input.displayName || input.photoUrl) {
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
            ...(input.photoUrl ? { photoUrl: input.photoUrl } : {})
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

    if (input.displayName || input.photoUrl) {
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
          ...(input.photoUrl ? { photoUrl: input.photoUrl } : {})
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
        ...(input.photoUrl ? { photoUrl: input.photoUrl } : existingContact?.photoUrl ? { photoUrl: existingContact.photoUrl } : {}),
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
        photoUrl: input.photoUrl || null,
        tags: input.isTest ? "whatsapp, simulated, automation-test" : "whatsapp, simulated",
        syncedTags: input.isTest ? "whatsapp, simulated, automation-test" : "whatsapp, simulated",
        lastInteractionAt: input.sentAt
      }
    });

    const conversation =
      (await prisma.conversation.findFirst({
        where: {
          workspaceId: input.workspaceId,
          contactId: contact.id
        },
        orderBy: {
          updatedAt: "desc"
        }
      })) ??
      (await prisma.conversation.create({
        data: {
          workspaceId: input.workspaceId,
          contactId: contact.id,
          whatsAppRemoteId: inboundRemoteId ?? null,
          status: ConversationStatus.OPEN,
          unreadCount: 0,
          isHotLead: false,
          lastMessagePreview: input.body,
          lastMessageAt: input.sentAt
        }
      }));

    contactId = contact.id;
    conversationId = conversation.id;
  }

  let createdMessageId = "";

  await prisma.$transaction(async (tx) => {
    const conversation = await tx.conversation.findUnique({
      where: {
        id: conversationId
      },
      select: {
        unreadCount: true
      }
    });

    if (!conversation) {
      throw new Error("Conversation not found.");
    }

    const createdMessage = await tx.message.create({
      data: {
        conversationId,
        providerMessageId: input.providerMessageId,
        direction:
          input.direction === "OUTBOUND" ? MessageDirection.OUTBOUND : MessageDirection.INBOUND,
        body: input.body,
        attachmentMimeType: input.attachmentMimeType ?? null,
        attachmentName: input.attachmentName ?? null,
        attachmentUrl: input.attachmentUrl ?? null,
        rawPayload: JSON.stringify(input.rawPayload),
        sentAt: input.sentAt
      }
    });
    createdMessageId = createdMessage.id;

    const nextUnreadCount =
      input.direction === "OUTBOUND" ? conversation.unreadCount : conversation.unreadCount + 1;
    const hotLead = await shouldMarkHotLead(tx, input.workspaceId, conversationId, contactId);

    await tx.conversation.update({
      where: {
        id: conversationId
      },
      data: {
        whatsAppRemoteId: inboundRemoteId ?? undefined,
        status: ConversationStatus.OPEN,
        unreadCount: nextUnreadCount,
        isHotLead: hotLead,
        lastMessagePreview: input.body,
        lastMessageAt: input.sentAt
      }
    });

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
    conversationId,
    messageId: createdMessageId || null,
    providerMessageId: input.providerMessageId,
    body: input.body,
    direction: input.direction ?? "INBOUND",
    sentAt: input.sentAt,
    attachmentMimeType: input.attachmentMimeType ?? null,
    attachmentName: input.attachmentName ?? null,
    attachmentUrl: input.attachmentUrl ?? null,
    rawPayload: input.rawPayload
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

function extractWhatsAppRemoteId(rawPayload: unknown, phone?: string | null) {
  const parsed = rawPayload && typeof rawPayload === "object" ? (rawPayload as Record<string, unknown>) : null;
  const candidates = [
    parsed?.chatId,
    parsed?.remote,
    parsed?.from,
    parsed?.author,
    parsed?.id && typeof parsed.id === "object" ? (parsed.id as Record<string, unknown>).remote : null,
    parsed?.id && typeof parsed.id === "object" ? (parsed.id as Record<string, unknown>)._serialized : null
  ];
  const resolvedCandidates: string[] = [];

  for (const candidate of candidates) {
    if (typeof candidate !== "string") {
      continue;
    }

    const trimmed = candidate.trim();
    if (/@(?:lid|c\.us|g\.us)$/.test(trimmed)) {
      resolvedCandidates.push(trimmed);
      continue;
    }

    const serializedMatch = trimmed.match(/^false_(.+@(?:lid|c\.us|g\.us))_/);
    if (serializedMatch) {
      resolvedCandidates.push(serializedMatch[1]);
    }
  }

  const preferredGroupCandidate = resolvedCandidates.find((candidate) => candidate.endsWith("@g.us"));
  if (preferredGroupCandidate) {
    return preferredGroupCandidate;
  }

  if (resolvedCandidates.length > 0) {
    return resolvedCandidates[0];
  }

  const normalizedPhone = phone ? normalizeStoredPhone(phone) : null;
  return normalizedPhone ? `${normalizedPhone}@c.us` : null;
}

function readStringField(value: unknown, key: string) {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  return typeof record?.[key] === "string" ? (record[key] as string) : null;
}

function readBooleanField(value: unknown, key: string) {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  return typeof record?.[key] === "boolean" ? (record[key] as boolean) : null;
}
