import { NextRequest, NextResponse } from "next/server";
import { resendWorkspaceInvite, revokeWorkspaceInvite } from "@/lib/team";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function PATCH(_: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    await resendWorkspaceInvite(id);
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to resend invite.";
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
    await revokeWorkspaceInvite(id);
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to revoke invite.";
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
