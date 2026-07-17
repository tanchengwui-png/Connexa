import { NextRequest } from "next/server";
import { requireCurrentApiAgent } from "@/lib/auth/current-user";
import {
  type InboxRealtimeChatStateEvent,
  subscribeToInboxRealtime,
  type InboxRealtimeAckEvent,
  type InboxRealtimeConversationEvent,
  type InboxRealtimeMessageEvent
} from "@/lib/inbox-realtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type InboxRealtimeStreamEvent =
  | { event: "inbox:message"; payload: InboxRealtimeMessageEvent }
  | { event: "inbox:ack"; payload: InboxRealtimeAckEvent }
  | { event: "inbox:conversation"; payload: InboxRealtimeConversationEvent }
  | { event: "inbox:chat-state"; payload: InboxRealtimeChatStateEvent };

export async function GET(request: NextRequest) {
  const agent = await requireCurrentApiAgent();
  const channelId = request.nextUrl.searchParams.get("channelId")?.trim() || null;
  const conversationId = request.nextUrl.searchParams.get("conversationId")?.trim() || null;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const writeEvent = (input: InboxRealtimeStreamEvent) => {
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

      const heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(": keepalive\n\n"));
      }, 25000);

      const close = () => {
        clearInterval(heartbeat);
        unsubscribeMessage();
        unsubscribeAck();
        unsubscribeConversation();
        unsubscribeChatState();
        request.signal.removeEventListener("abort", close);
        try {
          controller.close();
        } catch {}
      };

      request.signal.addEventListener("abort", close);
      controller.enqueue(encoder.encode(": connected\n\n"));
    }
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8"
    }
  });
}
