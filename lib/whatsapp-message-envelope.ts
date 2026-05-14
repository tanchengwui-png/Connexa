import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Message, MessageMedia, Reaction } from "whatsapp-web.js";
import { execute } from "@/lib/db";
import { prisma } from "@/lib/prisma";

type CapturedContactSnapshot = {
  id: string | null;
  name: string | null;
  pushname: string | null;
  number: string | null;
};

type CapturedChatSnapshot = {
  id: string | null;
  name: string | null;
  isGroup: boolean | null;
};

type CapturedQuotedSnapshot = {
  id: string | null;
  body: string | null;
};

type CapturedMediaSnapshot = {
  mimetype: string | null;
  filename: string | null;
  filesize: number | null;
  width: number | null;
  height: number | null;
  duration: number | null;
  caption: string | null;
  storagePath: string | null;
  url: string | null;
};

type CapturedLocationSnapshot = {
  latitude: number | null;
  longitude: number | null;
  description: string | null;
};

type CapturedEnvelope = {
  providerMessageId: string;
  from: string | null;
  to: string | null;
  author: string | null;
  timestamp: Date | null;
  type: string | null;
  body: string | null;
  fromMe: boolean;
  hasMedia: boolean;
  ack: number | null;
  isForwarded: boolean | null;
  isStatus: boolean | null;
  broadcast: boolean | null;
  deviceType: string | null;
  hasQuotedMsg: boolean | null;
  mentionedIds: string[];
  groupMentions: unknown[];
  links: unknown[];
  selectedButtonId: string | null;
  selectedRowId: string | null;
  media: CapturedMediaSnapshot;
  location: CapturedLocationSnapshot;
  contact: CapturedContactSnapshot;
  chat: CapturedChatSnapshot;
  quoted: CapturedQuotedSnapshot;
  rawJson: unknown;
};

