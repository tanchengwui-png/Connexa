import { NextRequest, NextResponse } from "next/server";
import { requireApiManager } from "@/lib/auth/current-user";
import {
  endBasicWhatsAppQrTest,
  getBasicWhatsAppQrTestStatus,
  startBasicWhatsAppQrTest
} from "@/lib/basic-whatsapp-qr-test";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const manager = await requireApiManager();
    return NextResponse.json({ status: getBasicWhatsAppQrTestStatus(manager.workspaceId) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to read basic QR status.";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 403 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const manager = await requireApiManager();
    const body = (await request.json().catch(() => null)) as { reset?: boolean } | null;
    const status = startBasicWhatsAppQrTest(manager.workspaceId, Boolean(body?.reset));
    return NextResponse.json({ accepted: true, status }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to start basic QR test.";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 403 });
  }
}

export async function DELETE() {
  try {
    const manager = await requireApiManager();
    return NextResponse.json({ status: endBasicWhatsAppQrTest(manager.workspaceId) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to end basic QR test.";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 403 });
  }
}
