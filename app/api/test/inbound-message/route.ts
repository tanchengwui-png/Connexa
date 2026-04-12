import { NextResponse } from "next/server";
import { requireApiManager } from "@/lib/auth/current-user";
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
      ignoreAutomationPause: Boolean(body.ignoreAutomationPause)
    });

    return NextResponse.json(result, { status: 201 });
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
