import { NextResponse } from "next/server";
import { requireApiPlatformAdmin } from "@/lib/platform-auth/current-user";
import { getPlatformTransactionDocumentPdf } from "@/lib/platform-transactions";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    await requireApiPlatformAdmin();
    const { id } = await context.params;
    const searchParams = new URL(request.url).searchParams;
    const type = searchParams.get("type");
    const disposition = searchParams.get("disposition") === "inline" ? "inline" : "attachment";

    if (type !== "invoice" && type !== "receipt") {
      return NextResponse.json({ error: "Unknown document type." }, { status: 404 });
    }

    const document = await getPlatformTransactionDocumentPdf(id, type);
    return new NextResponse(new Uint8Array(document.buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${disposition}; filename="${document.fileName}"`,
        "Cache-Control": "private, no-store"
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load transaction document.";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}
