import { NextRequest } from "next/server";
import { requireCurrentApiAgent } from "@/lib/auth/current-user";
import {
  type InboxRealtimeChatStateEvent,
  subscribeToInboxRealtime,
  type InboxRealtimeAckEvent,
  type InboxRealtimeConversationEvent,
  type InboxRealtimeMessageEvent,
  type WhatsAppConnectionRealtimeEvent
} from "@/lib/inbox-realtime";
import { getWorkspaceWhatsAppRuntimeStatus } from "@/lib/whatsapp-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type InboxRealtimeStreamEvent =
  | { event: "inbox:message"; payload: InboxRealtimeMessageEvent }
  | { event: "inbox:ack"; payload: InboxRealtimeAckEvent }
  | { event: "inbox:conversation"; payload: InboxRealtimeConversationEvent }
  | { event: "inbox:chat-state"; payload: InboxRealtimeChatStateEvent }
  | { event: "whatsapp:connection"; payload: WhatsAppConnectionRealtimeEvent };

export async function GET(request: NextRequest) {
  const agent = await requireCurrentApiAgent();
  const channelId = request.nextUrl.searchParams.get("channelId")?.trim() || null;
  const conversationId = request.nextUrl.searchParams.get("conversationId")?.trim() || null;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const writeEvent = (input: InboxRealtimeStreamEvent) => {
        if (closed) return;
        controller.enqueue(
          encoder.encode(`event: ${input.event}\ndata: ${JSON.stringify(input.payload)}\n\n`)
        );
      };

      const shouldEmit = (payload: { workspaceId: string; channelId: string | null; conversationId: string | null }) => {
        if (payload.workspaceId !== agent.workspaceId) {
          return false;
        }

        if (channelId && payload.channelId !== channelId) {
          return false;
        }

        if (conversationId && payload.conversationId !== conversationId) {
          return false;
        }

        return true;
      };

      const unsubscribeMessage = subscribeToInboxRealtime("inbox:message", (payload) => {
        const event = payload as InboxRealtimeMessageEvent;
        if (!shouldEmit(event)) {
          return;
        }

        writeEvent({ event: "inbox:message", payload: event });
      });

      const unsubscribeAck = subscribeToInboxRealtime("inbox:ack", (payload) => {
        const event = payload as InboxRealtimeAckEvent;
        if (!shouldEmit(event)) {
          return;
        }

        writeEvent({ event: "inbox:ack", payload: event });
      });

      const unsubscribeConversation = subscribeToInboxRealtime("inbox:conversation", (payload) => {
        const event = payload as InboxRealtimeConversationEvent;
        if (!shouldEmit(event)) {
          return;
        }

        writeEvent({ event: "inbox:conversation", payload: event });
      });

      const unsubscribeChatState = subscribeToInboxRealtime("inbox:chat-state", (payload) => {
        const event = payload as InboxRealtimeChatStateEvent;
        if (!shouldEmit(event)) {
          return;
        }

        writeEvent({ event: "inbox:chat-state", payload: event });
      });

      const unsubscribeWhatsAppConnection = subscribeToInboxRealtime("whatsapp:connection", (payload) => {
        const event = payload as WhatsAppConnectionRealtimeEvent;
        if (event.workspaceId !== agent.workspaceId || (channelId && event.channelId !== channelId)) {
          return;
        }

        writeEvent({ event: "whatsapp:connection", payload: event });
      });

      // Subscribe first, then request the sender's authoritative runtime
      // snapshot. If a live event races the snapshot, attempt ID + sequence
      // ordering lets the browser reject whichever state is older. This also
      // replays a valid QR after refresh without restarting Chromium.
      if (channelId) {
        void getWorkspaceWhatsAppRuntimeStatus({
          workspaceId: agent.workspaceId,
          agentId: agent.id,
          channelId
        }).then((status) => {
          const channel = status.channel as {
            id?: string;
            connectionStatus?: string;
            displayName?: string | null;
            phoneNumber?: string | null;
            connectedAt?: Date | string | null;
            lastError?: string | null;
          } | null;
          if (!channel || channel.id !== channelId) return;
          const connectedAt = channel.connectedAt
            ? channel.connectedAt instanceof Date
              ? channel.connectedAt.toISOString()
              : new Date(channel.connectedAt).toISOString()
            : null;
          writeEvent({
            event: "whatsapp:connection",
            payload: {
              workspaceId: agent.workspaceId,
              channelId,
              connectionStatus: status.runtimeStatus ?? channel.connectionStatus ?? "DISCONNECTED",
              updatedAt: status.connectionUpdatedAt ?? new Date().toISOString(),
              displayName: channel.displayName ?? null,
              phoneNumber: channel.phoneNumber ?? null,
              connectedAt,
              lastError: status.lastError ?? channel.lastError ?? null,
              connectionAttemptId: status.connectionAttemptId ?? null,
              eventSequence: status.connectionEventSequence ?? undefined,
              qrVersion: status.qrVersion ?? undefined,
              qrCodeDataUrl: status.qrCodeDataUrl ?? null,
              qrCodeGeneratedAt: status.qrCodeGeneratedAt ?? null,
              qrCodeExpiresAt: status.qrCodeExpiresAt ?? null,
              qrCodeExpired: status.qrCodeExpired ?? false,
              snapshot: true
            }
          });
        }).catch((error) => {
          console.warn(
            `[inbox-events] WhatsApp snapshot replay failed workspace=${agent.workspaceId} channel=${channelId}: ${
              error instanceof Error ? error.message : "Unknown sender error."
            }`
          );
        });
      }

      const heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(": keepalive\n\n"));
      }, 25000);

      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribeMessage();
        unsubscribeAck();
        unsubscribeConversation();
        unsubscribeChatState();
        unsubscribeWhatsAppConnection();
        request.signal.removeEventListener("abort", close);
        try {
          controller.close();
        } catch {}
      };

      request.signal.addEventListener("abort", close);
      controller.enqueue(encoder.encode("retry: 2000\n: connected\n\n"));
    }
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no"
    }
  });
}
