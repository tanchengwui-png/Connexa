import { createHash } from "node:crypto";
import { decryptSecret } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";
import {
  getWebhookPhoneNumberId,
  ingestWhatsAppClientMessage,
  isValidWhatsappSignature
} from "@/lib/whatsapp";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function jsonResponse(res, statusCode, payload) {
  if (typeof res.status === "function" && typeof res.json === "function") {
    return res.status(statusCode).json(payload);
  }

  res.statusCode = statusCode;
  if (typeof res.setHeader === "function") {
    res.setHeader("Content-Type", "application/json");
  }
  res.end(JSON.stringify(payload));
}

function textResponse(res, statusCode, body) {
  if (typeof res.status === "function" && typeof res.send === "function") {
    return res.status(statusCode).send(body);
  }

  res.statusCode = statusCode;
  if (typeof res.setHeader === "function") {
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
  }
  res.end(body);
}

async function readRawBody(req) {
  if (typeof req.rawBody === "string") {
    return req.rawBody;
  }

  if (Buffer.isBuffer(req.rawBody)) {
    return req.rawBody.toString("utf8");
  }

  if (typeof req.body === "string") {
    return req.body;
  }

  if (Buffer.isBuffer(req.body)) {
    return req.body.toString("utf8");
  }

  if (req.body && typeof req.body === "object") {
    return JSON.stringify(req.body);
  }

  if (!req || typeof req.on !== "function") {
    return "";
  }

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }

  return Buffer.concat(chunks).toString("utf8");
}

function getQueryValue(req, key) {
  const queryValue = req?.query?.[key];
  if (typeof queryValue === "string") {
    return queryValue;
  }

  if (Array.isArray(queryValue)) {
    return typeof queryValue[0] === "string" ? queryValue[0] : "";
  }

  const requestUrl = req?.originalUrl || req?.url || "";
  const url = new URL(requestUrl, "http://127.0.0.1");
  return url.searchParams.get(key) ?? "";
}

function readHeader(req, name) {
  if (typeof req.get === "function") {
    return req.get(name);
  }

  const headers = req?.headers ?? {};
  const value = headers[name.toLowerCase()] ?? headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function normalizePhone(value) {
  return `${value ?? ""}`.replace(/\D+/g, "").trim();
}

function normalizeCloudMessageText(message) {
  if (message?.text?.body?.trim()) {
    return message.text.body.trim();
  }

  if (message?.button?.text?.trim()) {
    return message.button.text.trim();
  }

  if (message?.interactive?.button_reply?.title?.trim()) {
    return message.interactive.button_reply.title.trim();
  }

  if (message?.interactive?.list_reply?.title?.trim()) {
    return message.interactive.list_reply.title.trim();
  }

  if (message?.image?.caption?.trim()) {
    return message.image.caption.trim();
  }

  if (message?.video?.caption?.trim()) {
    return message.video.caption.trim();
  }

  switch (`${message?.type ?? ""}`.trim()) {
    case "image":
      return "[Image]";
    case "audio":
      return "[Audio]";
    case "video":
      return "[Video]";
    case "document":
      return "[Document]";
    case "location":
      return "[Location]";
    case "contacts":
      return "[Contact card]";
    case "reaction":
      return `[Reaction] ${message?.reaction?.emoji ?? ""}`.trim();
    case "sticker":
      return "[Sticker]";
    default:
      return "[Unsupported message]";
  }
}

function normalizeInboundEvents(payload) {
  const events = [];

  for (const entry of payload?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      const value = change?.value;
      const phoneNumberId = value?.metadata?.phone_number_id ?? null;
      const contactsByWaId = new Map(
        (value?.contacts ?? [])
          .filter((contact) => contact?.wa_id)
          .map((contact) => [
            contact.wa_id,
            {
              displayName: contact?.profile?.name?.trim() || contact.wa_id
            }
          ])
      );

      for (const message of value?.messages ?? []) {
        if (!message?.from || !message?.id) {
          continue;
        }

        const normalizedMessage = normalizeCloudMessageText(message);
        if (!normalizedMessage) {
          continue;
        }

        events.push({
          channel: "cloud",
          phoneNumberId,
          providerMessageId: `cloud:${message.id}`,
          rawProviderMessageId: message.id,
          from: normalizePhone(message.from),
          message: normalizedMessage,
          timestamp: message.timestamp ? new Date(Number(message.timestamp) * 1000) : new Date(),
          displayName: contactsByWaId.get(message.from)?.displayName ?? normalizePhone(message.from),
          rawPayload: message
        });
      }
    }
  }

  return events;
}

