import { NextRequest, NextResponse } from "next/server";
import { requireApiManager } from "@/lib/auth/current-user";
import { prisma } from "@/lib/prisma";
import { resolveWhatsAppQrPresentation } from "@/lib/whatsapp-qr-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function resolveConnectionState(status: string) {
  if (["CONNECTED", "READY", "SYNCING_HISTORY"].includes(status)) return "connected" as const;
  if (status === "DISCONNECTED") return "disconnected" as const;
  if (status === "REAUTH_REQUIRED") return "reconnection_required" as const;
  if (status === "ERROR" || status === "AUTH_FAILED") return "recovering" as const;
  return "unknown" as const;
}

export async function GET(request: NextRequest) {
  try {
    const manager = await requireApiManager();
    const channelId = request.nextUrl.searchParams.get("channelId")?.trim();
    if (!channelId) {
      return NextResponse.json({ error: "A WhatsApp channel is required." }, { status: 400 });
    }

    const channel = await prisma.whatsAppChannel.findFirst({
      where: { id: channelId, workspaceId: manager.workspaceId },
      select: {
        id: true,
        connectionStatus: true,
        displayName: true,
        phoneNumber: true,
        qrCodeDataUrl: true,
        qrCodeUpdatedAt: true,
        lastError: true,
        connectedAt: true,
        latestHealthCheckAt: true,
        lastHealthyAt: true,
        nextRecoveryAt: true,
        updatedAt: true
      }
    });

    if (!channel) {
      return NextResponse.json({ error: "WhatsApp channel not found." }, { status: 404 });
    }

    const qr = resolveWhatsAppQrPresentation({
      runtimePresent: channel.connectionStatus === "QR_READY",
      runtimeStatus: channel.connectionStatus,
      qrCodeDataUrl: channel.qrCodeDataUrl,
      qrCodeGeneratedAt: channel.qrCodeUpdatedAt
    });

    return NextResponse.json(
      {
        status: {
          channelId: channel.id,
          connectionStatus: channel.connectionStatus,
          displayName: channel.displayName,
          phoneNumber: channel.phoneNumber,
          lastError: channel.lastError,
          connectedAt: channel.connectedAt?.toISOString() ?? null,
          updatedAt: channel.updatedAt.toISOString(),
          userConnectionState: resolveConnectionState(channel.connectionStatus),
          lastHealthCheckAt: channel.latestHealthCheckAt?.toISOString() ?? null,
          lastHealthyAt: channel.lastHealthyAt?.toISOString() ?? null,
          nextRecoveryAt: channel.nextRecoveryAt?.toISOString() ?? null,
          ...qr
        }
      },
      {
        headers: {
          "Cache-Control": "no-store, max-age=0"
        }
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load WhatsApp connection status.";
    return NextResponse.json(
      { error: message === "UNAUTHORIZED" ? "Unauthorized." : message === "FORBIDDEN" ? "Forbidden." : message },
      { status: message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 400 }
    );
  }
}
