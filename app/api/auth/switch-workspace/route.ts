import { NextRequest, NextResponse } from "next/server";
import { requireCurrentApiAgent } from "@/lib/auth/current-user";
import { switchWorkspaceSession } from "@/lib/auth/workspace-switch";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    agentId?: string;
  };

  try {
    const agent = await requireCurrentApiAgent();
    const result = await switchWorkspaceSession({
      currentAccountId: agent.accountId,
      targetAgentId: body.agentId ?? ""
    });

    return NextResponse.json({ ok: true, redirectTo: result.redirectTo });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to switch workspace.";
    const status =
      message === "UNAUTHORIZED" ? 401 : message === "EMAIL_NOT_VERIFIED" ? 403 : 400;

    return NextResponse.json(
      { error: status === 401 ? "Unauthorized." : status === 403 ? "Forbidden." : message },
      { status }
    );
  }
}
