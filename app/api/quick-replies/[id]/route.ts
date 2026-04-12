import { NextResponse } from "next/server";
import { requireCurrentApiAgent } from "@/lib/auth/current-user";
import { deleteQuickReply, updateQuickReply } from "@/lib/quick-replies";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    await requireCurrentApiAgent();
    const { id } = await context.params;
    await deleteQuickReply(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error && error.message === "UNAUTHORIZED"
            ? "Unauthorized."
            : "Unable to delete quick reply."
      },
      { status: error instanceof Error && error.message === "UNAUTHORIZED" ? 401 : 400 }
    );
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    await requireCurrentApiAgent();
    const { id } = await context.params;
    const body = (await request.json()) as {
      title?: string;
      shortcut?: string;
      category?: string;
      isPinned?: boolean;
      body?: string;
    };

    const quickReply = await updateQuickReply(id, {
      title: body.title,
      shortcut: body.shortcut,
      category: body.category,
      isPinned: body.isPinned,
      body: body.body
    });

    return NextResponse.json({ quickReply });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error && error.message === "UNAUTHORIZED"
            ? "Unauthorized."
            : error instanceof Error
              ? error.message
              : "Unable to update quick reply."
      },
      { status: error instanceof Error && error.message === "UNAUTHORIZED" ? 401 : 400 }
    );
  }
}
