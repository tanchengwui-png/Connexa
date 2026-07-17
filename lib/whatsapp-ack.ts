import { execute, queryOne } from "@/lib/db";
import { emitAckToInbox } from "@/lib/inbox-realtime";

export type WhatsAppAckStatus = "pending" | "sent" | "delivered" | "read" | "played";
export type InboxMessageDeliveryStatus = "pending" | "sent" | "delivered" | "read";

type StoredAckTarget = {
  workspaceId: string;
  channelId: string | null;
  conversationId: string | null;
  messageId: string | null;
  providerMessageId: string;
  previousAck: number | null;
  previousDeliveryStatus: InboxMessageDeliveryStatus | null;
};

export function normalizeWhatsAppAck(value: unknown) {
  const ack = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(ack)) {
    return null;
  }

  return Math.max(0, Math.min(4, Math.trunc(ack)));
}

export function getWhatsAppAckStatus(ack: number | null | undefined): WhatsAppAckStatus {
  switch (ack) {
    case 1:
      return "sent";
    case 2:
      return "delivered";
    case 3:
      return "read";
    case 4:
      return "played";
    case 0:
    default:
      return "pending";
  }
}

export function getInboxMessageDeliveryStatus(ack: number | null | undefined): InboxMessageDeliveryStatus {
  const ackStatus = getWhatsAppAckStatus(ack);
  return ackStatus === "played" ? "read" : ackStatus;
}

export async function persistWhatsAppMessageAck(input: {
  workspaceId: string;
  channelId?: string | null;
  providerMessageId: string;
  ack: number;
  occurredAt?: Date | null;
}) {
  const providerMessageId = input.providerMessageId.trim();
  const ack = normalizeWhatsAppAck(input.ack);
  if (!providerMessageId || ack === null) {
    return null;
  }

  const occurredAt = input.occurredAt ?? new Date();

  console.info(
    `[whatsapp-ack] received workspace=${input.workspaceId} channel=${input.channelId ?? "unknown"} providerMessageId=${providerMessageId} ack=${ack}`
  );

  await execute(
    `UPDATE "WhatsAppMessageEnvelope"
        SET ack = GREATEST(COALESCE(ack, 0), $3),
            "channelId" = COALESCE("channelId", $2),
            "updatedAt" = NOW()
      WHERE "workspaceId" = $1
        AND "providerMessageId" = $4`,
    [input.workspaceId, input.channelId ?? null, ack, providerMessageId]
  );

  const target = await queryOne<StoredAckTarget>(
    `WITH matched_envelope AS (
        SELECT *
        FROM "WhatsAppMessageEnvelope"
        WHERE "workspaceId" = $1
          AND "providerMessageId" = $2
        LIMIT 1
      ),
      matched_message AS (
        SELECT m.*
        FROM "Message" m
        JOIN "Conversation" conv ON conv.id = m."conversationId"
        WHERE conv."workspaceId" = $1
          AND m."providerMessageId" = $2
        LIMIT 1
      )
      SELECT
        COALESCE(mconv."workspaceId", we."workspaceId") AS "workspaceId",
        COALESCE(mconv."channelId", we."channelId") AS "channelId",
        COALESCE(m."conversationId", we."conversationId") AS "conversationId",
        COALESCE(m.id, we."messageId") AS "messageId",
        COALESCE(we."providerMessageId", m."providerMessageId") AS "providerMessageId",
        COALESCE(
          we.ack,
          CASE
            WHEN m."readAt" IS NOT NULL THEN 3
            WHEN m."deliveredAt" IS NOT NULL THEN 2
            WHEN m."providerMessageId" IS NOT NULL THEN 1
            ELSE 0
          END
        ) AS "previousAck",
        CASE
          WHEN COALESCE(
            we.ack,
            CASE
              WHEN m."readAt" IS NOT NULL THEN 3
              WHEN m."deliveredAt" IS NOT NULL THEN 2
              WHEN m."providerMessageId" IS NOT NULL THEN 1
              ELSE 0
            END
          ) >= 3 THEN 'read'
          WHEN COALESCE(
            we.ack,
            CASE
              WHEN m."readAt" IS NOT NULL THEN 3
              WHEN m."deliveredAt" IS NOT NULL THEN 2
              WHEN m."providerMessageId" IS NOT NULL THEN 1
              ELSE 0
            END
          ) >= 2 THEN 'delivered'
          WHEN COALESCE(
            we.ack,
            CASE
              WHEN m."readAt" IS NOT NULL THEN 3
              WHEN m."deliveredAt" IS NOT NULL THEN 2
              WHEN m."providerMessageId" IS NOT NULL THEN 1
              ELSE 0
            END
          ) >= 1 THEN 'sent'
          ELSE 'pending'
        END AS "previousDeliveryStatus"
      FROM matched_envelope we
      FULL JOIN matched_message m ON m."providerMessageId" = we."providerMessageId"
      LEFT JOIN "Conversation" mconv ON mconv.id = m."conversationId"
      LIMIT 1`,
    [input.workspaceId, providerMessageId]
  );

  const effectiveAck = Math.max(target?.previousAck ?? ack, ack);
  const effectiveAckStatus = getWhatsAppAckStatus(effectiveAck);
  const effectiveDeliveryStatus = getInboxMessageDeliveryStatus(effectiveAck);

  if (!target?.messageId) {
    console.info(
      `[whatsapp-ack] stored envelope only workspace=${input.workspaceId} providerMessageId=${providerMessageId} ack=${effectiveAck} matchedMessage=false`
    );
    return target
      ? {
          ...target,
          ack: effectiveAck,
          ackStatus: effectiveAckStatus,
          deliveryStatus: effectiveDeliveryStatus,
          changed: true
        }
      : null;
  }

  await execute(
    `UPDATE "Message"
        SET "deliveredAt" = CASE
              WHEN $2 >= 2 THEN COALESCE("deliveredAt", $4)
              ELSE "deliveredAt"
            END,
            "readAt" = CASE
              WHEN $2 >= 3 THEN COALESCE("readAt", $4)
              ELSE "readAt"
            END
      WHERE id = $1`,
    [target.messageId, effectiveAck, effectiveDeliveryStatus, occurredAt]
  );

  const event = {
    workspaceId: target.workspaceId,
    channelId: target.channelId,
    conversationId: target.conversationId,
    messageId: target.messageId,
    providerMessageId,
    ack: effectiveAck,
    ackStatus: effectiveAckStatus,
    deliveryStatus: effectiveDeliveryStatus,
    timestamp: occurredAt.toISOString()
  };

  await emitAckToInbox(event);
  console.info(
    `[whatsapp-ack] persisted workspace=${event.workspaceId} conversation=${event.conversationId ?? "unknown"} messageId=${event.messageId ?? "unknown"} providerMessageId=${providerMessageId} ack=${effectiveAck} status=${effectiveDeliveryStatus}`
  );
  return {
    ...event,
    changed:
      (target.previousAck ?? -1) < effectiveAck ||
      target.previousDeliveryStatus !== effectiveDeliveryStatus
  };
}
