import { NextRequest, NextResponse } from "next/server";
import { recordOutboundWorkerHeartbeat } from "@/lib/outbound-message-jobs";

function isAuthorized(request: NextRequest) {
  const expectedToken = process.env.OUTBOUND_WORKER_TOKEN?.trim();
  if (!expectedToken) {
    return false;
  }

  const headerToken = request.headers.get("x-worker-token")?.trim();
  const bearerToken = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  return headerToken === expectedToken || bearerToken === expectedToken;
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized worker request." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    workspaceId?: string | null;
    workerLabel?: string | null;
  } | null;
  const workspaceId = body?.workspaceId?.trim();
  const workerLabel = body?.workerLabel?.trim();

  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required." }, { status: 400 });
  }

  if (!workerLabel) {
    return NextResponse.json({ error: "workerLabel is required." }, { status: 400 });
  }

  const result = await recordOutboundWorkerHeartbeat({
    workspaceId,
    workerLabel
  });

  return NextResponse.json({ ok: true, result }, { status: 200 });
}
