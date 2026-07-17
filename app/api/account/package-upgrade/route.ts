import { NextRequest, NextResponse } from "next/server";
import { requireApiManager } from "@/lib/auth/current-user";
import { createWorkspacePackageUpgradeInvoice } from "@/lib/workspace-package-upgrades";

export async function POST(request: NextRequest) {
  try {
    const manager = await requireApiManager();
    const body = (await request.json()) as {
      targetPlan?: string;
      billingPeriod?: string;
    };

    const result = await createWorkspacePackageUpgradeInvoice({
      workspaceId: manager.workspaceId,
      requestedByAgentId: manager.id,
      targetPlan: body.targetPlan ?? "",
      billingPeriod: body.billingPeriod ?? "monthly"
    });

    return NextResponse.json({ ok: true, invoices: result.invoices }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create upgrade invoice.";
    const status =
      message === "UNAUTHORIZED"
        ? 401
        : message === "FORBIDDEN"
          ? 403
          : message === "EMAIL_NOT_VERIFIED"
            ? 403
            : 400;
    return NextResponse.json({ error: status === 401 ? "Unauthorized." : status === 403 ? "Forbidden." : message }, { status });
  }
}
