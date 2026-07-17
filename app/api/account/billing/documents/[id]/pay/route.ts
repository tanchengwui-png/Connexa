import { NextResponse } from "next/server";
import { requireCurrentApiAgent } from "@/lib/auth/current-user";
import { beginSubscriberInvoicePayment } from "@/lib/billing-management";
import { beginWorkspacePackageUpgradeInvoicePayment } from "@/lib/workspace-package-upgrades";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const manager = await requireCurrentApiAgent();
    const { id: encodedId } = await context.params;
    const documentId = decodeURIComponent(encodedId);
    const [source, id] = documentId.split(":", 2);
    if (!id) {
      throw new Error("This invoice is not linked to an available online payment.");
    }
    const result =
      source === "upgrade"
        ? await beginWorkspacePackageUpgradeInvoicePayment({
            workspaceId: manager.workspaceId,
            upgradeId: id,
            requestedByName: manager.name,
            requestedByEmail: manager.email
          })
        : source === "invoice"
          ? await beginSubscriberInvoicePayment({
              workspaceId: manager.workspaceId,
              invoiceId: id,
              requestedByName: manager.name,
              requestedByEmail: manager.email
            })
          : (() => {
              throw new Error("This invoice is not linked to an available online payment.");
            })();
    return NextResponse.json({ paymentUrl: result.paymentUrl });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to start invoice payment.";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}
