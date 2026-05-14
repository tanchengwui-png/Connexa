import { NextRequest, NextResponse } from "next/server";
import { requireCurrentApiAgent } from "@/lib/auth/current-user";
import { deleteConversationMessage } from "@/lib/conversations";

type RouteContext = {
  params: Promise<{
    id: string;
    messageId: string;
  }>;
};

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    await requireCurrentApiAgent();
    const { id, messageId } = await context.params;
    const message = await deleteConversationMessage(id, messageId);
    return NextResponse.json({ message });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error && error.message === "UNAUTHORIZED"
            ? "Unauthorized."
            : error instanceof Error
              ? error.message
              : "Unable to delete message."
      },
      { status: error instanceof Error && error.message === "UNAUTHORIZED" ? 401 : 400 }
    );
  }
}