export async function captureWhatsAppMessageEnvelope(input: {
  workspaceId: string;
  message: Message;
  rawData?: unknown;
  conversationId?: string | null;
  storedMessageId?: string | null;
}) {
  const { message } = input;
  const providerMessageId = message.id._serialized;
  const rawRecord = asRecord(input.rawData);
  const rawContactRecord = asRecord(rawRecord?.contact);

  const [contact, chat, quoted] = await Promise.all([
    message.getContact().catch(() => null),
    message.getChat().catch(() => null),
    message.hasQuotedMsg ? message.getQuotedMessage().catch(() => null) : Promise.resolve(null)
  ]);

  const downloadedMedia = message.hasMedia ? await message.downloadMedia().catch(() => null) : null;
  const storedMedia = downloadedMedia
    ? await persistIncomingMedia({
        workspaceId: input.workspaceId,
        providerMessageId,
        media: downloadedMedia
      }).catch(() => null)
    : null;

  const envelope: CapturedEnvelope = {
    providerMessageId,
    from: readString(message, "from") ?? readString(rawRecord, "from"),
    to: readString(message, "to") ?? readString(rawRecord, "to"),
    author: readString(message, "author") ?? readString(rawRecord, "author"),
    timestamp: typeof message.timestamp === "number" ? new Date(message.timestamp * 1000) : null,
    type: readString(message, "type") ?? readString(rawRecord, "type"),
    body: readString(message, "body") ?? readString(rawRecord, "body"),
    fromMe: Boolean(message.fromMe),
    hasMedia: Boolean(message.hasMedia),
    ack: typeof message.ack === "number" ? message.ack : readNumber(rawRecord, "ack"),
    isForwarded: readBoolean(message, "isForwarded") ?? readBoolean(rawRecord, "isForwarded"),
    isStatus: readBoolean(message, "isStatus") ?? readBoolean(rawRecord, "isStatus"),
    broadcast: readBoolean(message, "broadcast") ?? readBoolean(rawRecord, "broadcast"),
    deviceType: readString(message, "deviceType") ?? readString(rawRecord, "deviceType"),
    hasQuotedMsg: readBoolean(message, "hasQuotedMsg") ?? readBoolean(rawRecord, "hasQuotedMsg"),
    mentionedIds: readStringArray(message, "mentionedIds", rawRecord),
    groupMentions: readArray(message, "groupMentions", rawRecord),
    links: readArray(message, "links", rawRecord),
    selectedButtonId: readString(message, "selectedButtonId") ?? readString(rawRecord, "selectedButtonId"),
    selectedRowId: readString(message, "selectedRowId") ?? readString(rawRecord, "selectedRowId"),
    media: {
      mimetype:
        downloadedMedia?.mimetype ??
        readString(message, "mimetype") ??
        readNestedString(rawRecord, ["mimetype"]) ??
        readNestedString(rawRecord, ["mediaData", "mimetype"]),
      filename:
        downloadedMedia?.filename ??
        readString(message, "filename") ??
        readNestedString(rawRecord, ["filename"]) ??
        readNestedString(rawRecord, ["mediaData", "filename"]),
      filesize:
        readNumber(downloadedMedia, "filesize") ??
        readNumber(message, "filesize") ??
        readNestedNumber(rawRecord, ["size"]) ??
        readNestedNumber(rawRecord, ["fileSize"]) ??
        readNestedNumber(rawRecord, ["mediaData", "size"]),
      width:
        readNumber(message, "width") ??
        readNestedNumber(rawRecord, ["width"]) ??
        readNestedNumber(rawRecord, ["bodyData", "width"]),
      height:
        readNumber(message, "height") ??
        readNestedNumber(rawRecord, ["height"]) ??
        readNestedNumber(rawRecord, ["bodyData", "height"]),
      duration:
        readNumber(message, "duration") ??
        readNestedNumber(rawRecord, ["duration"]) ??
        readNestedNumber(rawRecord, ["bodyData", "seconds"]),
      caption:
        readString(message, "caption") ??
        readNestedString(rawRecord, ["caption"]) ??
        readNestedString(rawRecord, ["bodyData", "caption"]),
      storagePath: storedMedia?.storagePath ?? null,
      url: storedMedia?.url ?? null
    },
    location: {
      latitude:
        readNumber(message, "latitude") ??
        readNestedNumber(rawRecord, ["lat"]) ??
        readNestedNumber(rawRecord, ["location", "latitude"]),
      longitude:
        readNumber(message, "longitude") ??
        readNestedNumber(rawRecord, ["lng"]) ??
        readNestedNumber(rawRecord, ["location", "longitude"]),
      description:
        readString(message, "description") ??
        readNestedString(rawRecord, ["loc"]) ??
        readNestedString(rawRecord, ["location", "description"])
    },
    contact: {
      id: readSerializedId(contact) ?? readString(rawContactRecord, "id"),
      name:
        readString(contact, "name") ??
        readString(rawContactRecord, "name") ??
        readString(rawRecord, "notifyName"),
      pushname: readString(contact, "pushname") ?? readString(rawContactRecord, "pushname") ?? readString(rawRecord, "pushname"),
      number: readString(contact, "number") ?? readString(rawContactRecord, "number") ?? readString(rawRecord, "number")
    },
    chat: {
      id: readSerializedId(chat),
      name: readString(chat, "name"),
      isGroup: readBoolean(chat, "isGroup")
    },
    quoted: {
      id: quoted ? quoted.id._serialized : null,
      body: quoted ? readString(quoted, "body") : null
    },
    rawJson: input.rawData ?? null
  };

  const record = buildEnvelopeWriteData({
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
    storedMessageId: input.storedMessageId,
    envelope
  });
  const envelopeId = randomUUID();

  await execute(
    `INSERT INTO "WhatsAppMessageEnvelope" (
      id, "workspaceId", "conversationId", "messageId", "providerMessageId",
      "from", "to", "author", ack, "messageTimestamp", "messageType", body,
      "fromMe", "hasMedia", "isForwarded", "isStatus", broadcast, "deviceType", "hasQuotedMsg",
      "mentionedIdsJson", "groupMentionsJson", "linksJson",
      "selectedButtonId", "selectedRowId",
      "mediaMimeType", "mediaFilename", "mediaFilesize", "mediaWidth", "mediaHeight", "mediaDurationSeconds",
      "mediaCaption", "mediaUrl", "mediaStoragePath",
      latitude, longitude, "locationDescription",
      "quotedMessageId", "quotedBody",
      "contactId", "contactName", "contactPushname", "contactNumber",
      "chatId", "chatName", "chatIsGroup",
      "contactSnapshotJson", "chatSnapshotJson", "rawJson", "updatedAt"
    ) VALUES (
      $1, $2, $3, $4, $5,
      $6, $7, $8, $9, $10, $11, $12,
      $13, $14, $15, $16, $17, $18, $19,
      $20::jsonb, $21::jsonb, $22::jsonb,
      $23, $24,
      $25, $26, $27, $28, $29, $30,
      $31, $32, $33,
      $34, $35, $36,
      $37, $38,
      $39, $40, $41, $42,
      $43, $44, $45,
      $46::jsonb, $47::jsonb, $48::jsonb, NOW()
    )
    ON CONFLICT ("providerMessageId") DO UPDATE SET
      "conversationId" = EXCLUDED."conversationId",
      "messageId" = COALESCE(EXCLUDED."messageId", "WhatsAppMessageEnvelope"."messageId"),
      "from" = EXCLUDED."from",
      "to" = EXCLUDED."to",
      "author" = EXCLUDED."author",
      ack = EXCLUDED.ack,
      "messageTimestamp" = EXCLUDED."messageTimestamp",
      "messageType" = EXCLUDED."messageType",
      body = EXCLUDED.body,
      "fromMe" = EXCLUDED."fromMe",
      "hasMedia" = EXCLUDED."hasMedia",
      "isForwarded" = EXCLUDED."isForwarded",
      "isStatus" = EXCLUDED."isStatus",
      broadcast = EXCLUDED.broadcast,
      "deviceType" = EXCLUDED."deviceType",
      "hasQuotedMsg" = EXCLUDED."hasQuotedMsg",
      "mentionedIdsJson" = EXCLUDED."mentionedIdsJson",
      "groupMentionsJson" = EXCLUDED."groupMentionsJson",
      "linksJson" = EXCLUDED."linksJson",
      "selectedButtonId" = EXCLUDED."selectedButtonId",
      "selectedRowId" = EXCLUDED."selectedRowId",
      "mediaMimeType" = EXCLUDED."mediaMimeType",
      "mediaFilename" = EXCLUDED."mediaFilename",
      "mediaFilesize" = EXCLUDED."mediaFilesize",
      "mediaWidth" = EXCLUDED."mediaWidth",
      "mediaHeight" = EXCLUDED."mediaHeight",
      "mediaDurationSeconds" = EXCLUDED."mediaDurationSeconds",
      "mediaCaption" = EXCLUDED."mediaCaption",
      "mediaUrl" = EXCLUDED."mediaUrl",
      "mediaStoragePath" = EXCLUDED."mediaStoragePath",
      latitude = EXCLUDED.latitude,
      longitude = EXCLUDED.longitude,
      "locationDescription" = EXCLUDED."locationDescription",
      "quotedMessageId" = EXCLUDED."quotedMessageId",
      "quotedBody" = EXCLUDED."quotedBody",
      "contactId" = COALESCE(EXCLUDED."contactId", "WhatsAppMessageEnvelope"."contactId"),
      "contactName" = COALESCE(EXCLUDED."contactName", "WhatsAppMessageEnvelope"."contactName"),
      "contactPushname" = COALESCE(EXCLUDED."contactPushname", "WhatsAppMessageEnvelope"."contactPushname"),
      "contactNumber" = COALESCE(EXCLUDED."contactNumber", "WhatsAppMessageEnvelope"."contactNumber"),
      "chatId" = EXCLUDED."chatId",
      "chatName" = EXCLUDED."chatName",
      "chatIsGroup" = EXCLUDED."chatIsGroup",
      "contactSnapshotJson" = EXCLUDED."contactSnapshotJson",
      "chatSnapshotJson" = EXCLUDED."chatSnapshotJson",
      "rawJson" = EXCLUDED."rawJson",
      "updatedAt" = NOW()`,
    [
      envelopeId,
      record.workspaceId,
      record.conversationId,
      record.messageId,
      record.providerMessageId,
      record.from,
      record.to,
      record.author,
      record.ack,
      record.messageTimestamp,
      record.messageType,
      record.body,
      record.fromMe,
      record.hasMedia,
      record.isForwarded,
      record.isStatus,
      record.broadcast,
      record.deviceType,
      record.hasQuotedMsg,
      JSON.stringify(record.mentionedIdsJson ?? []),
      JSON.stringify(record.groupMentionsJson ?? []),
      JSON.stringify(record.linksJson ?? []),
      record.selectedButtonId,
      record.selectedRowId,
      record.mediaMimeType,
      record.mediaFilename,
      record.mediaFilesize,
      record.mediaWidth,
      record.mediaHeight,
      record.mediaDurationSeconds,
      record.mediaCaption,
      record.mediaUrl,
      record.mediaStoragePath,
      record.latitude,
      record.longitude,
      record.locationDescription,
      record.quotedMessageId,
      record.quotedBody,
      record.contactId,
      record.contactName,
      record.contactPushname,
      record.contactNumber,
      record.chatId,
      record.chatName,
      record.chatIsGroup,
      JSON.stringify(record.contactSnapshotJson ?? {}),
      JSON.stringify(record.chatSnapshotJson ?? {}),
      JSON.stringify(record.rawJson ?? null)
    ]
  );

  console.info("[whatsapp-web][captured-envelope]", JSON.stringify(envelope, null, 2));

  return envelope;
}

