import { NextResponse } from "next/server";
import { requireCurrentApiAgent } from "@/lib/auth/current-user";
import { queryMany } from "@/lib/db";

type NotificationRow = {
  id: string;
  channelLabel: string | null;
  contactName: string;
  phone: string;
  isMuted: boolean;
  snoozedUntil: Date | null;
  snoozeReason: string | null;
  snoozeStatus: string | null;
  unreadCount: number;
  lastMessagePreview: string | null;
  lastMessageDirection: string | null;
  lastMessageAt: Date;
};

export async function GET() {
  try {
    const agent = await requireCurrentApiAgent();
    const rows = await queryMany<NotificationRow>(
      `SELECT conv.id,
              COALESCE(wac."displayName", wac."phoneNumber") AS "channelLabel",
              CASE WHEN conv."whatsAppRemoteId" LIKE '%@g.us'
                   THEN COALESCE(NULLIF(conv.subject, ''), NULLIF(c."syncedDisplayName", ''), c."displayName")
                   ELSE c."displayName" END AS "contactName",
              c.phone,
              conv."isMuted",
              conv."snoozedUntil",
              conv."snoozeReason",
              conv."snoozeStatus",
              conv."unreadCount",
              conv."lastMessagePreview",
              lm.direction AS "lastMessageDirection",
              conv."lastMessageAt"
       FROM "Conversation" conv
       JOIN "Contact" c ON c.id = conv."contactId"
       LEFT JOIN "WhatsAppChannel" wac ON wac.id = conv."channelId"
       LEFT JOIN LATERAL (
         SELECT m.direction
         FROM "Message" m
         WHERE m."conversationId" = conv.id AND m."deletedAt" IS NULL
         ORDER BY m."sentAt" DESC, m."createdAt" DESC, m.id DESC
         LIMIT 1
       ) lm ON TRUE
       WHERE conv."workspaceId" = $1
         AND COALESCE(c.tags, '') NOT ILIKE '%automation-test%'
         AND (conv."unreadCount" > 0 OR (conv."snoozeStatus" = 'ACTIVE' AND conv."snoozedUntil" IS NOT NULL))
       ORDER BY conv."lastMessageAt" DESC, conv.id DESC
       LIMIT 100`,
      [agent.workspaceId]
    );
    const conversations = rows.map((row) => ({
      id: row.id,
      channelLabel: row.channelLabel,
      contactName: row.contactName,
      phone: row.phone,
      isMuted: row.isMuted,
      isSnoozed:
        row.snoozeStatus === "ACTIVE" &&
        Boolean(row.snoozedUntil && row.snoozedUntil.getTime() > Date.now()),
      unreadCount: row.unreadCount,
      lastMessagePreview: row.lastMessagePreview ?? "",
      lastMessageDirection: row.lastMessageDirection,
      lastMessageAt: formatTimestamp(row.lastMessageAt),
      lastMessageAtIso: row.lastMessageAt.toISOString(),
      snoozeReason: row.snoozeReason,
      snoozedUntil: row.snoozedUntil ? formatTimestamp(row.snoozedUntil) : null,
      snoozedUntilIso: row.snoozedUntil?.toISOString() ?? null
    }));
    return NextResponse.json({ conversations }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    const unauthorized = error instanceof Error && error.message === "UNAUTHORIZED";
    return NextResponse.json(
      { error: unauthorized ? "Unauthorized." : "Unable to load unread summary." },
      { status: unauthorized ? 401 : 500 }
    );
  }
}

function formatTimestamp(date: Date) {
  return new Intl.DateTimeFormat("en-MY", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Kuala_Lumpur"
  }).format(date);
}
