import { requireCurrentApiAgent } from "@/lib/auth/current-user";
import {
  CONTACT_IMPORT_EMPTY_FIELD_MESSAGE,
  CONTACT_IMPORT_INVALID_TEMPLATE_MESSAGE,
  executeContactImport,
  previewContactImport,
  validateContactImportUpload,
  type ContactImportDuplicateBehavior
} from "@/lib/contact-import";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const agent = await requireCurrentApiAgent();
    const formData = await request.formData();
    const mode = normalizeMode(formData.get("mode"));
    const duplicateBehavior = normalizeDuplicateBehavior(formData.get("duplicateBehavior"));
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return Response.json({ error: CONTACT_IMPORT_INVALID_TEMPLATE_MESSAGE }, { status: 400 });
    }

    validateContactImportUpload(file);
    const buffer = Buffer.from(await file.arrayBuffer());

    if (mode === "preview") {
      const preview = await previewContactImport({
        buffer,
        workspaceId: agent.workspaceId,
        duplicateBehavior
      });

      return Response.json({
        mode,
        summary: preview.summary
      });
    }

    const result = await executeContactImport({
      buffer,
      workspaceId: agent.workspaceId,
      uploadedById: agent.id,
      originalFilename: file.name,
      duplicateBehavior
    });

    return Response.json({
      mode,
      importId: result.importRecord.id,
      summary: result.summary,
      status: result.importRecord.status
    });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return Response.json({ error: "Unauthorized." }, { status: 401 });
    }

    const message = error instanceof Error ? error.message : "Unable to import contacts.";
    return Response.json({ error: message }, { status: 400 });
  }
}

function normalizeMode(value: FormDataEntryValue | null) {
  return value === "import" ? "import" : "preview";
}

function normalizeDuplicateBehavior(value: FormDataEntryValue | null): ContactImportDuplicateBehavior {
  return value === "update" ? "update" : "skip";
}
