import { NextResponse } from "next/server";
import { requireCurrentApiAgent } from "@/lib/auth/current-user";
import { deleteWorkspaceMessageLogs } from "@/lib/message-logs";

export async function DELETE() {
  try {
    const agent = await requireCurrentApiAgent();
    const result = await deleteWorkspaceMessageLogs(agent.workspaceId);

    return NextResponse.json(
      {
        ok: true,
        result
      },
      { status: 200 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error && error.message === "UNAUTHORIZED"
            ? "Unauthorized."
            : error instanceof Error
              ? error.message
              : "Unable to delete message logs."
      },
      {
        status: error instanceof Error && error.message === "UNAUTHORIZED" ? 401 : 400
      }
    );
  }
}
