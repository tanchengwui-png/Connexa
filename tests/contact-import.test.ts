import assert from "node:assert/strict";
import test from "node:test";
import {
  buildContactImportPreview,
  CONTACT_IMPORT_EMPTY_FIELD_MESSAGE,
  CONTACT_IMPORT_EMPTY_FILE_MESSAGE,
  CONTACT_IMPORT_INVALID_TEMPLATE_MESSAGE,
  createContactImportTemplateBuffer,
  parseContactImportWorkbook,
  splitContactImportTags
} from "../lib/contact-import";

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

test("template download contains the required headers and sample row", async () => {
  const ExcelJS = await loadExcelJs();
  const buffer = await createContactImportTemplateBuffer();
  const workbook = new ExcelJS.Workbook();
  const workbookBuffer = buffer as unknown as Parameters<typeof workbook.xlsx.load>[0];

  await workbook.xlsx.load(workbookBuffer);
  const worksheet = workbook.worksheets[0];

  assert.ok(worksheet);
  assert.equal(worksheet.getCell("A1").text, "Name");
  assert.equal(worksheet.getCell("B1").text, "Phone");
  assert.equal(worksheet.getCell("C1").text, "Display Name");
  assert.equal(worksheet.getCell("D1").text, "Tag");
  assert.equal(worksheet.getCell("A2").text, "Sample1");
  assert.equal(worksheet.getCell("B2").text, "60123456789");
});

test("valid import workbook parses successfully", async () => {
  const buffer = await createWorkbookBuffer([
    ["Alice", "60111111111", "Alice Tan", "VIP, Customer"]
  ]);
  const rows = await parseContactImportWorkbook(buffer);

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.name, "Alice");
  assert.equal(rows[0]?.phone, "60111111111");
  assert.deepEqual(rows[0]?.tags, ["VIP", "Customer"]);
});

test("empty Name rejects the workbook", async () => {
  const buffer = await createWorkbookBuffer([["", "60111111111", "Alice Tan", "VIP"]]);

  await assert.rejects(() => parseContactImportWorkbook(buffer), new RegExp(escapeRegExp(CONTACT_IMPORT_EMPTY_FIELD_MESSAGE)));
});

test("empty Phone rejects the workbook", async () => {
  const buffer = await createWorkbookBuffer([["Alice", "", "Alice Tan", "VIP"]]);

  await assert.rejects(() => parseContactImportWorkbook(buffer), new RegExp(escapeRegExp(CONTACT_IMPORT_EMPTY_FIELD_MESSAGE)));
});

test("empty workbook is rejected", async () => {
  const buffer = await createWorkbookBuffer([]);

  await assert.rejects(() => parseContactImportWorkbook(buffer), new RegExp(escapeRegExp(CONTACT_IMPORT_EMPTY_FILE_MESSAGE)));
});

test("malformed template headers are rejected", async () => {
  const ExcelJS = await loadExcelJs();
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Contacts");

  worksheet.addRow(["Wrong", "Phone", "Display Name", "Tag"]);
  worksheet.addRow(["Alice", "60111111111", "Alice Tan", "VIP"]);

  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  await assert.rejects(() => parseContactImportWorkbook(buffer), new RegExp(escapeRegExp(CONTACT_IMPORT_INVALID_TEMPLATE_MESSAGE)));
});

test("multiple tags are split and trimmed", () => {
  assert.deepEqual(splitContactImportTags(" VIP, Customer, Imported ,VIP "), ["VIP", "Customer", "Imported"]);
});

test("duplicate contacts are skipped by default", () => {
  const preview = buildContactImportPreview({
    rows: [
      { rowNumber: 2, name: "Alice", phone: "60111111111", displayName: "Alice", rawTag: "VIP", tags: ["VIP"] },
      { rowNumber: 3, name: "Bob", phone: "60111111111", displayName: "Bob", rawTag: "Buyer", tags: ["Buyer"] },
      { rowNumber: 4, name: "Cara", phone: "60122222222", displayName: "Cara", rawTag: "Lead", tags: ["Lead"] }
    ],
    existingContacts: [
      {
        id: "contact-1",
        phone: "60122222222",
        displayName: "Existing",
        syncedDisplayName: "Existing",
        displayNameManualOverride: false,
        tags: "legacy",
        tagsManualOverride: false
      }
    ],
    duplicateBehavior: "skip"
  });

  assert.equal(preview.summary.readyRows, 1);
  assert.equal(preview.summary.skippedRows, 2);
  assert.equal(preview.summary.duplicateExistingRows, 1);
  assert.equal(preview.summary.duplicateFileRows, 1);
});

test("duplicate contacts can be updated when configured", () => {
  const preview = buildContactImportPreview({
    rows: [
      { rowNumber: 2, name: "Alice", phone: "60111111111", displayName: "Alice", rawTag: "VIP", tags: ["VIP"] }
    ],
    existingContacts: [
      {
        id: "contact-1",
        phone: "60111111111",
        displayName: "Existing",
        syncedDisplayName: "Existing",
        displayNameManualOverride: false,
        tags: "legacy",
        tagsManualOverride: false
      }
    ],
    duplicateBehavior: "update"
  });

  assert.equal(preview.summary.readyRows, 1);
  assert.equal(preview.summary.skippedRows, 0);
  assert.equal(preview.plan[0]?.action, "update");
});

test("workspace isolation depends on the existing contacts passed to the planner", () => {
  const rows = [
    { rowNumber: 2, name: "Alice", phone: "60111111111", displayName: "Alice", rawTag: "", tags: [] }
  ];
  const isolatedPreview = buildContactImportPreview({
    rows,
    existingContacts: [],
    duplicateBehavior: "skip"
  });
  const sameWorkspacePreview = buildContactImportPreview({
    rows,
    existingContacts: [
      {
        id: "contact-1",
        phone: "60111111111",
        displayName: "Existing",
        syncedDisplayName: "Existing",
        displayNameManualOverride: false,
        tags: "",
        tagsManualOverride: false
      }
    ],
    duplicateBehavior: "skip"
  });

  assert.equal(isolatedPreview.plan[0]?.action, "create");
  assert.equal(sameWorkspacePreview.plan[0]?.action, "skip");
});

async function createWorkbookBuffer(rows: string[][]) {
  const ExcelJS = await loadExcelJs();
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Contacts");

  worksheet.addRow(["Name", "Phone", "Display Name", "Tag"]);
  rows.forEach((row) => worksheet.addRow(row));

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
