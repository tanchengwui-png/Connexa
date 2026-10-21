import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getMetaWebhookVerifyToken } from "@/lib/meta-whatsapp";
import { getResolvedPlatformMetaConfig } from "@/lib/platform-config";
import { prisma } from "@/lib/prisma";
import { persistWhatsAppMessageAck } from "@/lib/whatsapp-ack";
import {
  getWebhookPhoneNumberId,
  ingestWhatsAppClientMessage
} from "@/lib/whatsapp";
import { assertWhatsAppCloudEnabled } from "@/lib/whatsapp-cloud/feature-flags";
import {
  buildMetaWebhookIdempotencyKey,
  sha256 as sha256Payload,
  verifyMetaWebhookSignature
} from "@/lib/whatsapp-cloud/security";
import { normalizeCloudMessage } from "@/services/messageNormalizer.js";

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function findChannelByVerifyToken(verifyToken: string) {
  if (!verifyToken.trim()) {
    return null;
  }

  const verifyTokenHash = sha256(verifyToken.trim());
  return prisma.whatsAppChannel.findFirst({
    where: {
      verifyTokenHash
    },
    select: {
      id: true,
      workspaceId: true
    }
  });
}

async function isDefaultMetaWebhookVerifyToken(verifyToken: string) {
  const defaultVerifyToken = await getMetaWebhookVerifyToken();
  return Boolean(defaultVerifyToken && defaultVerifyToken === verifyToken.trim());
}

async function findChannelByVerifiedContext(input: {
  phoneNumberId: string;
  messagingAccountId: string;
  integrationIdentity: string;
}) {
  if (!input.phoneNumberId.trim() || !input.integrationIdentity.trim()) {
    return null;
  }

  const channel = await prisma.whatsAppChannel.findFirst({
    where: {
      phoneNumberId: input.phoneNumberId.trim(),
      provider: "meta_direct",
      integrationIdentity: input.integrationIdentity.trim(),
      OR: input.messagingAccountId.trim()
        ? [
            { messagingAccountId: input.messagingAccountId.trim() },
            { legacyWabaId: input.messagingAccountId.trim() },
            { businessAccountId: input.messagingAccountId.trim() }
          ]
        : undefined
    },
    select: {
      id: true,
      workspaceId: true,
      phoneNumberId: true,
      integrationIdentity: true,
      messagingAccountId: true,
      waacId: true
    }
  });

  if (!channel) {
    return null;
  }

  return channel;
}

function getMessagingAccountId(payload: Record<string, unknown>) {
  for (const entry of Array.isArray(payload.entry) ? payload.entry : []) {
    if (entry && typeof entry === "object" && typeof (entry as { id?: unknown }).id === "string") {
      return ((entry as { id: string }).id ?? "").trim();
    }
  }
  return "";
}

async function reserveWebhookEvent(input: {
  channel: {
    id: string;
    workspaceId: string;
    integrationIdentity: string | null;
    messagingAccountId: string | null;
    waacId: string | null;
    phoneNumberId: string | null;
  };
  eventType: string;
  providerEventId: string;
  occurredAt: Date | null;
  payloadDigest: string;
}) {
  const integrationIdentity = input.channel.integrationIdentity ?? "";
  const idempotencyKey = buildMetaWebhookIdempotencyKey({
    integrationIdentity,
    providerEventId: input.providerEventId,
    eventType: input.eventType,
    occurredAt: input.occurredAt?.toISOString() ?? null,
    payloadDigest: input.payloadDigest
  });
  try {
    const event = await prisma.metaWebhookEvent.create({
      data: {
        workspaceId: input.channel.workspaceId,
        channelId: input.channel.id,
        provider: "meta_direct",
        integrationIdentity,
        waacId: input.channel.waacId,
        messagingAccountId: input.channel.messagingAccountId,
        phoneNumberId: input.channel.phoneNumberId,
        idempotencyKey,
        eventType: input.eventType,
        payloadDigest: input.payloadDigest,
        providerOccurredAt: input.occurredAt,
        processingStatus: "PROCESSING"
      },
      select: { id: true }
    });
    return event.id;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      return null;
    }
    throw error;
  }
}

