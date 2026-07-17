import { NextRequest, NextResponse } from "next/server";
import { processPendingOutboundMessageJobs } from "@/lib/outbound-message-jobs";

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

  try {
    const url = new URL(request.url);
    const workspaceId = url.searchParams.get("workspaceId")?.trim() ?? "";
    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required." }, { status: 400 });
    }

    const rawLimit = Number(url.searchParams.get("limit") ?? "10");
    const limit = Number.isFinite(rawLimit) ? Math.min(50, Math.max(1, Math.floor(rawLimit))) : 10;
    const result = await processPendingOutboundMessageJobs(limit, workspaceId);

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to process outbound message jobs.";
    console.error("[outbound-worker] process request failed", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
