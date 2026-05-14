import { NextResponse } from "next/server";
import { requireApiManager } from "@/lib/auth/current-user";
import { findConversationHeader, listConversationMessages } from "@/lib/db-conversations";
import { MessageDirection } from "@/lib/db-types";
import { ingestSimulatedInboundMessage } from "@/lib/whatsapp";

export async function POST(request: Request) {
  try {
    const manager = await requireApiManager();
    const body = (await request.json()) as {
      body?: string;
      phone?: string | null;
      displayName?: string | null;
      conversationId?: string | null;
      sentAt?: string | null;
      ignoreAutomationPause?: boolean;
    };

    const parsedSentAt =
      body.sentAt && !Number.isNaN(Date.parse(body.sentAt)) ? new Date(body.sentAt) : null;

    const result = await ingestSimulatedInboundMessage({
      workspaceId: manager.workspaceId,
      body: body.body ?? "",
      phone: body.phone,
      displayName: body.displayName,
      conversationId: body.conversationId,
      sentAt: parsedSentAt,
      ignoreAutomationPause: Boolean(body.ignoreAutomationPause),
      isTest: true
    });

    const conversationHeader = await findConversationHeader(result.conversationId, manager.workspaceId, true);
    const messages = await listConversationMessages(result.conversationId);

    const conversation = conversationHeader
      ? {
          id: conversationHeader.id,
          contactName: conversationHeader.contactName,
          phone: conversationHeader.phone,
          messages: messages.map((message) => ({
            id: message.id,
            attachmentMimeType: message.attachmentMimeType,
            attachmentName: message.attachmentName,
            attachmentUrl: message.attachmentUrl,
            body: message.body,
            direction:
              message.direction === MessageDirection.INBOUND ? ("inbound" as const) : ("outbound" as const),
            sender: message.sender,
            sentAt: formatMessageTime(message.sentAt),
            sentAtIso: message.sentAt.toISOString()
          }))
        }
      : null;

    return NextResponse.json({ conversation }, { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message === "UNAUTHORIZED"
          ? "Unauthorized."
          : error.message === "FORBIDDEN"
            ? "Only managers can simulate inbound messages."
            : error.message
        : "Unable to simulate inbound message.";

    return NextResponse.json(
      { error: message },
      {
        status:
          error instanceof Error && error.message === "UNAUTHORIZED"
            ? 401
            : error instanceof Error && error.message === "FORBIDDEN"
              ? 403
              : 400
      }
    );
  }
}

function formatMessageTime(date: Date) {
  return new Intl.DateTimeFormat("en-MY", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Kuala_Lumpur"
  }).format(date);
}