function buildPersistableCloudMessages(payload: Record<string, unknown>) {
  const persistedMessages: Array<{
    normalized: ReturnType<typeof normalizeCloudMessage>;
    displayName?: string;
    providerMessageId: string;
    rawProviderMessageId: string;
    rawPayload: Record<string, unknown>;
  }> = [];

  for (const entry of Array.isArray(payload.entry) ? payload.entry : []) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    for (const change of Array.isArray((entry as { changes?: unknown[] }).changes) ? (entry as { changes?: unknown[] }).changes! : []) {
      if (!change || typeof change !== "object") {
        continue;
      }

      const field = typeof (change as { field?: unknown }).field === "string"
        ? (change as { field: string }).field.trim()
        : "";
      if (["history", "smb_app_state_sync", "smb_message_echoes"].includes(field)) {
        continue;
      }

      const value = (change as { value?: Record<string, unknown> }).value;
      if (!value || typeof value !== "object") {
        continue;
      }

      const metadata =
        value.metadata && typeof value.metadata === "object"
          ? (value.metadata as Record<string, unknown>)
          : {};
      const phoneNumberId =
        typeof metadata.phone_number_id === "string" ? metadata.phone_number_id.trim() : "";
      const contacts = Array.isArray(value.contacts) ? value.contacts : [];
      const messages = Array.isArray(value.messages) ? value.messages : [];
      const contactsByWaId = new Map(
        contacts
          .filter((contact): contact is Record<string, unknown> => Boolean(contact) && typeof contact === "object")
          .map((contact) => {
            const waId = typeof contact.wa_id === "string" ? contact.wa_id.trim() : "";
            const profile =
              contact.profile && typeof contact.profile === "object"
                ? (contact.profile as Record<string, unknown>)
                : {};
            const displayName = typeof profile.name === "string" ? profile.name.trim() : "";
            return [waId, displayName] as const;
          })
          .filter(([waId]) => Boolean(waId))
      );

      for (const message of messages) {
        if (!message || typeof message !== "object") {
          continue;
        }

        const rawProviderMessageId =
          typeof (message as { id?: unknown }).id === "string" ? ((message as { id?: string }).id ?? "").trim() : "";
        if (!rawProviderMessageId) {
          continue;
        }

        const normalized = normalizeCloudMessage({
          channel: "cloud",
          account_id: phoneNumberId,
          phone_number_id: phoneNumberId,
          metadata,
          message,
          from: (message as { from?: unknown }).from,
          timestamp: (message as { timestamp?: unknown }).timestamp,
          direction: "inbound"
        });

        if (!normalized.from || !normalized.message) {
          continue;
        }

        persistedMessages.push({
          normalized: {
            ...normalized,
            account_id: normalized.account_id || phoneNumberId
          },
          displayName: contactsByWaId.get(normalized.from) || undefined,
          providerMessageId: `cloud:${rawProviderMessageId}`,
          rawProviderMessageId,
          rawPayload: {
            source: "cloud-webhook",
            phoneNumberId,
            metadata,
            ...(message as Record<string, unknown>)
          }
        });
      }
    }
  }

  return persistedMessages;
}

function buildCoexistenceControlEvents(payload: Record<string, unknown>) {
  const events: Array<{ eventType: string; providerEventId: string }> = [];
  for (const entry of Array.isArray(payload.entry) ? payload.entry : []) {
    if (!entry || typeof entry !== "object") continue;
    const entryId = typeof (entry as { id?: unknown }).id === "string" ? (entry as { id: string }).id : "unknown";
    const changes = Array.isArray((entry as { changes?: unknown[] }).changes)
      ? (entry as { changes: unknown[] }).changes
      : [];
    changes.forEach((change, index) => {
      if (!change || typeof change !== "object") return;
      const field = typeof (change as { field?: unknown }).field === "string"
        ? (change as { field: string }).field.trim()
        : "";
      if (["history", "smb_app_state_sync", "smb_message_echoes"].includes(field)) {
        events.push({ eventType: field, providerEventId: `${entryId}:${field}:${index}` });
      }
    });
  }
  return events;
}

