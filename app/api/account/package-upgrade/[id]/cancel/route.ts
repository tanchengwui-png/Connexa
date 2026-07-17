import { NextRequest, NextResponse } from "next/server";
import { requireApiManager } from "@/lib/auth/current-user";
import { cancelWorkspacePackageUpgradeInvoice } from "@/lib/workspace-package-upgrades";

export async function POST(
  _request: NextRequest,
  context: {
    params: Promise<{ id: string }>;
  }
) {
  try {
    const manager = await requireApiManager();
    const { id } = await context.params;

    const result = await cancelWorkspacePackageUpgradeInvoice({
      workspaceId: manager.workspaceId,
      upgradeId: id
    });

    return NextResponse.json({ ok: true, invoices: result.invoices }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to cancel upgrade invoice.";
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
