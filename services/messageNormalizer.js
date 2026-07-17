function normalizeAccountId(input) {
  return (
    input?.account_id?.trim?.() ||
    input?.accountId?.trim?.() ||
    input?.channelId?.trim?.() ||
    input?.account?.id?.trim?.() ||
    null
  );
}

function normalizePhone(value) {
  const normalized = `${value ?? ""}`.replace(/\D+/g, "").trim();
  return normalized || null;
}

function normalizeDirection(value) {
  const normalized = `${value ?? ""}`.trim().toLowerCase();

  if (normalized === "outbound" || normalized === "out" || normalized === "sent") {
    return "outbound";
  }

  if (normalized === "inbound" || normalized === "in" || normalized === "received") {
    return "inbound";
  }

  return null;
}

function normalizeTimestamp(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? new Date() : value;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = new Date(value > 1_000_000_000_000 ? value : value * 1000);
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  }

  if (typeof value === "string" && value.trim()) {
    const numericValue = Number(value);
    if (Number.isFinite(numericValue)) {
      const parsedNumeric = new Date(numericValue > 1_000_000_000_000 ? numericValue : numericValue * 1000);
      if (!Number.isNaN(parsedNumeric.getTime())) {
        return parsedNumeric;
      }
    }

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  }

  return new Date();
}

function normalizeFallbackMessage(type) {
  switch (`${type ?? ""}`.trim().toLowerCase()) {
    case "image":
      return "[Image]";
    case "audio":
    case "ptt":
    case "voice":
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
      return "[Reaction]";
    case "sticker":
      return "[Sticker]";
    default:
      return "[Unsupported message]";
  }
}

function normalizePersonalMessageText(message) {
  const directBody = `${message?.body ?? ""}`.trim();
  if (directBody) {
    return directBody;
  }

  const caption = `${message?.caption ?? ""}`.trim();
  if (caption) {
    return caption;
  }

  const rawPayload = message?.rawPayload && typeof message.rawPayload === "object" ? message.rawPayload : null;
  const rawBody = `${rawPayload?.body ?? ""}`.trim();
  if (rawBody) {
    return rawBody;
  }

  const rawCaption = `${rawPayload?.caption ?? ""}`.trim();
  if (rawCaption) {
    return rawCaption;
  }

  return normalizeFallbackMessage(message?.type ?? rawPayload?.type ?? rawPayload?.mimetype);
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

  return normalizeFallbackMessage(message?.type);
}

export function normalizePersonalMessage(input) {
  const rawPayload = input?.rawPayload && typeof input.rawPayload === "object" ? input.rawPayload : null;
  const fromMe =
    typeof input?.fromMe === "boolean"
      ? input.fromMe
      : typeof rawPayload?.fromMe === "boolean"
        ? rawPayload.fromMe
        : false;

  const from = normalizePhone(input?.from ?? rawPayload?.from ?? (fromMe ? input?.to : null));
  const to = normalizePhone(input?.to ?? rawPayload?.to ?? (fromMe ? rawPayload?.from : null));

  return {
    channel: "personal",
    account_id: normalizeAccountId(input),
    from,
    to,
    message: normalizePersonalMessageText(input),
    timestamp: normalizeTimestamp(input?.timestamp ?? input?.sentAt ?? rawPayload?.timestamp),
    direction: normalizeDirection(input?.direction) ?? (fromMe ? "outbound" : "inbound")
  };
}

export function normalizeCloudMessage(input) {
  const message = input?.message && typeof input.message === "object" ? input.message : input;
  const metadata = input?.metadata && typeof input.metadata === "object" ? input.metadata : null;
  const from = normalizePhone(input?.from ?? message?.from);
  const normalizedAccountId = normalizeAccountId(input);
  const fallbackAccountId = `${metadata?.phone_number_id ?? input?.phone_number_id ?? ""}`.trim() || null;
  const to = normalizePhone(
    input?.to ??
      metadata?.display_phone_number ??
      input?.display_phone_number ??
      input?.phone_number_id ??
      metadata?.phone_number_id
  );

  return {
    channel: "cloud",
    account_id: normalizedAccountId ?? fallbackAccountId,
    from,
    to,
    message: normalizeCloudMessageText(message),
    timestamp: normalizeTimestamp(input?.timestamp ?? message?.timestamp),
    direction: normalizeDirection(input?.direction) ?? "inbound"
  };
}

export function normalizeMessage(input) {
  const explicitChannel = `${input?.channel ?? ""}`.trim().toLowerCase();

  if (explicitChannel === "cloud") {
    return normalizeCloudMessage(input);
  }

  if (explicitChannel === "personal") {
    return normalizePersonalMessage(input);
  }

  if (input?.message?.type || input?.metadata?.phone_number_id || input?.phone_number_id) {
    return normalizeCloudMessage(input);
  }

  return normalizePersonalMessage(input);
}

export default {
  normalizeMessage,
  normalizeCloudMessage,
  normalizePersonalMessage
};