function buildCloudStatusUpdates(payload: Record<string, unknown>) {
  const updates: Array<{
    providerMessageId: string;
    rawProviderMessageId: string;
    status: string;
    timestamp: Date | null;
  }> = [];

  for (const entry of Array.isArray(payload.entry) ? payload.entry : []) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    for (const change of Array.isArray((entry as { changes?: unknown[] }).changes) ? (entry as { changes?: unknown[] }).changes! : []) {
      if (!change || typeof change !== "object") {
        continue;
      }

      const value = (change as { value?: Record<string, unknown> }).value;
      if (!value || typeof value !== "object") {
        continue;
      }

      for (const status of Array.isArray(value.statuses) ? value.statuses : []) {
        if (!status || typeof status !== "object") {
          continue;
        }

        const rawProviderMessageId = typeof (status as { id?: unknown }).id === "string" ? (status as { id: string }).id.trim() : "";
        const normalizedStatus = typeof (status as { status?: unknown }).status === "string" ? (status as { status: string }).status.trim().toLowerCase() : "";
        const timestampValue =
          typeof (status as { timestamp?: unknown }).timestamp === "string"
            ? Number((status as { timestamp: string }).timestamp)
            : typeof (status as { timestamp?: unknown }).timestamp === "number"
              ? (status as { timestamp: number }).timestamp
              : Number.NaN;

        if (!rawProviderMessageId || !normalizedStatus) {
          continue;
        }

        updates.push({
          providerMessageId: `cloud:${rawProviderMessageId}`,
          rawProviderMessageId,
          status: normalizedStatus,
          timestamp: Number.isFinite(timestampValue) ? new Date(timestampValue * 1000) : null
        });
      }
    }
  }

  return updates;
}

async function applyCloudStatusUpdates(channelId: string, updates: ReturnType<typeof buildCloudStatusUpdates>) {
  const channel = await prisma.whatsAppChannel.findUnique({
    where: {
      id: channelId
    },
    select: {
      workspaceId: true
    }
  });

  if (!channel) {
    return;
  }

  for (const update of updates) {
    const ack = update.status === "read" ? 3 : update.status === "delivered" ? 2 : update.status === "sent" ? 1 : null;

    if (ack === null) {
      continue;
    }

    await persistWhatsAppMessageAck({
      workspaceId: channel.workspaceId,
      channelId,
      providerMessageId: update.providerMessageId,
      ack,
      occurredAt: update.timestamp ?? new Date()
    });
  }
}

