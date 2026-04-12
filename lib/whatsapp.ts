import crypto from "node:crypto";
import { ConversationStatus, MessageDirection } from "@prisma/client";
import { processInboundAutomation } from "@/lib/automation-engine";
import { prisma } from "@/lib/prisma";
import { normalizeStoredPhone } from "@/lib/phone";

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
    body: normalizedBody,
    sentAt,
    phone: input.phone ? normalizeStoredPhone(input.phone) : undefined,
    displayName: input.displayName?.trim() || undefined,
    conversationId: input.conversationId ?? undefined,
    ignoreAutomationPause: input.ignoreAutomationPause,
    rawPayload: {
      source: "simulated-inbound",
      body: normalizedBody
    }
  });
}

export async function ingestWhatsAppClientMessage(input: {
  workspaceId: string;
  providerMessageId: string;
  body: string;
  phone?: string | null;
  displayName?: string | null;
  photoUrl?: string | null;
  sentAt?: Date | null;
  rawPayload: unknown;
}) {
  const normalizedBody = input.body.trim();
  if (!normalizedBody) {
    throw new Error("Message body is required.");
  }

  if (!input.phone) {
    throw new Error("Phone is required.");
  }

  return createInboundConversationMessage({
    workspaceId: input.workspaceId,
    providerMessageId: input.providerMessageId,
    body: normalizedBody,
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
      displayName: true,
      syncedDisplayName: true,
      displayNameManualOverride: true,
      lastInteractionAt: true
    }
  });

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
        status: ConversationStatus.OPEN,
        unreadCount: 0,
        isHotLead: false,
        lastMessagePreview: sortedMessages[sortedMessages.length - 1]
          ? getSyncedMessageBody(sortedMessages[sortedMessages.length - 1])
          : null,
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
      continue;
    }

    const body = getSyncedMessageBody(message);
    const sentAt = new Date((message.timestamp ?? Date.now() / 1000) * 1000);

    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        providerMessageId,
        direction: message.fromMe ? MessageDirection.OUTBOUND : MessageDirection.INBOUND,
        body,
        rawPayload: JSON.stringify(message.rawPayload ?? message),
        sentAt
      }
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

  await prisma.$transaction([
    prisma.conversation.update({
      where: {
        id: conversation.id
      },
      data: {
        status: ConversationStatus.OPEN,
        unreadCount: input.unreadCount ?? conversation.unreadCount,
        isHotLead: hotLead,
        lastMessagePreview: latestMessage ? getSyncedMessageBody(latestMessage) : conversation.lastMessagePreview,
        lastMessageAt: latestMessage
          ? new Date((latestMessage.timestamp ?? Date.now() / 1000) * 1000)
          : conversation.lastMessageAt
      }
    }),
    prisma.contact.update({
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
    })
  ]);

  return {
    conversationId: conversation.id,
    importedCount
  };
}

async function createInboundConversationMessage(input: {
  workspaceId: string;
  providerMessageId: string;
  body: string;
  sentAt: Date;
  phone?: string;
  displayName?: string;
  photoUrl?: string;
  conversationId?: string;
  ignoreAutomationPause?: boolean;
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

  if (input.conversationId) {
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

    if (input.displayName && input.displayName !== existingConversation.contact.displayName) {
      const syncedDisplayName = input.displayName;
      await prisma.contact.update({
        where: {
          id: existingConversation.contactId
        },
        data: {
          ...(existingConversation.contact.displayNameManualOverride
            ? {}
            : { displayName: syncedDisplayName }),
          syncedDisplayName,
          ...(input.photoUrl ? { photoUrl: input.photoUrl } : {})
        }
      });
    }
  } else {
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
        lastInteractionAt: input.sentAt
      },
      create: {
        workspaceId: input.workspaceId,
        displayName: input.displayName || input.phone,
        syncedDisplayName: input.displayName || input.phone,
        phone: input.phone,
        photoUrl: input.photoUrl || null,
        tags: "whatsapp, simulated",
        syncedTags: "whatsapp, simulated",
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

    await tx.message.create({
      data: {
        conversationId,
        providerMessageId: input.providerMessageId,
        direction: MessageDirection.INBOUND,
        body: input.body,
        rawPayload: JSON.stringify(input.rawPayload),
        sentAt: input.sentAt
      }
    });

    const nextUnreadCount = conversation.unreadCount + 1;
    const hotLead = await shouldMarkHotLead(tx, input.workspaceId, conversationId, contactId);

    await tx.conversation.update({
      where: {
        id: conversationId
      },
      data: {
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

  await processInboundAutomation({
    workspaceId: input.workspaceId,
    conversationId,
    inboundText: input.body,
    sentAt: input.sentAt,
    ignorePausedState: input.ignoreAutomationPause
  });

  return {
    conversationId,
    providerMessageId: input.providerMessageId
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
  type?: string | null;
  hasMedia?: boolean;
}) {
  const body = message.body?.trim();
  if (body) {
    return body;
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
    default:
      return message.hasMedia ? "[Media]" : "[Unsupported message]";
  }
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
