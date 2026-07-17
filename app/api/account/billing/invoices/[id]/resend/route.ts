import { NextResponse } from "next/server";
import { requireCurrentApiAgent } from "@/lib/auth/current-user";
import { resendInvoice } from "@/lib/billing-management";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const agent = await requireCurrentApiAgent();
    const { id } = await context.params;
    await resendInvoice(agent.workspaceId, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to resend invoice.";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}
