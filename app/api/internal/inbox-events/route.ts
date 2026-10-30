import { NextRequest, NextResponse } from "next/server";
import { emitRelayedInboxRealtimeEvent } from "@/lib/inbox-realtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_EVENTS = new Set([
  "inbox:message",
  "inbox:ack",
  "inbox:conversation",
  "inbox:chat-state",
  "whatsapp:connection"
]);

export async function POST(request: NextRequest) {
  const expectedToken = process.env.SENDER_SERVICE_TOKEN?.trim();
  const providedToken = request.headers.get("x-sender-token")?.trim();
  if (!expectedToken || providedToken !== expectedToken) {
    return NextResponse.json({ error: "Unauthorized sender event." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as
    | { event?: unknown; payload?: unknown }
    | null;
  if (
    typeof body?.event !== "string" ||
    !ALLOWED_EVENTS.has(body.event) ||
    !body.payload ||
    typeof body.payload !== "object" ||
    !("workspaceId" in body.payload) ||
    typeof body.payload.workspaceId !== "string"
  ) {
    return NextResponse.json({ error: "Invalid inbox event." }, { status: 400 });
  }

  emitRelayedInboxRealtimeEvent(body.event, body.payload);
  return NextResponse.json({ ok: true });
}