export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get("hub.mode") ?? "";
  const challenge = request.nextUrl.searchParams.get("hub.challenge") ?? "";
  const verifyToken = request.nextUrl.searchParams.get("hub.verify_token") ?? "";

  if (mode !== "subscribe" || !challenge || !verifyToken) {
    return new NextResponse("Invalid webhook verification request.", { status: 400 });
  }

  const channel = await findChannelByVerifyToken(verifyToken);
  if (!channel && !(await isDefaultMetaWebhookVerifyToken(verifyToken))) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  return new NextResponse(challenge, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8"
    }
  });
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    const platformConfig = await getResolvedPlatformMetaConfig();
    const integrationIdentity = platformConfig.appId.trim();
    const appSecret = platformConfig.appSecret.trim();
    if (!integrationIdentity || !appSecret) {
      return NextResponse.json({ error: "Meta webhook verification is not configured." }, { status: 503 });
    }
    const signature = request.headers.get("x-hub-signature-256");
    if (!verifyMetaWebhookSignature({ appSecret, rawBody, signatureHeader: signature })) {
      return NextResponse.json({ error: "Invalid webhook signature." }, { status: 401 });
    }

    const payload = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : {};
    const phoneNumberId = getWebhookPhoneNumberId(payload);
    const messagingAccountId = getMessagingAccountId(payload);

    if (!phoneNumberId?.trim()) {
      return NextResponse.json({ error: "Missing phone_number_id in webhook payload." }, { status: 400 });
    }

    const channel = await findChannelByVerifiedContext({
      phoneNumberId,
      messagingAccountId,
      integrationIdentity
    });
    if (!channel) {
      return NextResponse.json({ error: "No WhatsApp Cloud channel found for phone_number_id." }, { status: 404 });
    }

    assertWhatsAppCloudEnabled(channel.workspaceId);

    const messages = buildPersistableCloudMessages(payload);
    const statusUpdates = buildCloudStatusUpdates(payload);
    const coexistenceControlEvents = buildCoexistenceControlEvents(payload);
    const payloadDigest = sha256Payload(rawBody);
    const persistedEvents: Array<{
      channel: "cloud";
      workspaceId: string;
      channelId: string;
      conversationId: string | null;
      messageId: string | null;
      from: string;
      message: string;
      timestamp: string;
    }> = [];

    for (const message of messages) {
      const webhookEventId = await reserveWebhookEvent({
        channel,
        eventType: "message",
        providerEventId: message.rawProviderMessageId,
        occurredAt: message.normalized.timestamp,
        payloadDigest
      });
      if (!webhookEventId) {
        continue;
      }
      try {
        const from = message.normalized.from;
        if (!from) {
          continue;
        }

        const result = await ingestWhatsAppClientMessage({
          workspaceId: channel.workspaceId,
          channelId: channel.id,
          providerMessageId: message.providerMessageId,
          body: message.normalized.message,
          direction: "INBOUND",
          phone: from,
          displayName: message.displayName,
          sentAt: message.normalized.timestamp,
          rawPayload: message.rawPayload
        });

        persistedEvents.push({
          channel: "cloud",
          workspaceId: channel.workspaceId,
          channelId: channel.id,
          conversationId: result.conversationId,
          messageId: result.messageId,
          from,
          message: message.normalized.message,
          timestamp: message.normalized.timestamp.toISOString()
        });
        await prisma.metaWebhookEvent.update({
          where: { id: webhookEventId },
          data: { processingStatus: "PROCESSED", processedAt: new Date() }
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown ingest error.";
        if (errorMessage === "This inbound message has already been processed.") {
          await prisma.metaWebhookEvent.update({
            where: { id: webhookEventId },
            data: { processingStatus: "PROCESSED", processedAt: new Date() }
          });
          continue;
        }

        await prisma.metaWebhookEvent.update({
          where: { id: webhookEventId },
          data: { processingStatus: "FAILED", lastErrorCode: "INBOUND_INGEST_FAILED" }
        }).catch(() => null);

        throw error;
      }
    }

    for (const update of statusUpdates) {
      const webhookEventId = await reserveWebhookEvent({
        channel,
        eventType: `status:${update.status}`,
        providerEventId: update.rawProviderMessageId,
        occurredAt: update.timestamp,
        payloadDigest
      });
      if (!webhookEventId) {
        continue;
      }
      await applyCloudStatusUpdates(channel.id, [update]);
      await prisma.metaWebhookEvent.update({
        where: { id: webhookEventId },
        data: { processingStatus: "PROCESSED", processedAt: new Date() }
      });
    }

    for (const controlEvent of coexistenceControlEvents) {
      const webhookEventId = await reserveWebhookEvent({
        channel,
        eventType: controlEvent.eventType,
        providerEventId: controlEvent.providerEventId,
        occurredAt: null,
        payloadDigest
      });
      if (!webhookEventId) continue;
      const isEcho = controlEvent.eventType === "smb_message_echoes";
      await prisma.metaWebhookEvent.update({
        where: { id: webhookEventId },
        data: {
          processingStatus: isEcho ? "PROCESSED" : "DEFERRED",
          processedAt: isEcho ? new Date() : null,
          lastErrorCode: isEcho ? "AUTOMATION_SUPPRESSED" : "ASYNC_SYNC_PROCESSOR_NOT_ENABLED"
        }
      });
    }

    await prisma.whatsAppChannel.update({
      where: {
        id: channel.id
      },
      data: {
        lastWebhookAt: new Date(),
        lastSeenAt: new Date()
      } as any
    });

    return NextResponse.json(
      {
        ok: true,
        normalized: persistedEvents,
        statusUpdatesApplied: statusUpdates.length,
        coexistenceEventsRecorded: coexistenceControlEvents.length
      },
      { status: 200 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Webhook processing failed."
      },
      { status: 500 }
    );
  }
}
