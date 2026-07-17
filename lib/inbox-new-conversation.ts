import { randomUUID } from "node:crypto";
import { applyHumanTakeoverPause } from "@/lib/automation-engine";
import { requireCurrentApiAgent } from "@/lib/auth/current-user";
import { ConversationStatus, MessageDirection } from "@/lib/db-types";
import { emitMessageToInbox } from "@/lib/inbox-realtime";
import { buildStoredPhone, normalizeStoredPhone } from "@/lib/phone";
import { prisma } from "@/lib/prisma";
import { canStartUnsavedNumberConversation, getWhatsAppChannelStatusById } from "@/lib/whatsapp-channel";
import {
  findOrCreateReusableConversation,
  insertMessageRecord,
  resolveInboxRealtimeChannelKind,
  resolveSafeConversationRemoteId
} from "@/lib/whatsapp";
import { sendWhatsAppWebMessage } from "@/lib/whatsapp-web";

type NewConversationRequestStatus = "PENDING" | "ACCEPTED" | "SUCCEEDED" | "FAILED";

type StoredNewConversationRequest = {
  id: string;
  workspaceId: string;
  agentId: string;
  channelId: string;
  idempotencyKey: string;
  phone: string;
  displayName: string | null;
  messageBody: string;
  status: NewConversationRequestStatus;
  providerMessageId: string | null;
  contactId: string | null;
  conversationId: string | null;
  messageId: string | null;
  wasExistingContact: boolean | null;
  wasExistingConversation: boolean | null;
  errorCode: string | null;
  errorMessage: string | null;
};

type StartNewConversationInput = {
  channelId: string;
  countryCode?: string | null;
  phoneNumber: string;
  displayName?: string | null;
  messageText: string;
  idempotencyKey: string;
};

export class NewConversationError extends Error {
  code: string;
  status: number;
  details: Record<string, unknown> | null;

