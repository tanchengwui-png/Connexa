import { NextRequest, NextResponse } from "next/server";
import { processPendingAutomationJobs } from "@/lib/automation-engine";

function isAuthorized(request: NextRequest) {
  const expectedToken =
    process.env.AUTOMATION_WORKER_TOKEN?.trim() ?? process.env.OUTBOUND_WORKER_TOKEN?.trim();
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
  const workspaceId = url.searchParams.get("workspaceId")?.trim() ?? "";
  const rawLimit = Number(url.searchParams.get("limit") ?? "10");
  const limit = Number.isFinite(rawLimit) ? Math.min(50, Math.max(1, Math.floor(rawLimit))) : 10;
  const result = await processPendingAutomationJobs(limit, workspaceId || undefined);

  return NextResponse.json(result);
}
