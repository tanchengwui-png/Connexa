import { NextRequest, NextResponse } from "next/server";
import { requireApiManager } from "@/lib/auth/current-user";
import { createInvite } from "@/lib/auth/invites";
import { AgentRole } from "@/lib/db-types";
import { findWorkspaceNameById } from "@/lib/db-auth";

export async function POST(request: NextRequest) {
  try {
    const manager = await requireApiManager();
    const body = (await request.json()) as {
      email?: string;
      role?: AgentRole;
    };

    if (!body.role || !Object.values(AgentRole).includes(body.role)) {
      return NextResponse.json({ error: "Invalid role." }, { status: 400 });
    }

    const workspace = await findWorkspaceNameById(manager.workspaceId);

    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found." }, { status: 400 });
    }

    await createInvite({
      workspaceId: manager.workspaceId,
      invitedById: manager.id,
      inviterName: manager.name,
      workspaceName: workspace.name,
      email: body.email ?? "",
      role: body.role
    });

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to send invite.";
    const status =
      message === "UNAUTHORIZED"
        ? 401
        : message === "FORBIDDEN"
          ? 403
          : message === "EMAIL_NOT_VERIFIED"
            ? 403
            : 400;
    return NextResponse.json({ error: status === 401 ? "Unauthorized." : status === 403 ? "Forbidden." : message }, { status });
  }
}
