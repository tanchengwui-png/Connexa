import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { assertWorkspaceHasActiveContactCapacity } from "@/lib/package-feature-limits";
import { normalizeStoredPhone } from "@/lib/phone";

export const CONTACT_IMPORT_TEMPLATE_FILENAME = "contact_import_template.xlsx";
export const CONTACT_IMPORT_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const CONTACT_IMPORT_TEMPLATE_HEADERS = ["Name", "Phone", "Display Name", "Tag"] as const;
export const CONTACT_IMPORT_REQUIRED_HEADERS = ["Name", "Phone"] as const;
export const CONTACT_IMPORT_EMPTY_FIELD_MESSAGE =
  "Import failed. Some rows have empty Name or Phone fields. Please complete the template before uploading.";
export const CONTACT_IMPORT_INVALID_TEMPLATE_MESSAGE =
  "Invalid template format. Please use the provided template.";
export const CONTACT_IMPORT_EMPTY_FILE_MESSAGE = "Import failed. The uploaded template is empty.";

const CONTACT_IMPORT_UPLOAD_DIR = path.join(process.cwd(), "public", "uploads", "contact-imports");
const TEMPLATE_SAMPLE_ROW = {
  name: "Sample1",
  phone: "60123456789",
  displayName: "Sample1",
  tag: "Import Excel Contact"
} as const;

export type ContactImportDuplicateBehavior = "skip" | "update";

export type ParsedContactImportRow = {
  rowNumber: number;
  name: string;
  phone: string;
  displayName: string;
  rawTag: string;
  tags: string[];
};

export type ContactImportPlanRow = ParsedContactImportRow & {
  action: "create" | "update" | "skip";
  reason: string | null;
};

export type ContactImportSummary = {
  totalRows: number;
  readyRows: number;
  importedRows: number;
  skippedRows: number;
  failedRows: number;
  duplicateExistingRows: number;
  duplicateFileRows: number;
  duplicateBehavior: ContactImportDuplicateBehavior;
};

export type ContactImportPreview = {
  rows: ParsedContactImportRow[];
  plan: ContactImportPlanRow[];
  summary: ContactImportSummary;
};

async function loadExcelJs() {
  const excelJsModule = (await import("exceljs")) as {
    Workbook?: new () => any;
    default?: {
      Workbook: new () => any;
    };
  };

  if (excelJsModule.Workbook) {
    return excelJsModule as { Workbook: new () => any };
  }

  if (excelJsModule.default?.Workbook) {
    return excelJsModule.default;
  }

  throw new Error("ExcelJS.Workbook is not available.");
}

