import { PassThrough, Readable } from "node:stream";
import { requireCurrentApiAgent } from "@/lib/auth/current-user";
import { findContactsExportBatch } from "@/lib/db-contacts";
import { formatPhoneForDisplay } from "@/lib/phone";

export const runtime = "nodejs";

const EXPORT_BATCH_SIZE = 1000;
const DATE_COLUMN_WIDTH = 22;

type ExportColumnKey =
  | "name"
  | "phone"
  | "displayName"
  | "tag"
  | "assignee"
  | "collaborators"
  | "remarks"
  | "totalReceived"
  | "totalSent"
  | "createdAt"
  | "businessType"
  | "customerNumber";

const EXPORT_COLUMNS: Array<{ header: string; key: ExportColumnKey }> = [
  { header: "Name", key: "name" },
  { header: "Phone", key: "phone" },
  { header: "Display Name", key: "displayName" },
  { header: "Tag", key: "tag" },
  { header: "Assignee", key: "assignee" },
  { header: "Collaborators", key: "collaborators" },
  { header: "Remarks", key: "remarks" },
  { header: "Total Received", key: "totalReceived" },
  { header: "Total Sent", key: "totalSent" },
  { header: "Created At", key: "createdAt" },
  { header: "BusinessType", key: "businessType" },
  { header: "CustomerNumber", key: "customerNumber" }
];

export async function GET(request: Request) {
  try {
    const agent = await requireCurrentApiAgent();
    const url = new URL(request.url);
    const search = url.searchParams.get("q")?.trim() ?? "";
    const tags = normalizeQueryList(url.searchParams, ["tags", "tag"]);
    const ownerIds = normalizeQueryList(url.searchParams, ["ownerIds", "ownerId", "assigneeIds", "assignee"]);
    const filename = `contacts_${formatTimestampForFilename(new Date())}.xlsx`;

    const stream = new PassThrough();
    const workbookPromise = streamContactsWorkbook({
      stream,
      workspaceId: agent.workspaceId,
      search,
      tags,
      ownerIds
    });

    workbookPromise.catch((error) => {
      stream.destroy(error instanceof Error ? error : new Error("Export failed."));
    });

    return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return Response.json({ error: "Unauthorized." }, { status: 401 });
    }

    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to export contacts." },
      { status: 400 }
    );
  }
}

async function streamContactsWorkbook(input: {
  stream: PassThrough;
  workspaceId: string;
  search: string;
  tags: string[];
  ownerIds: string[];
}) {
  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    stream: input.stream,
    useSharedStrings: true,
    useStyles: true
  });
  const worksheet = workbook.addWorksheet("Contacts");
  const widths = EXPORT_COLUMNS.map((column) => column.header.length + 2);

  worksheet.columns = EXPORT_COLUMNS.map((column, index) => ({
    header: column.header,
    key: column.key,
    width: widths[index]
  }));

  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.alignment = { vertical: "middle" };
  headerRow.commit();

  let offset = 0;

  while (true) {
    const batch = await findContactsExportBatch({
      workspaceId: input.workspaceId,
      search: input.search,
      tags: input.tags,
      ownerIds: input.ownerIds,
      limit: EXPORT_BATCH_SIZE,
      offset
    });

    if (!batch.length) {
      break;
    }

    for (const contact of batch) {
      const values = {
        name: contact.syncedDisplayName?.trim() || contact.displayName,
        phone: formatPhoneForDisplay(contact.phone),
        displayName: contact.displayName,
        tag: formatCsvValue(contact.tags),
        assignee: contact.ownerName ?? "",
        collaborators: contact.collaborators ?? "",
        remarks: contact.remarks ?? "",
        totalReceived: Number(contact.totalReceived ?? 0),
        totalSent: Number(contact.totalSent ?? 0),
        createdAt: contact.createdAt,
        businessType: contact.businessType ?? "",
        customerNumber: contact.phone
      } satisfies Record<ExportColumnKey, string | number | Date>;

      const row = worksheet.addRow(values);
      row.getCell("createdAt").numFmt = "yyyy-mm-dd hh:mm:ss";
      row.commit();

      updateColumnWidths(widths, values);
    }

    offset += batch.length;
    if (batch.length < EXPORT_BATCH_SIZE) {
      break;
    }
  }

  worksheet.columns.forEach((column, index) => {
    column.width = Math.min(Math.max(widths[index], column.key === "createdAt" ? DATE_COLUMN_WIDTH : 10), 60);
  });

  await worksheet.commit();
  await workbook.commit();
}

function updateColumnWidths(widths: number[], values: Record<ExportColumnKey, string | number | Date>) {
  EXPORT_COLUMNS.forEach((column, index) => {
    const value = values[column.key];
    const rendered =
      value instanceof Date
        ? formatDateCell(value)
        : typeof value === "number"
          ? String(value)
          : value;
    widths[index] = Math.max(widths[index], rendered.length + 2);
  });
}

function formatDateCell(value: Date) {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, "0");
  const day = `${value.getDate()}`.padStart(2, "0");
  const hours = `${value.getHours()}`.padStart(2, "0");
  const minutes = `${value.getMinutes()}`.padStart(2, "0");
  const seconds = `${value.getSeconds()}`.padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function formatCsvValue(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .join(", ");
}

function normalizeQueryList(searchParams: URLSearchParams, keys: string[]) {
  return Array.from(
    new Set(
      keys
        .flatMap((key) => searchParams.getAll(key))
        .flatMap((value) => value.split(","))
        .map((value) => value.trim())
        .filter(Boolean)
    )
  );
}

function formatTimestampForFilename(value: Date) {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, "0");
  const day = `${value.getDate()}`.padStart(2, "0");
  const hours = `${value.getHours()}`.padStart(2, "0");
  const minutes = `${value.getMinutes()}`.padStart(2, "0");
  const seconds = `${value.getSeconds()}`.padStart(2, "0");
  return `${year}${month}${day}_${hours}${minutes}${seconds}`;
}
