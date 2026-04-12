import { ConversationStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { requireCurrentApiAgent } from "@/lib/auth/current-user";
import { updateConversation, updateConversationTags } from "@/lib/conversations";
import { getInboxData } from "@/lib/inbox";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    await requireCurrentApiAgent();
    const { id } = await context.params;
    const { selectedConversation: conversation } = await getInboxData(id);

    if (!conversation) {
      return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
    }

    return NextResponse.json({ conversation });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error && error.message === "UNAUTHORIZED"
            ? "Unauthorized."
            : "Unable to load conversation."
      },
      { status: error instanceof Error && error.message === "UNAUTHORIZED" ? 401 : 400 }
    );
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    await requireCurrentApiAgent();
    const { id } = await context.params;
    const body = (await request.json()) as {
      status?: ConversationStatus;
      assigneeId?: string | null;
      snoozedUntil?: string | null;
      tags?: string[];
    };

    if (body.status !== undefined && !Object.values(ConversationStatus).includes(body.status)) {
      return NextResponse.json({ error: "Invalid conversation status." }, { status: 400 });
    }

    const conversation = await updateConversation(id, {
      status: body.status,
      assigneeId: body.assigneeId,
      snoozedUntil: body.snoozedUntil === undefined ? undefined : body.snoozedUntil ? new Date(body.snoozedUntil) : null
    });

    const tags = body.tags !== undefined ? await updateConversationTags(id, body.tags) : undefined;

    return NextResponse.json({ conversation, tags });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error && error.message === "UNAUTHORIZED"
            ? "Unauthorized."
            : error instanceof Error
              ? error.message
              : "Unable to update conversation."
      },
      { status: error instanceof Error && error.message === "UNAUTHORIZED" ? 401 : 400 }
    );
  }
}