export async function createContactImportTemplateBuffer() {
  const ExcelJS = await loadExcelJs();
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Contacts");
  const widths = CONTACT_IMPORT_TEMPLATE_HEADERS.map((header) => header.length + 2);

  worksheet.columns = CONTACT_IMPORT_TEMPLATE_HEADERS.map((header, index) => ({
    header,
    key: `column-${index}`,
    width: widths[index]
  }));

  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.alignment = { vertical: "middle" };

  const sampleRow = [
    TEMPLATE_SAMPLE_ROW.name,
    TEMPLATE_SAMPLE_ROW.phone,
    TEMPLATE_SAMPLE_ROW.displayName,
    TEMPLATE_SAMPLE_ROW.tag
  ];
  worksheet.addRow(sampleRow);

  sampleRow.forEach((value, index) => {
    widths[index] = Math.max(widths[index], value.length + 2);
  });

  worksheet.columns.forEach((column: { width?: number }, index: number) => {
    column.width = Math.max(widths[index], 16);
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export function validateContactImportUpload(file: File) {
  const fileName = file.name?.trim() ?? "";
  const lowerName = fileName.toLowerCase();
  const mimeType = file.type?.trim().toLowerCase() ?? "";
  const allowedMimeTypes = [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/octet-stream"
  ];

  if (!fileName || !lowerName.endsWith(".xlsx") || (mimeType && !allowedMimeTypes.includes(mimeType))) {
    throw new Error(CONTACT_IMPORT_INVALID_TEMPLATE_MESSAGE);
  }

  if (file.size < 1) {
    throw new Error(CONTACT_IMPORT_EMPTY_FILE_MESSAGE);
  }

  if (file.size > CONTACT_IMPORT_MAX_FILE_BYTES) {
    throw new Error(`Import files must be ${Math.floor(CONTACT_IMPORT_MAX_FILE_BYTES / (1024 * 1024))} MB or smaller.`);
  }
}

export async function parseContactImportWorkbook(buffer: Buffer) {
  const ExcelJS = await loadExcelJs();
  const workbook = new ExcelJS.Workbook();
  const workbookBytes = new Uint8Array(buffer);
  const workbookLoadInput = workbookBytes as unknown as Parameters<typeof workbook.xlsx.load>[0];

  try {
    await workbook.xlsx.load(workbookLoadInput);
  } catch {
    throw new Error(CONTACT_IMPORT_INVALID_TEMPLATE_MESSAGE);
  }

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new Error(CONTACT_IMPORT_INVALID_TEMPLATE_MESSAGE);
  }

  const headerRow = worksheet.getRow(1);
  const actualHeaders = CONTACT_IMPORT_TEMPLATE_HEADERS.map((_, index) =>
    normalizeTemplateHeader(readWorksheetCellText(headerRow.getCell(index + 1).value))
  );
  const extraHeaderCount = Math.max(headerRow.cellCount, headerRow.actualCellCount) - CONTACT_IMPORT_TEMPLATE_HEADERS.length;
  const hasExtraHeaders = extraHeaderCount > 0
    ? Array.from({ length: extraHeaderCount }, (_, index) =>
        sanitizeImportedText(
          readWorksheetCellText(headerRow.getCell(CONTACT_IMPORT_TEMPLATE_HEADERS.length + index + 1).value)
        )
      ).some(Boolean)
    : false;
  const expectedHeaders = CONTACT_IMPORT_TEMPLATE_HEADERS.map((header) => normalizeTemplateHeader(header));
  const hasUnexpectedHeaders =
    actualHeaders.length !== expectedHeaders.length ||
    actualHeaders.some((header, index) => header !== expectedHeaders[index]) ||
    hasExtraHeaders;

  if (hasUnexpectedHeaders) {
    throw new Error(CONTACT_IMPORT_INVALID_TEMPLATE_MESSAGE);
  }

  const rows: ParsedContactImportRow[] = [];

  worksheet.eachRow((row: { getCell: (index: number) => { value: unknown } }, rowNumber: number) => {
    if (rowNumber === 1) {
      return;
    }

    const values = CONTACT_IMPORT_TEMPLATE_HEADERS.map((_, index) =>
      sanitizeImportedText(readWorksheetCellText(row.getCell(index + 1).value))
    );

    if (values.every((value) => !value)) {
      return;
    }

    const name = values[0];
    const phone = normalizeImportedPhone(values[1]);
    const displayName = values[2];
    const rawTag = values[3];

    if (!name || !phone) {
      throw new Error(CONTACT_IMPORT_EMPTY_FIELD_MESSAGE);
    }

    rows.push({
      rowNumber,
      name,
      phone,
      displayName,
      rawTag,
      tags: splitContactImportTags(rawTag)
    });
  });

  if (!rows.length) {
    throw new Error(CONTACT_IMPORT_EMPTY_FILE_MESSAGE);
  }

  return rows;
}

export async function previewContactImport(input: {
  buffer: Buffer;
  workspaceId: string;
  duplicateBehavior?: ContactImportDuplicateBehavior;
}) {
  const rows = await parseContactImportWorkbook(input.buffer);
  const existingContacts = await prisma.contact.findMany({
    where: {
      workspaceId: input.workspaceId,
      phone: {
        in: Array.from(new Set(rows.map((row) => row.phone)))
      }
    },
    select: {
      id: true,
      phone: true,
      displayName: true,
      syncedDisplayName: true,
      displayNameManualOverride: true,
      tags: true,
      tagsManualOverride: true
    }
  });

  return buildContactImportPreview({
    rows,
    existingContacts,
    duplicateBehavior: input.duplicateBehavior ?? "skip"
  });
}

export function buildContactImportPreview(input: {
  rows: ParsedContactImportRow[];
  existingContacts: Array<{
    id: string;
    phone: string;
    displayName: string;
    syncedDisplayName: string | null;
    displayNameManualOverride: boolean;
    tags: string;
    tagsManualOverride: boolean;
  }>;
  duplicateBehavior: ContactImportDuplicateBehavior;
}) {
  const seenPhones = new Set<string>();
  const existingPhones = new Set(input.existingContacts.map((contact) => contact.phone));

  const plan = input.rows.map((row) => {
    if (seenPhones.has(row.phone)) {
      return {
        ...row,
        action: "skip" as const,
        reason: "Duplicate phone number appears multiple times in the uploaded file."
      };
    }

    seenPhones.add(row.phone);

    if (existingPhones.has(row.phone)) {
      if (input.duplicateBehavior === "update") {
        return {
          ...row,
          action: "update" as const,
          reason: null
        };
      }

      return {
        ...row,
        action: "skip" as const,
        reason: "Phone number already exists in this workspace."
      };
    }

    return {
      ...row,
      action: "create" as const,
      reason: null
    };
  });

  const readyRows = plan.filter((row) => row.action === "create" || row.action === "update").length;
  const duplicateExistingRows = plan.filter(
    (row) => row.reason === "Phone number already exists in this workspace."
  ).length;
  const duplicateFileRows = plan.filter(
    (row) => row.reason === "Duplicate phone number appears multiple times in the uploaded file."
  ).length;

  return {
    rows: input.rows,
    plan,
    summary: {
      totalRows: input.rows.length,
      readyRows,
      importedRows: 0,
      skippedRows: plan.filter((row) => row.action === "skip").length,
      failedRows: 0,
      duplicateExistingRows,
      duplicateFileRows,
      duplicateBehavior: input.duplicateBehavior
    }
  } satisfies ContactImportPreview;
}

export async function executeContactImport(input: {
  buffer: Buffer;
  workspaceId: string;
  uploadedById: string;
  originalFilename: string;
  duplicateBehavior?: ContactImportDuplicateBehavior;
}) {
  const duplicateBehavior = input.duplicateBehavior ?? "skip";
  const preview = await previewContactImport({
    buffer: input.buffer,
    workspaceId: input.workspaceId,
    duplicateBehavior
  });

  const createRows = preview.plan.filter((row) => row.action === "create");
  await assertWorkspaceHasActiveContactCapacity(input.workspaceId, createRows.length);

  const existingContacts = await prisma.contact.findMany({
    where: {
      workspaceId: input.workspaceId,
      phone: {
        in: Array.from(new Set(preview.rows.map((row) => row.phone)))
      }
    },
    select: {
      id: true,
      phone: true,
      displayName: true,
      syncedDisplayName: true,
      displayNameManualOverride: true,
      tags: true,
      tagsManualOverride: true
    }
  });
  const existingByPhone = new Map(existingContacts.map((contact) => [contact.phone, contact]));

  const storedFile = await saveUploadedContactImportFile({
    workspaceId: input.workspaceId,
    originalFilename: input.originalFilename,
    buffer: input.buffer
  });

  const importRecord = await prisma.contactImport.create({
    data: {
      workspaceId: input.workspaceId,
      uploadedById: input.uploadedById,
      originalFilename: input.originalFilename,
      storedFilename: storedFile.storedFilename,
      storagePath: storedFile.storagePath,
      totalRows: preview.summary.totalRows,
      importedRows: 0,
      skippedRows: 0,
      failedRows: 0,
      status: "PROCESSING",
      duplicateBehavior: duplicateBehavior === "update" ? "UPDATE" : "SKIP"
    }
  });

  const logs: Array<{
    importId: string;
    rowNumber: number;
    name: string;
    phone: string;
    status: "IMPORTED" | "SKIPPED" | "FAILED";
    errorMessage: string | null;
  }> = [];
  let importedRows = 0;
  let skippedRows = 0;
  let failedRows = 0;

  const skippedPlanRows = preview.plan.filter((row) => row.action === "skip");
  const createPlanRows = preview.plan.filter((row) => row.action === "create");
  const updatePlanRows = preview.plan.filter((row) => row.action === "update");

  for (const row of skippedPlanRows) {
    skippedRows += 1;
    logs.push({
      importId: importRecord.id,
      rowNumber: row.rowNumber,
      name: row.name,
      phone: row.phone,
      status: "SKIPPED",
      errorMessage: row.reason
    });
  }

  const createBatchSize = 200;
  for (let index = 0; index < createPlanRows.length; index += createBatchSize) {
    const batch = createPlanRows.slice(index, index + createBatchSize);

    try {
      await prisma.contact.createMany({
        data: batch.map((row) =>
          buildContactCreateData({
            workspaceId: input.workspaceId,
            row
          })
        )
      });

      importedRows += batch.length;
      batch.forEach((row) => {
        logs.push({
          importId: importRecord.id,
          rowNumber: row.rowNumber,
          name: row.name,
          phone: row.phone,
          status: "IMPORTED",
          errorMessage: null
        });
      });
    } catch {
      for (const row of batch) {
        try {
          await prisma.contact.create({
            data: buildContactCreateData({
              workspaceId: input.workspaceId,
              row
            })
          });

          importedRows += 1;
          logs.push({
            importId: importRecord.id,
            rowNumber: row.rowNumber,
            name: row.name,
            phone: row.phone,
            status: "IMPORTED",
            errorMessage: null
          });
        } catch (error) {
          failedRows += 1;
          logs.push({
            importId: importRecord.id,
            rowNumber: row.rowNumber,
            name: row.name,
            phone: row.phone,
            status: "FAILED",
            errorMessage: error instanceof Error ? error.message : "Unable to import contact row."
          });
        }
      }
    }
  }

  for (const row of updatePlanRows) {
    try {
      const existing = existingByPhone.get(row.phone);
      if (!existing) {
        throw new Error("Unable to update duplicate contact because the existing contact could not be found.");
      }

      await prisma.contact.update({
        where: {
          id: existing.id
        },
        data: buildContactUpdateData({
          existing,
          row
        })
      });

      importedRows += 1;
      logs.push({
        importId: importRecord.id,
        rowNumber: row.rowNumber,
        name: row.name,
        phone: row.phone,
        status: "IMPORTED",
        errorMessage: null
      });
    } catch (error) {
      failedRows += 1;
      logs.push({
        importId: importRecord.id,
        rowNumber: row.rowNumber,
        name: row.name,
        phone: row.phone,
        status: "FAILED",
        errorMessage: error instanceof Error ? error.message : "Unable to import contact row."
      });
    }
  }

  await createContactImportLogs(logs);

  const status =
    failedRows > 0 ? (importedRows > 0 ? "PARTIAL" : "FAILED") : "COMPLETED";
  const updatedImport = await prisma.contactImport.update({
    where: {
      id: importRecord.id
    },
    data: {
      importedRows,
      skippedRows,
      failedRows,
      status
    }
  });

  return {
    importRecord: updatedImport,
    summary: {
      totalRows: preview.summary.totalRows,
      readyRows: preview.summary.readyRows,
      importedRows,
      skippedRows,
      failedRows,
      duplicateExistingRows: preview.summary.duplicateExistingRows,
      duplicateFileRows: preview.summary.duplicateFileRows,
      duplicateBehavior
    } satisfies ContactImportSummary
  };
}

export function splitContactImportTags(value: string) {
  return Array.from(
    new Set(
      value
        .split(",")
        .map((tag) => sanitizeImportedText(tag))
        .filter(Boolean)
    )
  );
}

function normalizeImportedPhone(value: string) {
  return normalizeStoredPhone(value);
}

function normalizeTemplateHeader(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function sanitizeImportedText(value: string) {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
}

function readWorksheetCellText(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "object") {
    if ("text" in (value as { text?: unknown }) && typeof (value as { text?: unknown }).text === "string") {
      return (value as { text: string }).text;
    }
    if ("result" in (value as { result?: unknown })) {
      const result = (value as { result?: unknown }).result;
      return result === null || result === undefined ? "" : String(result);
    }
    if ("richText" in (value as { richText?: Array<{ text?: string }> })) {
      const richText = (value as { richText?: Array<{ text?: string }> }).richText ?? [];
      return richText.map((item) => item.text ?? "").join("");
    }
  }

  return String(value);
}

function buildContactCreateData(input: {
  workspaceId: string;
  row: ParsedContactImportRow;
}) {
  const preferredDisplayName = input.row.displayName || input.row.name;
  return {
    workspaceId: input.workspaceId,
    ownerId: null,
    displayName: preferredDisplayName,
    syncedDisplayName: input.row.name,
    displayNameManualOverride: Boolean(input.row.displayName && input.row.displayName !== input.row.name),
    phone: input.row.phone,
    email: null,
    addressLine1: null,
    addressLine2: null,
    city: null,
    state: null,
    postalCode: null,
    country: null,
    tags: input.row.tags.join(", "),
    syncedTags: null,
    tagsManualOverride: false
  };
}

function buildContactUpdateData(input: {
  existing: {
    displayName: string;
    syncedDisplayName: string | null;
    displayNameManualOverride: boolean;
    tags: string;
    tagsManualOverride: boolean;
  };
  row: ParsedContactImportRow;
}) {
  const preferredDisplayName = input.row.displayName || input.row.name || input.existing.displayName;
  const mergedTags = Array.from(
    new Set([...splitContactImportTags(input.existing.tags), ...input.row.tags])
  );

  return {
    displayName: preferredDisplayName,
    syncedDisplayName: input.row.name || input.existing.syncedDisplayName,
    displayNameManualOverride:
      Boolean(input.row.displayName && input.row.displayName !== input.row.name) ||
      input.existing.displayNameManualOverride,
    tags: mergedTags.join(", "),
    tagsManualOverride: input.existing.tagsManualOverride
  };
}

async function saveUploadedContactImportFile(input: {
  workspaceId: string;
  originalFilename: string;
  buffer: Buffer;
}) {
  const extension = path.extname(input.originalFilename).toLowerCase() || ".xlsx";
  const workspaceDir = path.join(CONTACT_IMPORT_UPLOAD_DIR, input.workspaceId);
  const storedFilename = `${Date.now()}-${randomUUID().replace(/-/g, "")}${extension}`;
  const storagePath = path.join(workspaceDir, storedFilename);

  await mkdir(workspaceDir, { recursive: true });
  await writeFile(storagePath, input.buffer);

  return {
    storedFilename,
    storagePath
  };
}

async function createContactImportLogs(
  logs: Array<{
    importId: string;
    rowNumber: number;
    name: string;
    phone: string;
    status: "IMPORTED" | "SKIPPED" | "FAILED";
    errorMessage: string | null;
  }>
) {
  const batchSize = 200;
  for (let index = 0; index < logs.length; index += batchSize) {
    const batch = logs.slice(index, index + batchSize);
    await prisma.contactImportLog.createMany({
      data: batch
    });
  }
}
