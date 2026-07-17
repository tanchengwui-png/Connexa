import { NextRequest, NextResponse } from "next/server";
import { requireCurrentApiAgent } from "@/lib/auth/current-user";
import { listBillingHistory } from "@/lib/billing-management";

export async function GET(request: NextRequest) {
  try {
    const agent = await requireCurrentApiAgent();
    const page = Number(request.nextUrl.searchParams.get("page") ?? 1);
    const sort = request.nextUrl.searchParams.get("sort") === "asc" ? "asc" : "desc";
    const history = await listBillingHistory(agent.workspaceId, page, 10, sort);
    return NextResponse.json({ history });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load billing history.";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}
