import { NextRequest, NextResponse } from "next/server";
import { requireApiManager } from "@/lib/auth/current-user";
import { scheduleWorkspacePackageDowngrade } from "@/lib/workspace-package-upgrades";

export async function POST(request: NextRequest) {
  try {
    const manager = await requireApiManager();
    const body = (await request.json()) as { targetPlan?: string; billingPeriod?: string };
    const result = await scheduleWorkspacePackageDowngrade({
      workspaceId: manager.workspaceId,
      requestedByAgentId: manager.id,
      targetPlan: body.targetPlan ?? "",
      billingPeriod: body.billingPeriod ?? "monthly"
    });
    return NextResponse.json({ ok: true, invoices: result.invoices });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to schedule package downgrade.";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}
