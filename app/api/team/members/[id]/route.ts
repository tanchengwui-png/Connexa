import { NextRequest, NextResponse } from "next/server";
import { removeWorkspaceMember, updateWorkspaceMember } from "@/lib/team";
import { AgentRole, AgentStatus } from "@/lib/db-types";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as {
      role?: AgentRole;
      status?: AgentStatus;
      phone?: string | null;
    };

    if (!body.role || !Object.values(AgentRole).includes(body.role)) {
      return NextResponse.json({ error: "Invalid role." }, { status: 400 });
    }

    if (!body.status || !Object.values(AgentStatus).includes(body.status)) {
      return NextResponse.json({ error: "Invalid status." }, { status: 400 });
    }

    const member = await updateWorkspaceMember({
      agentId: id,
      role: body.role,
      status: body.status,
      phone: body.phone ?? null
    });

    return NextResponse.json({ member }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update team member.";
    const status =
      message === "UNAUTHORIZED"
        ? 401
        : message === "FORBIDDEN" || message === "EMAIL_NOT_VERIFIED"
          ? 403
          : 400;

    return NextResponse.json(
      { error: status === 401 ? "Unauthorized." : status === 403 ? "Forbidden." : message },
      { status }
    );
  }
}

export async function DELETE(_: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    await removeWorkspaceMember(id);
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to remove team member.";
    const status =
      message === "UNAUTHORIZED"
        ? 401
        : message === "FORBIDDEN" || message === "EMAIL_NOT_VERIFIED"
          ? 403
          : 400;

    return NextResponse.json(
      { error: status === 401 ? "Unauthorized." : status === 403 ? "Forbidden." : message },
      { status }
    );
  }
}
