import { createContactImportTemplateBuffer, CONTACT_IMPORT_TEMPLATE_FILENAME } from "@/lib/contact-import";
import { requireCurrentApiAgent } from "@/lib/auth/current-user";

export const runtime = "nodejs";

export async function GET() {
  try {
    await requireCurrentApiAgent();
    const buffer = await createContactImportTemplateBuffer();

    return new Response(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${CONTACT_IMPORT_TEMPLATE_FILENAME}"`,
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return Response.json({ error: "Unauthorized." }, { status: 401 });
    }

    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to generate the contact import template." },
      { status: 400 }
    );
  }
}