export async function captureWhatsAppReactionEnvelope(input: {
  workspaceId: string;
  reaction: Reaction;
}) {
  const providerMessageId = readSerializedId(input.reaction.id);
  const targetProviderMessageId = readSerializedId(input.reaction.msgId);
  const envelopeId = randomUUID();

  if (!providerMessageId) {
    return null;
  }

  const parentMessage = targetProviderMessageId
    ? await prisma.message.findFirst({
        where: {
          providerMessageId: targetProviderMessageId,
          conversation: {
            workspaceId: input.workspaceId
          }
        },
        select: {
          conversationId: true
        }
      })
    : null;

  await execute(
    `INSERT INTO "WhatsAppMessageEnvelope" (
      id, "workspaceId", "conversationId", "providerMessageId",
      "from", "messageTimestamp", "messageType", body, "fromMe",
      "quotedMessageId", "rawJson", "updatedAt"
    ) VALUES (
      $1, $2, $3, $4,
      $5, $6, 'reaction', $7, $8,
      $9, $10::jsonb, NOW()
    )
    ON CONFLICT ("providerMessageId") DO UPDATE SET
      "conversationId" = EXCLUDED."conversationId",
      "from" = EXCLUDED."from",
      "messageTimestamp" = EXCLUDED."messageTimestamp",
      body = EXCLUDED.body,
      "fromMe" = EXCLUDED."fromMe",
      "quotedMessageId" = EXCLUDED."quotedMessageId",
      "rawJson" = EXCLUDED."rawJson",
      "updatedAt" = NOW()`,
    [
      envelopeId,
      input.workspaceId,
      parentMessage?.conversationId ?? null,
      providerMessageId,
      input.reaction.senderId ?? null,
      input.reaction.timestamp ? new Date(input.reaction.timestamp * 1000) : new Date(),
      input.reaction.reaction ?? null,
      Boolean(input.reaction.id?.fromMe ?? input.reaction.msgId?.fromMe),
      targetProviderMessageId,
      JSON.stringify({
        reactionText: input.reaction.reaction ?? null,
        parentMsgKey: targetProviderMessageId,
        senderUserJid: input.reaction.senderId ?? null,
        ack: input.reaction.ack ?? null,
        orphan: input.reaction.orphan ?? null,
        orphanReason: input.reaction.orphanReason ?? null
      })
    ]
  );

  return {
    providerMessageId,
    targetProviderMessageId
  };
}

