import { NextRequest, NextResponse } from "next/server";
import { requireApiManager } from "@/lib/auth/current-user";
import {
  disconnectWorkspaceWhatsAppClient,
  ensureWorkspaceWhatsAppClient,
  getWorkspaceWhatsAppRuntimeStatus,
  syncWorkspaceHistory
} from "@/lib/whatsapp-runtime";

export async function GET() {
  try {
    const manager = await requireApiManager();
    const status = await getWorkspaceWhatsAppRuntimeStatus({
      workspaceId: manager.workspaceId,
      agentId: manager.id
    });

    return NextResponse.json({ status }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error && error.message === "UNAUTHORIZED"
            ? "Unauthorized."
            : error instanceof Error && error.message === "FORBIDDEN"
              ? "Forbidden."
              : error instanceof Error
                ? error.message
                : "Unable to load WhatsApp status."
      },
      {
        status:
          error instanceof Error && error.message === "UNAUTHORIZED"
            ? 401
            : error instanceof Error && error.message === "FORBIDDEN"
              ? 403
              : 400
      }
    );
  }
}

export async function POST(_request: NextRequest) {
  try {
    const manager = await requireApiManager();
    await ensureWorkspaceWhatsAppClient({
      workspaceId: manager.workspaceId,
      agentId: manager.id
    });

    const status = await getWorkspaceWhatsAppRuntimeStatus({
      workspaceId: manager.workspaceId,
      agentId: manager.id
    });

    return NextResponse.json({ status }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error && error.message === "UNAUTHORIZED"
            ? "Unauthorized."
            : error instanceof Error && error.message === "FORBIDDEN"
              ? "Forbidden."
              : error instanceof Error
                ? error.message
                : "Unable to start WhatsApp login."
      },
      {
        status:
          error instanceof Error && error.message === "UNAUTHORIZED"
            ? 401
            : error instanceof Error && error.message === "FORBIDDEN"
              ? 403
              : 400
      }
    );
  }
}

export async function DELETE() {
  try {
    const manager = await requireApiManager();
    await disconnectWorkspaceWhatsAppClient(manager.workspaceId);
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error && error.message === "UNAUTHORIZED"
            ? "Unauthorized."
            : error instanceof Error && error.message === "FORBIDDEN"
              ? "Forbidden."
              : error instanceof Error
                ? error.message
                : "Unable to disconnect WhatsApp."
      },
      {
        status:
          error instanceof Error && error.message === "UNAUTHORIZED"
            ? 401
            : error instanceof Error && error.message === "FORBIDDEN"
              ? 403
              : 400
      }
    );
  }
}

export async function PATCH() {
  try {
    const manager = await requireApiManager();
    const result = await syncWorkspaceHistory(manager.workspaceId);
    const status = await getWorkspaceWhatsAppRuntimeStatus({
      workspaceId: manager.workspaceId,
      agentId: manager.id
    });

    return NextResponse.json({ ok: true, result, status }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error && error.message === "UNAUTHORIZED"
            ? "Unauthorized."
            : error instanceof Error && error.message === "FORBIDDEN"
              ? "Forbidden."
              : error instanceof Error
                ? error.message
                : "Unable to sync WhatsApp history."
      },
      {
        status:
          error instanceof Error && error.message === "UNAUTHORIZED"
            ? 401
            : error instanceof Error && error.message === "FORBIDDEN"
              ? 403
              : 400
      }
    );
  }
}
