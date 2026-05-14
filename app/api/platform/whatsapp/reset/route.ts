import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiPlatformAdmin } from "@/lib/platform-auth/current-user";
import { deleteWorkspaceWhatsAppClientSession } from "@/lib/whatsapp-runtime";

export async function POST(request: NextRequest) {
  try {
    await requireApiPlatformAdmin();
    const body = (await request.json().catch(() => null)) as
      | {
          workspaceId?: string;
        }
      | null;

    const workspaceId = String(body?.workspaceId ?? "").trim();
    if (!workspaceId) {
      throw new Error("Workspace ID is required.");
    }

    const workspace = await prisma.workspace.findUnique({
      where: {
        id: workspaceId
      },
      select: {
        id: true,
        name: true
      }
    });

    if (!workspace) {
      throw new Error("Workspace not found.");
    }

    await deleteWorkspaceWhatsAppClientSession(workspace.id);

    return NextResponse.json({
      ok: true,
      workspaceId: workspace.id,
      workspaceName: workspace.name
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to reset the WhatsApp session.";
    return NextResponse.json(
      { error: message === "UNAUTHORIZED" ? "Unauthorized." : message },
      { status: message === "UNAUTHORIZED" ? 401 : 400 }
    );
  }
}