export async function upsertWhatsAppMessageEnvelopeFromPayload(input: {
  workspaceId: string;
  conversationId?: string | null;
  messageId?: string | null;
  providerMessageId: string;
  body?: string | null;
  direction?: "INBOUND" | "OUTBOUND" | null;
  sentAt?: Date | null;
  attachmentMimeType?: string | null;
  attachmentName?: string | null;
  attachmentUrl?: string | null;
  rawPayload?: unknown;
}) {
  const providerMessageId = input.providerMessageId.trim();
  if (!providerMessageId) {
    return null;
  }

  const rawRecord = asRecord(input.rawPayload);
  const parsedProviderId = parseProviderMessageId(providerMessageId);
  const idRecord = asRecord(rawRecord?.id);
  const mediaDataRecord = asRecord(rawRecord?.mediaData);
  const chatId =
    readString(rawRecord, "chatId") ??
    readString(rawRecord, "remote") ??
    readString(idRecord, "remote") ??
    parsedProviderId.remoteId;
  const chatSnapshot = {
    id: chatId,
    name: readString(rawRecord, "chatName"),
    isGroup: isGroupRemoteId(chatId ?? readString(rawRecord, "from") ?? readString(rawRecord, "to"))
  };
  const contactId =
    readNestedString(rawRecord, ["contact", "id"]) ??
    readString(rawRecord, "author") ??
    parsedProviderId.authorId ??
    (chatSnapshot.isGroup ? null : readString(rawRecord, "from") ?? readString(rawRecord, "to") ?? parsedProviderId.remoteId) ??
    null;
  const contactSnapshot = {
    id: contactId,
    name: readNestedString(rawRecord, ["contact", "name"]) ?? readString(rawRecord, "notifyName") ?? readString(rawRecord, "name"),
    pushname: readNestedString(rawRecord, ["contact", "pushname"]) ?? readString(rawRecord, "pushname"),
    number: readNestedString(rawRecord, ["contact", "number"]) ?? readString(rawRecord, "number") ?? phoneNumberFromWid(contactId)
  };
  const rawTimestamp = readNumber(rawRecord, "timestamp");
  const mentionedIds = readMentionIds(rawRecord);
  const groupMentions = readGroupMentions(rawRecord);
  const envelopeId = randomUUID();

  await execute(
    `INSERT INTO "WhatsAppMessageEnvelope" (
      id, "workspaceId", "conversationId", "messageId", "providerMessageId",
      "from", "to", "author", ack, "messageTimestamp", "messageType", body,
      "fromMe", "hasMedia", "isForwarded", "isStatus", broadcast, "deviceType", "hasQuotedMsg",
      "mentionedIdsJson", "groupMentionsJson", "linksJson",
      "selectedButtonId", "selectedRowId",
      "mediaMimeType", "mediaFilename", "mediaCaption", "mediaUrl",
      "quotedMessageId", "quotedBody",
      "contactId", "contactName", "contactPushname", "contactNumber",
      "chatId", "chatName", "chatIsGroup",
      "contactSnapshotJson", "chatSnapshotJson", "rawJson", "updatedAt"
    ) VALUES (
      $1, $2, $3, $4, $5,
      $6, $7, $8, $9, $10, $11, $12,
      $13, $14, $15, $16, $17, $18, $19,
      $20::jsonb, $21::jsonb, $22::jsonb,
      $23, $24,
      $25, $26, $27, $28,
      $29, $30,
      $31, $32, $33, $34,
      $35, $36, $37,
      $38::jsonb, $39::jsonb, $40::jsonb, NOW()
    )
    ON CONFLICT ("providerMessageId") DO UPDATE SET
      "conversationId" = COALESCE(EXCLUDED."conversationId", "WhatsAppMessageEnvelope"."conversationId"),
      "messageId" = COALESCE(EXCLUDED."messageId", "WhatsAppMessageEnvelope"."messageId"),
      "from" = COALESCE(EXCLUDED."from", "WhatsAppMessageEnvelope"."from"),
      "to" = COALESCE(EXCLUDED."to", "WhatsAppMessageEnvelope"."to"),
      "author" = COALESCE(EXCLUDED."author", "WhatsAppMessageEnvelope"."author"),
      ack = COALESCE(EXCLUDED.ack, "WhatsAppMessageEnvelope".ack),
      "messageTimestamp" = COALESCE(EXCLUDED."messageTimestamp", "WhatsAppMessageEnvelope"."messageTimestamp"),
      "messageType" = COALESCE(EXCLUDED."messageType", "WhatsAppMessageEnvelope"."messageType"),
      body = COALESCE(EXCLUDED.body, "WhatsAppMessageEnvelope".body),
      "fromMe" = EXCLUDED."fromMe",
      "hasMedia" = EXCLUDED."hasMedia",
      "isForwarded" = COALESCE(EXCLUDED."isForwarded", "WhatsAppMessageEnvelope"."isForwarded"),
      "isStatus" = COALESCE(EXCLUDED."isStatus", "WhatsAppMessageEnvelope"."isStatus"),
      broadcast = COALESCE(EXCLUDED.broadcast, "WhatsAppMessageEnvelope".broadcast),
      "deviceType" = COALESCE(EXCLUDED."deviceType", "WhatsAppMessageEnvelope"."deviceType"),
      "hasQuotedMsg" = COALESCE(EXCLUDED."hasQuotedMsg", "WhatsAppMessageEnvelope"."hasQuotedMsg"),
      "mentionedIdsJson" = CASE
        WHEN jsonb_array_length(EXCLUDED."mentionedIdsJson") > 0 THEN EXCLUDED."mentionedIdsJson"
        ELSE "WhatsAppMessageEnvelope"."mentionedIdsJson"
      END,
      "groupMentionsJson" = CASE
        WHEN jsonb_array_length(EXCLUDED."groupMentionsJson") > 0 THEN EXCLUDED."groupMentionsJson"
        ELSE "WhatsAppMessageEnvelope"."groupMentionsJson"
      END,
      "linksJson" = CASE
        WHEN jsonb_array_length(EXCLUDED."linksJson") > 0 THEN EXCLUDED."linksJson"
        ELSE "WhatsAppMessageEnvelope"."linksJson"
      END,
      "selectedButtonId" = COALESCE(EXCLUDED."selectedButtonId", "WhatsAppMessageEnvelope"."selectedButtonId"),
      "selectedRowId" = COALESCE(EXCLUDED."selectedRowId", "WhatsAppMessageEnvelope"."selectedRowId"),
      "mediaMimeType" = COALESCE(EXCLUDED."mediaMimeType", "WhatsAppMessageEnvelope"."mediaMimeType"),
      "mediaFilename" = COALESCE(EXCLUDED."mediaFilename", "WhatsAppMessageEnvelope"."mediaFilename"),
      "mediaCaption" = COALESCE(EXCLUDED."mediaCaption", "WhatsAppMessageEnvelope"."mediaCaption"),
      "mediaUrl" = COALESCE(EXCLUDED."mediaUrl", "WhatsAppMessageEnvelope"."mediaUrl"),
      "quotedMessageId" = COALESCE(EXCLUDED."quotedMessageId", "WhatsAppMessageEnvelope"."quotedMessageId"),
      "quotedBody" = COALESCE(EXCLUDED."quotedBody", "WhatsAppMessageEnvelope"."quotedBody"),
      "contactId" = COALESCE(EXCLUDED."contactId", "WhatsAppMessageEnvelope"."contactId"),
      "contactName" = COALESCE(EXCLUDED."contactName", "WhatsAppMessageEnvelope"."contactName"),
      "contactPushname" = COALESCE(EXCLUDED."contactPushname", "WhatsAppMessageEnvelope"."contactPushname"),
      "contactNumber" = COALESCE(EXCLUDED."contactNumber", "WhatsAppMessageEnvelope"."contactNumber"),
      "chatId" = COALESCE(EXCLUDED."chatId", "WhatsAppMessageEnvelope"."chatId"),
      "chatName" = COALESCE(EXCLUDED."chatName", "WhatsAppMessageEnvelope"."chatName"),
      "chatIsGroup" = COALESCE(EXCLUDED."chatIsGroup", "WhatsAppMessageEnvelope"."chatIsGroup"),
      "contactSnapshotJson" = COALESCE(EXCLUDED."contactSnapshotJson", "WhatsAppMessageEnvelope"."contactSnapshotJson"),
      "chatSnapshotJson" = COALESCE(EXCLUDED."chatSnapshotJson", "WhatsAppMessageEnvelope"."chatSnapshotJson"),
      "rawJson" = COALESCE(EXCLUDED."rawJson", "WhatsAppMessageEnvelope"."rawJson"),
      "updatedAt" = NOW()`,
    [
      envelopeId,
      input.workspaceId,
      input.conversationId ?? null,
      input.messageId ?? null,
      providerMessageId,
      readString(rawRecord, "from") ?? (parsedProviderId.fromMe ? null : parsedProviderId.remoteId),
      readString(rawRecord, "to") ?? (parsedProviderId.fromMe ? parsedProviderId.remoteId : null),
      readString(rawRecord, "author") ?? parsedProviderId.authorId,
      readNumber(rawRecord, "ack"),
      input.sentAt ?? (rawTimestamp ? new Date(rawTimestamp * 1000) : null),
      readString(rawRecord, "type") ?? readString(rawRecord, "messageType"),
      input.body ?? readString(rawRecord, "body") ?? readString(rawRecord, "caption"),
      readBoolean(rawRecord, "fromMe") ?? input.direction === "OUTBOUND",
      readBoolean(rawRecord, "hasMedia") ?? Boolean(input.attachmentUrl),
      readBoolean(rawRecord, "isForwarded"),
      readBoolean(rawRecord, "isStatus"),
      readBoolean(rawRecord, "broadcast"),
      readString(rawRecord, "deviceType"),
      readBoolean(rawRecord, "hasQuotedMsg"),
      JSON.stringify(mentionedIds),
      JSON.stringify(groupMentions),
      JSON.stringify(readArray(rawRecord, "links")),
      readString(rawRecord, "selectedButtonId"),
      readString(rawRecord, "selectedRowId"),
      input.attachmentMimeType ?? readString(rawRecord, "mimetype") ?? readString(mediaDataRecord, "mimetype"),
      input.attachmentName ?? readString(rawRecord, "filename") ?? readString(mediaDataRecord, "filename"),
      readString(rawRecord, "caption"),
      input.attachmentUrl ?? null,
      readSerializedId(rawRecord?.quotedMsg) ?? readString(rawRecord, "quotedMessageId"),
      readNestedString(rawRecord, ["quotedMsg", "body"]) ?? readString(rawRecord, "quotedBody"),
      contactSnapshot.id,
      contactSnapshot.name,
      contactSnapshot.pushname,
      contactSnapshot.number,
      chatSnapshot.id,
      chatSnapshot.name,
      chatSnapshot.isGroup,
      JSON.stringify(contactSnapshot),
      JSON.stringify(chatSnapshot),
      JSON.stringify(input.rawPayload ?? null)
    ]
  );

  return {
    providerMessageId,
    mentionedIds,
    groupMentions
  };
}

