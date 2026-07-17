import { NextRequest, NextResponse } from "next/server";
import { requireCurrentApiAgent } from "@/lib/auth/current-user";
import { getSubscriberBillingOverview } from "@/lib/billing-management";

export async function GET(request: NextRequest) {
  try {
    const agent = await requireCurrentApiAgent();
    const page = Number(request.nextUrl.searchParams.get("page") ?? 1);
    const perPage = Number(request.nextUrl.searchParams.get("perPage") ?? 20);
    const billing = await getSubscriberBillingOverview(agent.workspaceId, page, perPage);
    return NextResponse.json(billing);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load billing documents.";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}