  constructor(code: string, message: string, status = 400, details: Record<string, unknown> | null = null) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export async function startInboxConversationWithNewNumber(input: StartNewConversationInput) {
  const agent = await requireCurrentApiAgent();
  const normalizedMessageText = input.messageText.trim();
  const normalizedChannelId = input.channelId.trim();
  const normalizedIdempotencyKey = input.idempotencyKey.trim();
  const normalizedPhone = normalizeNewConversationPhoneInput({
    countryCode: input.countryCode,
    phoneNumber: input.phoneNumber
  });
  const normalizedDisplayName = input.displayName?.trim() || null;

  if (!normalizedChannelId) {
    throw new NewConversationError("NEW_NUMBER_CONVERSATION_INVALID_CHANNEL", "Choose a valid WhatsApp number.");
  }

  if (!normalizedIdempotencyKey) {
    throw new NewConversationError(
      "NEW_NUMBER_CONVERSATION_INVALID_IDEMPOTENCY_KEY",
      "Request key is missing."
    );
  }

  if (!normalizedMessageText) {
    throw new NewConversationError("NEW_NUMBER_CONVERSATION_EMPTY_MESSAGE", "First message is required.");
  }

  const channel = await getWhatsAppChannelStatusById(normalizedChannelId);
  if (!channel || channel.workspaceId !== agent.workspaceId) {
    throw new NewConversationError("NEW_NUMBER_CONVERSATION_CHANNEL_NOT_FOUND", "WhatsApp channel was not found.", 404);
  }

  if (!canStartUnsavedNumberConversation(channel)) {
    throw new NewConversationError(
      "NEW_NUMBER_CONVERSATION_UNSUPPORTED_CHANNEL",
      "Starting a conversation with an unsaved number is supported only for active WhatsApp Web connections linked by QR code.",
      409
    );
  }

  if (normalizedPhone === normalizeStoredPhone(channel.phoneNumber ?? "")) {
    throw new NewConversationError(
      "NEW_NUMBER_CONVERSATION_SELF_NUMBER",
      "You cannot start a conversation with the selected sender number."
    );
  }

  const existingContact = await prisma.contact.findFirst({
    where: {
      workspaceId: agent.workspaceId,
      phone: normalizedPhone
    },
    select: {
      id: true,
      displayName: true,
      phone: true
    }
  });

  if (existingContact) {
    const contactLabel = existingContact.displayName.trim() || existingContact.phone;
    throw new NewConversationError(
      "NEW_NUMBER_CONVERSATION_CONTACT_EXISTS",
      `This number already belongs to ${contactLabel}. Open the existing contact conversation instead.`,
      409,
      {
        existingContact
      }
    );
  }

  const requestState = await findOrCreateNewConversationRequest({
    workspaceId: agent.workspaceId,
    agentId: agent.id,
    channelId: channel.id,
    idempotencyKey: normalizedIdempotencyKey,
    phone: normalizedPhone,
    displayName: normalizedDisplayName,
    messageBody: normalizedMessageText
  });
  const { request, isNew } = requestState;

  assertIdempotencyPayloadMatches(request, {
    channelId: channel.id,
    phone: normalizedPhone,
    displayName: normalizedDisplayName,
    messageBody: normalizedMessageText
  });

  if (request.status === "SUCCEEDED" && request.conversationId && request.messageId) {
    return buildSuccessfulResponse(request);
  }

  if (request.status === "FAILED") {
    throw new NewConversationError(
      request.errorCode ?? "NEW_NUMBER_CONVERSATION_FAILED",
      request.errorMessage ?? "Unable to start the conversation.",
      409
    );
  }

  let providerMessageId = request.providerMessageId;

  if (!isNew && request.status === "PENDING" && !providerMessageId) {
    throw new NewConversationError(
      "NEW_NUMBER_CONVERSATION_REQUEST_IN_PROGRESS",
      "This conversation request is already being processed. Try again in a moment.",
      409
    );
  }

  if (!providerMessageId) {
    try {
      const sendResult = await sendWhatsAppWebMessage({
        workspaceId: agent.workspaceId,
        channelId: channel.id,
        conversationId: `new-conversation:${agent.workspaceId}:${normalizedPhone}`,
        to: normalizedPhone,
        body: normalizedMessageText
      });
      providerMessageId = sendResult.providerMessageId;
      await markNewConversationRequestAccepted(request.id, providerMessageId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to send WhatsApp message.";
      await markNewConversationRequestFailed(request.id, "NEW_NUMBER_CONVERSATION_PROVIDER_REJECTED", message);
      throw new NewConversationError("NEW_NUMBER_CONVERSATION_PROVIDER_REJECTED", message, 409);
    }
  }

  const finalized = await finalizeAcceptedNewConversationRequest({
    requestId: request.id,
    workspaceId: agent.workspaceId,
    agentId: agent.id,
    channelId: channel.id,
    phone: normalizedPhone,
    displayName: normalizedDisplayName,
    messageBody: normalizedMessageText,
    providerMessageId
  });

  await applyHumanTakeoverPause({
    workspaceId: agent.workspaceId,
    conversationId: finalized.conversation.id,
    pausedAt: finalized.message.sentAt
  });

  await emitMessageToInbox({
    channel: await resolveInboxRealtimeChannelKind(channel.id, {
      source: "inbox-new-conversation"
    }),
    workspaceId: agent.workspaceId,
    channelId: channel.id,
    conversationId: finalized.conversation.id,
    messageId: finalized.message.id,
    from: normalizedPhone,
    message: normalizedMessageText,
    direction: "OUTBOUND",
    timestamp: finalized.message.sentAt.toISOString()
  });

  return {
    channel: {
      id: channel.id,
      label: channel.displayName ?? channel.phoneNumber ?? channel.id
    },
    contact: finalized.contact,
    conversation: finalized.conversation,
    message: finalized.message,
    wasExistingContact: finalized.wasExistingContact,
    wasExistingConversation: finalized.wasExistingConversation,
    providerAccepted: true
  };
}

export function normalizeNewConversationPhoneInput(input: {
  countryCode?: string | null;
  phoneNumber: string;
}) {
  const phoneNumber = input.phoneNumber.trim();
  const countryCodeInput = `${input.countryCode ?? ""}`.trim();
  const countryCode = normalizeStoredPhone(countryCodeInput);
  const digitsOnly = normalizeStoredPhone(phoneNumber);

  if ((countryCodeInput && !/^[+\s\d]+$/.test(countryCodeInput)) || !/^[+()\-\s\d]+$/.test(phoneNumber)) {
    throw new NewConversationError("NEW_NUMBER_CONVERSATION_INVALID_PHONE", "Phone number is invalid.");
  }

  if (!digitsOnly) {
    throw new NewConversationError("NEW_NUMBER_CONVERSATION_INVALID_PHONE", "Phone number is required.");
  }

  const normalizedPhone = countryCode ? buildStoredPhone(countryCode, phoneNumber) : digitsOnly;

  if (!normalizedPhone || normalizedPhone.length < 8 || normalizedPhone.length > 16) {
    throw new NewConversationError("NEW_NUMBER_CONVERSATION_INVALID_PHONE", "Phone number is invalid.");
  }

  return normalizedPhone;
}

async function finalizeAcceptedNewConversationRequest(input: {
  requestId: string;
  workspaceId: string;
  agentId: string;
  channelId: string;
  phone: string;
  displayName: string | null;
  messageBody: string;
  providerMessageId: string;
}) {
  const existingMessage = await prisma.message.findUnique({
    where: {
      providerMessageId: input.providerMessageId
    },
    select: {
      id: true,
      body: true,
      sentAt: true,
      conversation: {
        select: {
          id: true,
          contact: {
            select: {
              id: true,
              displayName: true,
              phone: true
            }
          }
        }
      }
    }
  });

  if (existingMessage?.conversation?.contact) {
    await markNewConversationRequestSucceeded({
      requestId: input.requestId,
      contactId: existingMessage.conversation.contact.id,
      conversationId: existingMessage.conversation.id,
      messageId: existingMessage.id,
      wasExistingContact: true,
      wasExistingConversation: true
    });

    return {
      contact: existingMessage.conversation.contact,
      conversation: { id: existingMessage.conversation.id },
      message: {
        id: existingMessage.id,
        body: existingMessage.body,
        sentAt: existingMessage.sentAt
      },
      wasExistingContact: true,
      wasExistingConversation: true
    };
  }

  const sentAt = new Date();
  let result;
  try {
    result = await prisma.$transaction(async (tx) => {
      const existingContact = await tx.contact.findFirst({
        where: {
          workspaceId: input.workspaceId,
          phone: input.phone
        },
        select: {
          id: true,
          displayName: true,
          phone: true
        }
      });

      const contact = await tx.contact.upsert({
        where: {
          workspaceId_phone: {
            workspaceId: input.workspaceId,
            phone: input.phone
          }
        },
        update: {
          lastInteractionAt: sentAt
        },
        create: {
          workspaceId: input.workspaceId,
          ownerId: input.agentId,
          displayName: input.displayName || input.phone,
          syncedDisplayName: input.displayName || input.phone,
          phone: input.phone,
          tags: "",
          lastInteractionAt: sentAt
        },
        select: {
          id: true,
          displayName: true,
          phone: true
        }
      });

      const existingConversation = await tx.conversation.findFirst({
        where: {
          workspaceId: input.workspaceId,
          contactId: contact.id,
          OR: [{ channelId: input.channelId }, { channelId: null }]
        },
        select: {
          id: true
        },
        orderBy: [{ updatedAt: "desc" }, { lastMessageAt: "desc" }]
      });

      const conversation = await findOrCreateReusableConversation({
        executor: tx,
        workspaceId: input.workspaceId,
        channelId: input.channelId,
        contactId: contact.id,
        phone: input.phone,
        whatsAppRemoteId: `${input.phone}@c.us`,
        lastMessagePreview: input.messageBody,
        lastMessageAt: sentAt
      });

      await tx.conversation.update({
        where: {
          id: conversation.id
        },
        data: {
          channelId: input.channelId,
          status: ConversationStatus.OPEN,
          whatsAppRemoteId: resolveSafeConversationRemoteId({
            candidateRemoteId: `${input.phone}@c.us`,
            currentRemoteId: conversation.whatsAppRemoteId,
            contactPhone: input.phone
          }),
          lastMessagePreview: input.messageBody,
          lastMessageAt: sentAt
        }
      });

      const createdMessage = await insertMessageRecord(tx, {
        conversationId: conversation.id,
        providerMessageId: input.providerMessageId,
        direction: MessageDirection.OUTBOUND,
        body: input.messageBody,
        mediaAssetId: null,
        attachmentMimeType: null,
        attachmentName: null,
        attachmentUrl: null,
        rawPayload: JSON.stringify({
          source: "inbox-new-conversation",
          channelId: input.channelId,
          to: input.phone,
          providerMessageId: input.providerMessageId
        }),
        sentAt
      });

      await tx.contact.update({
        where: {
          id: contact.id
        },
        data: {
          lastInteractionAt: sentAt
        }
      });

      return {
        contact,
        conversation: {
          id: conversation.id
        },
        message: {
          id: createdMessage.id,
          body: input.messageBody,
          sentAt
        },
        wasExistingContact: Boolean(existingContact),
        wasExistingConversation: Boolean(existingConversation)
      };
    });
  } catch (error) {
    if (!isProviderMessageConflictError(error)) {
      throw error;
    }

    const persisted = await loadPersistedMessageResult(input.providerMessageId, input.requestId);
    if (!persisted) {
      throw error;
    }

    return persisted;
  }

  await markNewConversationRequestSucceeded({
    requestId: input.requestId,
    contactId: result.contact.id,
    conversationId: result.conversation.id,
    messageId: result.message.id,
    wasExistingContact: result.wasExistingContact,
    wasExistingConversation: result.wasExistingConversation
  });

  return result;
}

async function loadPersistedMessageResult(providerMessageId: string, requestId: string) {
  const existingMessage = await prisma.message.findUnique({
    where: {
      providerMessageId
    },
    select: {
      id: true,
      body: true,
      sentAt: true,
      conversation: {
        select: {
          id: true,
          contact: {
            select: {
              id: true,
              displayName: true,
              phone: true
            }
          }
        }
      }
    }
  });

  if (!existingMessage?.conversation?.contact) {
    return null;
  }

  await markNewConversationRequestSucceeded({
    requestId,
    contactId: existingMessage.conversation.contact.id,
    conversationId: existingMessage.conversation.id,
    messageId: existingMessage.id,
    wasExistingContact: true,
    wasExistingConversation: true
  });

  return {
    contact: existingMessage.conversation.contact,
    conversation: { id: existingMessage.conversation.id },
    message: {
      id: existingMessage.id,
      body: existingMessage.body,
      sentAt: existingMessage.sentAt
    },
    wasExistingContact: true,
    wasExistingConversation: true
  };
}

async function buildSuccessfulResponse(request: StoredNewConversationRequest) {
  const [contact, conversation, message, channel] = await Promise.all([
    request.contactId
      ? prisma.contact.findUnique({
          where: {
            id: request.contactId
          },
          select: {
            id: true,
            displayName: true,
            phone: true
          }
        })
      : null,
    request.conversationId
      ? prisma.conversation.findUnique({
          where: {
            id: request.conversationId
          },
          select: {
            id: true
          }
        })
      : null,
    request.messageId
      ? prisma.message.findUnique({
          where: {
            id: request.messageId
          },
          select: {
            id: true,
            body: true,
            sentAt: true
          }
        })
      : null,
    getWhatsAppChannelStatusById(request.channelId)
  ]);

  if (!contact || !conversation || !message || !channel) {
    throw new NewConversationError(
      "NEW_NUMBER_CONVERSATION_RESULT_MISSING",
      "Conversation was sent, but the saved result could not be loaded.",
      409
    );
  }

  return {
    channel: {
      id: channel.id,
      label: channel.displayName ?? channel.phoneNumber ?? channel.id
    },
    contact,
    conversation,
    message,
    wasExistingContact: request.wasExistingContact === true,
    wasExistingConversation: request.wasExistingConversation === true,
    providerAccepted: true
  };
}

function assertIdempotencyPayloadMatches(
  request: StoredNewConversationRequest,
  input: {
    channelId: string;
    phone: string;
    displayName: string | null;
    messageBody: string;
  }
) {
  if (
    request.channelId !== input.channelId ||
    request.phone !== input.phone ||
    request.messageBody !== input.messageBody ||
    (request.displayName ?? null) !== input.displayName
  ) {
    throw new NewConversationError(
      "NEW_NUMBER_CONVERSATION_IDEMPOTENCY_CONFLICT",
      "This request key is already being used for a different conversation payload.",
      409
    );
  }
}

async function findOrCreateNewConversationRequest(input: {
  workspaceId: string;
  agentId: string;
  channelId: string;
  idempotencyKey: string;
  phone: string;
  displayName: string | null;
  messageBody: string;
}) {
  const inserted = await prisma.$queryRawUnsafe<Array<StoredNewConversationRequest>>(
    `INSERT INTO "InboxNewConversationRequest" (
      id, "workspaceId", "agentId", "channelId", "idempotencyKey", phone, "displayName", "messageBody", status, "createdAt", "updatedAt"
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'PENDING', NOW(), NOW())
    ON CONFLICT ("workspaceId", "idempotencyKey") DO NOTHING
    RETURNING *`,
    randomUUID().replace(/-/g, ""),
    input.workspaceId,
    input.agentId,
    input.channelId,
    input.idempotencyKey,
    input.phone,
    input.displayName,
    input.messageBody
  );

  if (inserted[0]) {
    return {
      request: inserted[0],
      isNew: true
    };
  }

  const existing = await prisma.$queryRawUnsafe<Array<StoredNewConversationRequest>>(
    `SELECT *
     FROM "InboxNewConversationRequest"
     WHERE "workspaceId" = $1
       AND "idempotencyKey" = $2
     LIMIT 1`,
    input.workspaceId,
    input.idempotencyKey
  );

  const request = existing[0];
  if (!request) {
    throw new NewConversationError("NEW_NUMBER_CONVERSATION_REQUEST_MISSING", "Request state was not found.", 409);
  }

  return {
    request,
    isNew: false
  };
}

async function markNewConversationRequestAccepted(requestId: string, providerMessageId: string) {
  await prisma.$executeRawUnsafe(
    `UPDATE "InboxNewConversationRequest"
     SET status = 'ACCEPTED',
         "providerMessageId" = $2,
         "updatedAt" = NOW()
     WHERE id = $1`,
    requestId,
    providerMessageId
  );
}

async function markNewConversationRequestSucceeded(input: {
  requestId: string;
  contactId: string;
  conversationId: string;
  messageId: string;
  wasExistingContact: boolean;
  wasExistingConversation: boolean;
}) {
  await prisma.$executeRawUnsafe(
    `UPDATE "InboxNewConversationRequest"
     SET status = 'SUCCEEDED',
         "contactId" = $2,
         "conversationId" = $3,
         "messageId" = $4,
         "wasExistingContact" = $5,
         "wasExistingConversation" = $6,
         "updatedAt" = NOW()
     WHERE id = $1`,
    input.requestId,
    input.contactId,
    input.conversationId,
    input.messageId,
    input.wasExistingContact,
    input.wasExistingConversation
  );
}

async function markNewConversationRequestFailed(requestId: string, code: string, message: string) {
  await prisma.$executeRawUnsafe(
    `UPDATE "InboxNewConversationRequest"
     SET status = 'FAILED',
         "errorCode" = $2,
         "errorMessage" = $3,
         "updatedAt" = NOW()
     WHERE id = $1`,
    requestId,
    code,
    message
  );
}

function isProviderMessageConflictError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  const candidate = error as Error & { code?: string; meta?: { target?: string[] } };
  return (
    candidate.code === "P2002" ||
    candidate.message.includes("providerMessageId") ||
    candidate.message.includes("duplicate key")
  );
}
