import { NextRequest, NextResponse } from "next/server";
import { requireCurrentApiAgent } from "@/lib/auth/current-user";
import { createConversationNote, deleteConversationNote, updateConversationNote } from "@/lib/conversations";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    await requireCurrentApiAgent();
    const { id } = await context.params;
    const body = (await request.json()) as {
      body?: string;
    };

    const text = body.body?.trim();
    if (!text) {
      return NextResponse.json({ error: "Note body is required." }, { status: 400 });
    }

    const note = await createConversationNote({
      conversationId: id,
      body: text
    });

    return NextResponse.json({ note }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error && error.message === "UNAUTHORIZED"
            ? "Unauthorized."
            : error instanceof Error
              ? error.message
              : "Unable to save note."
      },
      { status: error instanceof Error && error.message === "UNAUTHORIZED" ? 401 : 400 }
    );
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    await requireCurrentApiAgent();
    const { id } = await context.params;
    const body = (await request.json()) as { body?: string; noteId?: string };
    const text = body.body?.trim();

    if (!body.noteId || !text) {
      return NextResponse.json({ error: "Note id and body are required." }, { status: 400 });
    }

    const note = await updateConversationNote({ conversationId: id, noteId: body.noteId, body: text });
    return NextResponse.json({ note });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to update note." },
      { status: error instanceof Error && error.message === "UNAUTHORIZED" ? 401 : 400 }
    );
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    await requireCurrentApiAgent();
    const { id } = await context.params;
    const noteId = new URL(request.url).searchParams.get("noteId")?.trim();

    if (!noteId) {
      return NextResponse.json({ error: "Note id is required." }, { status: 400 });
    }

    await deleteConversationNote({ conversationId: id, noteId });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to delete note." },
      { status: error instanceof Error && error.message === "UNAUTHORIZED" ? 401 : 400 }
    );
  }
}
