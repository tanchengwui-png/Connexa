import { NextRequest, NextResponse } from "next/server";
import { requireApiManager } from "@/lib/auth/current-user";
import { prisma } from "@/lib/prisma";
import { logWhatsAppRuntimeEvent, WHATSAPP_RUNTIME_EVENT_TYPES } from "@/lib/whatsapp-runtime-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_EVENTS = new Set<string>([
  WHATSAPP_RUNTIME_EVENT_TYPES.QR_DISPLAYED,
  WHATSAPP_RUNTIME_EVENT_TYPES.UI_CONNECTED,
  WHATSAPP_RUNTIME_EVENT_TYPES.INBOX_USABLE
]);

export async function POST(request: NextRequest) {
  try {
    const manager = await requireApiManager();
    const body = (await request.json().catch(() => null)) as {
      channelId?: string;
      eventType?: string;
      observedAt?: string;
      requestedAt?: string | null;
      connectionAttemptId?: string | null;
      qrVersion?: number | null;
    } | null;
    const channelId = body?.channelId?.trim();
    const eventType = body?.eventType?.trim();
    if (!channelId || !eventType || !ALLOWED_EVENTS.has(eventType)) {
      return NextResponse.json({ error: "Invalid WhatsApp timing event." }, { status: 400 });
    }

    const channel = await prisma.whatsAppChannel.findFirst({
      where: { id: channelId, workspaceId: manager.workspaceId },
      select: { sessionClientId: true, connectedAt: true }
    });
    if (!channel) {
      return NextResponse.json({ error: "WhatsApp channel not found." }, { status: 404 });
    }

    const observedAt = body?.observedAt && Number.isFinite(new Date(body.observedAt).getTime())
      ? new Date(body.observedAt)
      : new Date();
    const requestedAt = body?.requestedAt && Number.isFinite(new Date(body.requestedAt).getTime())
      ? new Date(body.requestedAt)
      : null;
    await logWhatsAppRuntimeEvent({
      workspaceId: manager.workspaceId,
      sessionClientId: channel.sessionClientId,
      eventType,
      message: eventType === WHATSAPP_RUNTIME_EVENT_TYPES.QR_DISPLAYED
        ? "The onboarding UI rendered a scannable QR code."
        : eventType === WHATSAPP_RUNTIME_EVENT_TYPES.UI_CONNECTED
          ? "The onboarding UI rendered the connected state."
          : "The Inbox became usable in the browser.",
      metadata: {
        channelId,
        connectionAttemptId: body?.connectionAttemptId?.trim() || null,
        qrVersion: typeof body?.qrVersion === "number" ? body.qrVersion : null,
        requestedAt: requestedAt?.toISOString() ?? null,
        observedAt: observedAt.toISOString(),
        requestedToObservedMs: requestedAt
          ? Math.max(0, observedAt.getTime() - requestedAt.getTime())
          : null,
        connectedAt: channel.connectedAt?.toISOString() ?? null,
        connectedToObservedMs: channel.connectedAt
          ? Math.max(0, observedAt.getTime() - channel.connectedAt.getTime())
          : null
      }
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to record WhatsApp timing.";
    return NextResponse.json(
      { error: message === "UNAUTHORIZED" ? "Unauthorized." : message === "FORBIDDEN" ? "Forbidden." : message },
      { status: message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 400 }
    );
  }
}
