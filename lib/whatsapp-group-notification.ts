import { parsePhoneNumberFromString } from "libphonenumber-js";

type UnknownRecord = Record<string, unknown>;

export type WhatsAppGroupNotificationMetadata = {
  subtype: string | null;
  authorId: string | null;
  recipientIds: string[];
  actorLabel?: string | null;
  recipientLabels?: string[];
};

export function isWhatsAppGroupNotificationType(type?: string | null) {
  const normalized = type?.trim().toLowerCase();
  return normalized === "gp2" || normalized === "group_notification";
}

export function isWhatsAppGroupNotificationPayload(...sources: unknown[]) {
  return sources.some((source) => {
    const record = parseRecord(source);
    if (!record) {
      return false;
    }

    return (
      isWhatsAppGroupNotificationType(readString(record.type)) ||
      isWhatsAppGroupNotificationType(readString(record.messageType)) ||
      Boolean(asRecord(record.groupNotification))
    );
  });
}

export function readWhatsAppGroupNotificationMetadata(
  message: unknown
): WhatsAppGroupNotificationMetadata | null {
  const record = asRecord(message);
  if (!record) {
    return null;
  }

  const data = asRecord(record._data) ?? asRecord(record.rawData) ?? record;
  const type = readString(record.type) ?? readString(data.type);
  if (!isWhatsAppGroupNotificationType(type)) {
    return null;
  }

  return {
    subtype: readString(data.subtype) ?? readString(record.subtype),
    authorId: readWhatsAppId(record.author) ?? readWhatsAppId(data.author),
    recipientIds: readWhatsAppIds(data.recipients ?? record.recipients)
  };
}

export function formatWhatsAppGroupNotification(input: {
  type?: string | null;
  body?: string | null;
  rawPayload?: unknown;
}) {
  if (!isWhatsAppGroupNotificationType(input.type)) {
    return null;
  }

  const rawPayload = asRecord(input.rawPayload);
  const metadata =
    normalizeStoredMetadata(rawPayload?.groupNotification) ??
    readWhatsAppGroupNotificationMetadata(rawPayload) ?? {
      subtype: null,
      authorId: readWhatsAppId(rawPayload?.author),
      recipientIds: readWhatsAppIds(rawPayload?.recipients)
    };
  const subtype = metadata.subtype?.trim().toLowerCase() ?? "";
  const actor =
    cleanLabel(metadata.actorLabel) ??
    formatWhatsAppParticipantLabel(metadata.authorId) ??
    "A participant";
  const recipients = (metadata.recipientLabels?.length
    ? metadata.recipientLabels
    : metadata.recipientIds.map(formatWhatsAppParticipantLabel)
  ).filter((value): value is string => Boolean(value));
  const affected = joinLabels(recipients) || "a participant";
  const detail = input.body?.trim() || null;

  switch (subtype) {
    case "add":
      return `${actor} added ${affected}`;
    case "invite":
    case "linked_group_join":
      return recipients.length
        ? `${affected} joined using the group's invite link`
        : `${actor} joined using the group's invite link`;
    case "remove":
      return `${actor} removed ${affected}`;
    case "leave":
      return `${actor} left`;
    case "promote":
      return `${actor} made ${affected} a group admin`;
    case "demote":
      return `${actor} dismissed ${affected} as a group admin`;
    case "subject":
      return detail ? `${actor} changed the group name to “${detail}”` : `${actor} changed the group name`;
    case "description":
      return detail ? `${actor} changed the group description to “${detail}”` : `${actor} changed the group description`;
    case "picture":
      return `${actor} changed the group icon`;
    case "announce":
      return `${actor} changed who can send messages in the group`;
    case "restrict":
      return `${actor} changed who can edit the group's settings`;
    case "membership_approval_request":
      return `${actor} requested to join the group`;
    case "change_number":
      return recipients.length ? `${actor} changed their phone number to ${affected}` : `${actor} changed their phone number`;
    default:
      return detail || (subtype ? `Group update: ${humanizeSubtype(subtype)}` : "Group updated");
  }
}

export function formatWhatsAppParticipantLabel(value?: string | null) {
  const source = value?.trim() ?? "";
  // A LID is a WhatsApp-local identifier, not an international phone number.
  // Its numeric prefix can accidentally parse as a valid country code.
  if (source.endsWith("@lid")) {
    return null;
  }

  const normalized = source.replace(/@(?:c\.us|g\.us)$/i, "").trim();
  if (!normalized) {
    return null;
  }

  const digits = normalized.replace(/\D/g, "");
  if (digits && digits.length === normalized.length) {
    return parsePhoneNumberFromString(`+${digits}`)?.formatInternational() ?? `+${digits}`;
  }

  return normalized;
}

function normalizeStoredMetadata(value: unknown): WhatsAppGroupNotificationMetadata | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  return {
    subtype: readString(record.subtype),
    authorId: readWhatsAppId(record.authorId),
    recipientIds: readWhatsAppIds(record.recipientIds),
    actorLabel: readString(record.actorLabel),
    recipientLabels: readStringArray(record.recipientLabels)
  };
}

function readWhatsAppIds(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map(readWhatsAppId).filter((entry): entry is string => Boolean(entry));
}

function readWhatsAppId(value: unknown): string | null {
  if (typeof value === "string") {
    return value.trim() || null;
  }

  const record = asRecord(value);
  if (!record) {
    return null;
  }

  return readString(record._serialized) ?? readString(record.id) ?? readString(record.user);
}

function readStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map(readString).filter((entry): entry is string => Boolean(entry))
    : undefined;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function cleanLabel(value?: string | null) {
  return value?.trim() || null;
}

function joinLabels(values: string[]) {
  if (values.length < 2) {
    return values[0] ?? "";
  }

  if (values.length === 2) {
    return `${values[0]} and ${values[1]}`;
  }

  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
}

function humanizeSubtype(value: string) {
  return value.replace(/[_-]+/g, " ").replace(/^\w/, (character) => character.toUpperCase());
}

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function parseRecord(value: unknown): UnknownRecord | null {
  if (typeof value !== "string") {
    return asRecord(value);
  }

  try {
    return asRecord(JSON.parse(value));
  } catch {
    return null;
  }
}