async function findChannelByVerifyToken(verifyToken) {
  if (!verifyToken?.trim()) {
    return null;
  }

  const verifyTokenHash = sha256(verifyToken.trim());
  return prisma.whatsAppChannel.findFirst({
    where: {
      verifyTokenHash
    },
    select: {
      id: true,
      workspaceId: true,
      verifyTokenHash: true
    }
  });
}

async function findChannelByPhoneNumberId(phoneNumberId) {
  if (!phoneNumberId?.trim()) {
    return null;
  }

  const channel = await prisma.whatsAppChannel.findFirst({
    where: {
      phoneNumberId: phoneNumberId.trim()
    },
    select: {
      id: true,
      workspaceId: true,
      phoneNumberId: true,
      appSecretCiphertext: true
    }
  });

  if (!channel) {
    return null;
  }

  return {
    ...channel,
    appSecret: channel.appSecretCiphertext ? decryptSecret(channel.appSecretCiphertext) : null
  };
}

async function emitRealtimeInboxEvents(events) {
  const emitter = global.connexaRealtimeEmitter;
  if (!emitter || typeof emitter.emit !== "function") {
    return;
  }

  for (const event of events) {
    emitter.emit("inbox:message", event);
    if (event.workspaceId) {
      emitter.emit(`workspace:${event.workspaceId}:inbox:message`, event);
    }
    if (event.conversationId) {
      emitter.emit(`conversation:${event.conversationId}:message`, event);
    }
  }
}

export async function handleCloudWebhookVerification(req, res) {
  const mode = getQueryValue(req, "hub.mode");
  const challenge = getQueryValue(req, "hub.challenge");
  const verifyToken = getQueryValue(req, "hub.verify_token");

  if (mode !== "subscribe" || !challenge || !verifyToken) {
    return textResponse(res, 400, "Invalid webhook verification request.");
  }

  const channel = await findChannelByVerifyToken(verifyToken);
  if (!channel) {
    return textResponse(res, 403, "Forbidden");
  }

  return textResponse(res, 200, challenge);
}

export async function handleCloudWebhookEvent(req, res) {
  try {
    const rawBody = await readRawBody(req);
    const payload = rawBody ? JSON.parse(rawBody) : {};
    const phoneNumberId = getWebhookPhoneNumberId(payload);

    if (!phoneNumberId) {
      return jsonResponse(res, 400, { error: "Missing phone_number_id in webhook payload." });
    }

    const channel = await findChannelByPhoneNumberId(phoneNumberId);
    if (!channel) {
      return jsonResponse(res, 404, { error: "No WhatsApp Cloud channel found for phone_number_id." });
    }

    const signature = readHeader(req, "x-hub-signature-256");
    if (channel.appSecret && !isValidWhatsappSignature(rawBody, signature, channel.appSecret)) {
      return jsonResponse(res, 401, { error: "Invalid webhook signature." });
    }

    const normalizedEvents = normalizeInboundEvents(payload);
    const persistedEvents = [];

    for (const event of normalizedEvents) {
      try {
        const result = await ingestWhatsAppClientMessage({
          workspaceId: channel.workspaceId,
          channelId: channel.id,
          providerMessageId: event.providerMessageId,
          body: event.message,
          direction: "INBOUND",
          phone: event.from,
          displayName: event.displayName,
          sentAt: event.timestamp,
          rawPayload: {
            source: "cloud-webhook",
            phoneNumberId: event.phoneNumberId,
            providerMessageId: event.rawProviderMessageId,
            ...event.rawPayload
          }
        });

        persistedEvents.push({
          channel: "cloud",
          workspaceId: channel.workspaceId,
          channelId: channel.id,
          conversationId: result.conversationId,
          messageId: result.messageId,
          from: event.from,
          message: event.message,
          timestamp: event.timestamp.toISOString()
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown ingest error.";
        if (message === "This inbound message has already been processed.") {
          continue;
        }

        throw error;
      }
    }

    await emitRealtimeInboxEvents(persistedEvents);

    return jsonResponse(res, 200, {
      ok: true,
      normalized: persistedEvents
    });
  } catch (error) {
    return jsonResponse(res, 500, {
      error: error instanceof Error ? error.message : "Webhook processing failed."
    });
  }
}

export async function cloudWebhookRoute(req, res) {
  const method = `${req?.method ?? "GET"}`.toUpperCase();

  if (method === "GET") {
    return handleCloudWebhookVerification(req, res);
  }

  if (method === "POST") {
    return handleCloudWebhookEvent(req, res);
  }

  return textResponse(res, 405, "Method Not Allowed");
}

export default {
  get: handleCloudWebhookVerification,
  post: handleCloudWebhookEvent,
  handler: cloudWebhookRoute
};
