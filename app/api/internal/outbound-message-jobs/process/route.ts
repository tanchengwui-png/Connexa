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

  const url = new URL(request.url);
  const rawLimit = Number(url.searchParams.get("limit") ?? "10");
  const limit = Number.isFinite(rawLimit) ? Math.min(50, Math.max(1, Math.floor(rawLimit))) : 10;
  const result = await processPendingOutboundMessageJobs(limit);

  return NextResponse.json(result);
}
