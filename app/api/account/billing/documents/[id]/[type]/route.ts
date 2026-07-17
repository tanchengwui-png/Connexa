import { NextResponse } from "next/server";
import { requireCurrentApiAgent } from "@/lib/auth/current-user";
import { getBillingDocumentPdf } from "@/lib/billing-management";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; type: string }> }
) {
  try {
    const agent = await requireCurrentApiAgent();
    const { id: encodedId, type } = await context.params;
    if (type !== "invoice" && type !== "receipt") {
      return NextResponse.json({ error: "Unknown document type." }, { status: 404 });
    }
    const document = await getBillingDocumentPdf(
      agent.workspaceId,
      decodeURIComponent(encodedId),
      type
    );
    return new NextResponse(new Uint8Array(document.buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${document.fileName}"`,
        "Cache-Control": "private, no-store"
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to download billing document.";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}