function buildEnvelopeWriteData(input: {
  workspaceId: string;
  conversationId?: string | null;
  storedMessageId?: string | null;
  envelope: CapturedEnvelope;
}) {
  return {
    workspaceId: input.workspaceId,
    conversationId: input.conversationId ?? null,
    messageId: input.storedMessageId ?? null,
    providerMessageId: input.envelope.providerMessageId,
    from: input.envelope.from,
    to: input.envelope.to,
    author: input.envelope.author,
    ack: input.envelope.ack,
    messageTimestamp: input.envelope.timestamp,
    messageType: input.envelope.type,
    body: input.envelope.body,
    fromMe: input.envelope.fromMe,
    hasMedia: input.envelope.hasMedia,
    isForwarded: input.envelope.isForwarded,
    isStatus: input.envelope.isStatus,
    broadcast: input.envelope.broadcast,
    deviceType: input.envelope.deviceType,
    hasQuotedMsg: input.envelope.hasQuotedMsg,
    mentionedIdsJson: input.envelope.mentionedIds,
    groupMentionsJson: input.envelope.groupMentions,
    linksJson: input.envelope.links,
    selectedButtonId: input.envelope.selectedButtonId,
    selectedRowId: input.envelope.selectedRowId,
    mediaMimeType: input.envelope.media.mimetype,
    mediaFilename: input.envelope.media.filename,
    mediaFilesize: input.envelope.media.filesize,
    mediaWidth: input.envelope.media.width,
    mediaHeight: input.envelope.media.height,
    mediaDurationSeconds: input.envelope.media.duration,
    mediaCaption: input.envelope.media.caption,
    mediaUrl: input.envelope.media.url,
    mediaStoragePath: input.envelope.media.storagePath,
    latitude: input.envelope.location.latitude,
    longitude: input.envelope.location.longitude,
    locationDescription: input.envelope.location.description,
    quotedMessageId: input.envelope.quoted.id,
    quotedBody: input.envelope.quoted.body,
    contactId: input.envelope.contact.id,
    contactName: input.envelope.contact.name,
    contactPushname: input.envelope.contact.pushname,
    contactNumber: input.envelope.contact.number,
    chatId: input.envelope.chat.id,
    chatName: input.envelope.chat.name,
    chatIsGroup: input.envelope.chat.isGroup,
    contactSnapshotJson: input.envelope.contact,
    chatSnapshotJson: input.envelope.chat,
    rawJson: input.envelope.rawJson
  };
}

