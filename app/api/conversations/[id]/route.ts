import { NextRequest, NextResponse } from "next/server";
import { requireCurrentApiAgent } from "@/lib/auth/current-user";
import { deleteConversation, updateConversation, updateConversationTags } from "@/lib/conversations";
import { findAgentInWorkspace } from "@/lib/db-contacts";
import { getInboxData } from "@/lib/inbox";
import { ConversationStatus } from "@/lib/db-types";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const agent = await requireCurrentApiAgent();
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
    const agent = await requireCurrentApiAgent();
    const { id } = await context.params;
    const body = (await request.json()) as {
      status?: ConversationStatus;
      assigneeId?: string | null;
      teammateIds?: string[];
      snoozedUntil?: string | null;
      tags?: string[];
      markAsRead?: boolean;
    };

    if (body.status !== undefined && !Object.values(ConversationStatus).includes(body.status)) {
      return NextResponse.json({ error: "Invalid conversation status." }, { status: 400 });
    }

    const teammateIds = Array.from(
      new Set((body.teammateIds ?? []).filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean))
    );

    for (const teammateId of teammateIds) {
      const teammate = await findAgentInWorkspace(teammateId, agent.workspaceId);
      if (!teammate) {
        return NextResponse.json({ error: "A selected teammate was not found." }, { status: 400 });
      }
    }

    const conversation = await updateConversation(id, {
      status: body.status,
      assigneeId: body.assigneeId,
      teammateIds: body.teammateIds === undefined ? undefined : teammateIds,
      snoozedUntil: body.snoozedUntil === undefined ? undefined : body.snoozedUntil ? new Date(body.snoozedUntil) : null,
      unreadCount: body.markAsRead ? 0 : undefined
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

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    await requireCurrentApiAgent();
    const { id } = await context.params;
    const conversation = await deleteConversation(id);
    return NextResponse.json({ conversation });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error && error.message === "UNAUTHORIZED"
            ? "Unauthorized."
            : error instanceof Error
              ? error.message
              : "Unable to delete conversation."
      },
      { status: error instanceof Error && error.message === "UNAUTHORIZED" ? 401 : 400 }
    );
  }
}