export async function persistIncomingMedia(input: {
  workspaceId: string;
  providerMessageId: string;
  media: MessageMedia;
}) {
  const extension = extensionFromMimeType(input.media.mimetype) ?? "bin";
  const relativePath = path.join(
    "public",
    "uploads",
    "whatsapp-media",
    input.workspaceId,
    `${sanitizeSegment(input.providerMessageId)}.${extension}`
  );
  const absolutePath = path.join(process.cwd(), relativePath);

  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, Buffer.from(input.media.data, "base64"));

  return {
    storagePath: absolutePath,
    url: `/uploads/whatsapp-media/${input.workspaceId}/${sanitizeSegment(input.providerMessageId)}.${extension}`
  };
}

function extensionFromMimeType(mimetype?: string | null) {
  if (!mimetype) {
    return null;
  }

  const normalized = mimetype.toLowerCase();
  if (normalized.includes("jpeg")) return "jpg";
  if (normalized.includes("png")) return "png";
  if (normalized.includes("gif")) return "gif";
  if (normalized.includes("webp")) return "webp";
  if (normalized.includes("mp4")) return "mp4";
  if (normalized.includes("mpeg")) return "mp3";
  if (normalized.includes("ogg")) return "ogg";
  if (normalized.includes("pdf")) return "pdf";
  const slashIndex = normalized.indexOf("/");
  return slashIndex >= 0 ? normalized.slice(slashIndex + 1).replace(/[^a-z0-9]+/g, "") || null : null;
}

function sanitizeSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function asRecord(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function readString(source: unknown, key: string) {
  const record = asRecord(source);
  const value = record?.[key];
  return typeof value === "string" ? value : null;
}

function readNumber(source: unknown, key: string) {
  const record = asRecord(source);
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readBoolean(source: unknown, key: string) {
  const record = asRecord(source);
  const value = record?.[key];
  return typeof value === "boolean" ? value : null;
}

function readArray(source: unknown, key: string, fallback?: Record<string, unknown> | null) {
  const direct = asRecord(source)?.[key];
  if (Array.isArray(direct)) {
    return direct;
  }

  const fallbackValue = fallback?.[key];
  return Array.isArray(fallbackValue) ? fallbackValue : [];
}

function readStringArray(source: unknown, key: string, fallback?: Record<string, unknown> | null) {
  return readArray(source, key, fallback).filter((value): value is string => typeof value === "string");
}

function readMentionIds(source: Record<string, unknown> | null) {
  const ids = [
    ...readStringArray(source, "mentionedIds"),
    ...readStringArray(source, "mentionedJidList"),
    ...readStringArray(source, "mentionedJids"),
    ...extractMentionTokensFromBody(readString(source, "body"))
  ];

  for (const groupMention of readGroupMentions(source)) {
    const record = asRecord(groupMention);
    const mentionId =
      readString(record, "id") ??
      readString(record, "jid") ??
      readString(record, "mentionId") ??
      readString(record, "participant");
    if (mentionId) {
      ids.push(mentionId);
    }
  }

  return Array.from(new Set(ids.map((value) => value.trim()).filter(Boolean)));
}

function extractMentionTokensFromBody(body?: string | null) {
  const matches = body?.match(/@[\dA-Za-z._-]+/g) ?? [];
  return matches
    .map((match) => match.slice(1).trim())
    .filter(Boolean)
    .map((value) => (/^\d+$/.test(value) ? `${value}@lid` : value));
}

function readGroupMentions(source: Record<string, unknown> | null) {
  return [...readArray(source, "groupMentions"), ...readArray(source, "groupMentionsJson")];
}

function readNestedString(source: Record<string, unknown> | null, pathParts: string[]) {
  const value = readNestedValue(source, pathParts);
  return typeof value === "string" ? value : null;
}

function readNestedNumber(source: Record<string, unknown> | null, pathParts: string[]) {
  const value = readNestedValue(source, pathParts);
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readNestedValue(source: Record<string, unknown> | null, pathParts: string[]) {
  let current: unknown = source;
  for (const part of pathParts) {
    if (!current || typeof current !== "object") {
      return null;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function readSerializedId(source: unknown) {
  const record = asRecord(source);
  const directSerialized = record?._serialized;
  if (typeof directSerialized === "string") {
    return directSerialized;
  }

  const id = record?.id;
  if (typeof id === "string") {
    return id;
  }
  if (id && typeof id === "object") {
    const serialized = (id as Record<string, unknown>)._serialized;
    return typeof serialized === "string" ? serialized : null;
  }
  return null;
}

function parseProviderMessageId(providerMessageId: string) {
  const [fromMePart, remoteId, , authorId] = providerMessageId.split("_");
  const fromMe = fromMePart === "true" ? true : fromMePart === "false" ? false : null;
  return {
    fromMe,
    remoteId: remoteId?.includes("@") ? remoteId : null,
    authorId: authorId?.includes("@") ? authorId : null
  };
}

function phoneNumberFromWid(value?: string | null) {
  const normalized = value?.trim() ?? "";
  if (!normalized.endsWith("@c.us")) {
    return null;
  }

  const phone = normalized.slice(0, -"@c.us".length).replace(/[^\d]/g, "");
  return phone || null;
}

function isGroupRemoteId(value?: string | null) {
  return value?.trim().endsWith("@g.us") ?? null;
}
