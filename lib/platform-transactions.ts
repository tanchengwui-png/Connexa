import { getBillingDocumentPdf } from "@/lib/billing-management";
import { queryMany, queryOne } from "@/lib/db";

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 20;
const TRANSACTION_STATUSES = new Set([
  "PENDING",
  "PAID",
  "FAILED",
  "CANCELLED",
  "EXPIRED",
  "REFUNDED",
  "PARTIALLY_REFUNDED"
]);

export type PlatformTransactionQuery = {
  search?: string | null;
  status?: string | null;
  currency?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  sort?: string | null;
  page?: string | number | null;
  pageSize?: string | number | null;
};

export type PlatformTransactionRow = {
  source: "invoice" | "upgrade";
  id: string;
  documentId: string;
  workspaceId: string;
  status: string;
  receiptNumber: string | null;
  invoiceNumber: string;
  transactionId: string;
  gatewayTransactionId: string | null;
  customerName: string;
  customerEmail: string;
  packageName: string;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  amount: number;
  currency: string;
  paymentMethod: string | null;
  createdAt: string;
  paidAt: string | null;
  receiptIssuedAt: string | null;
  failureReason: string | null;
  gatewayResponse: string | null;
  invoiceAvailable: boolean;
  receiptAvailable: boolean;
};

type PlatformTransactionDbRow = Omit<
  PlatformTransactionRow,
  "createdAt" | "paidAt" | "receiptIssuedAt" | "subtotal" | "discount" | "tax" | "total" | "amount" | "invoiceAvailable" | "receiptAvailable"
> & {
  subtotal: string | number | null;
  discount: string | number | null;
  tax: string | number | null;
  total: string | number | null;
  amount: string | number | null;
  createdAt: Date;
  paidAt: Date | null;
  receiptIssuedAt: Date | null;
  invoicePath: string | null;
  receiptPath: string | null;
};

export function normalizePlatformTransactionQuery(input: PlatformTransactionQuery = {}) {
  const page = Math.max(1, toInteger(input.page, 1));
  const pageSize = DEFAULT_PAGE_SIZE;
  const status = normalizeStatus(input.status);
  const currency = normalizeCurrency(input.currency);

  return {
    search: typeof input.search === "string" ? input.search.trim().slice(0, 120) : "",
    status,
    currency,
    dateFrom: parseDate(input.dateFrom, "from"),
    dateTo: parseDate(input.dateTo, "to"),
    sort: input.sort === "oldest" ? "oldest" as const : "newest" as const,
    page,
    pageSize
  };
}

export async function listPlatformTransactions(input: PlatformTransactionQuery = {}) {
  const query = normalizePlatformTransactionQuery(input);
  const values: unknown[] = [];
  const filters: string[] = [];

  if (query.search) {
    values.push(`%${query.search.toLowerCase()}%`);
    filters.push(`(
      LOWER("receiptNumber") LIKE $${values.length}
      OR LOWER("invoiceNumber") LIKE $${values.length}
      OR LOWER("transactionId") LIKE $${values.length}
      OR LOWER(COALESCE("gatewayTransactionId", '')) LIKE $${values.length}
      OR LOWER("customerName") LIKE $${values.length}
      OR LOWER("customerEmail") LIKE $${values.length}
    )`);
  }

  if (query.status) {
    values.push(query.status);
    filters.push(`status = $${values.length}`);
  }

  if (query.currency) {
    values.push(query.currency);
    filters.push(`currency = $${values.length}`);
  }

  if (query.dateFrom) {
    values.push(query.dateFrom);
    filters.push(`"createdAt" >= $${values.length}`);
  }

  if (query.dateTo) {
    values.push(query.dateTo);
    filters.push(`"createdAt" <= $${values.length}`);
  }

  const whereClause = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const orderDirection = query.sort === "oldest" ? "ASC" : "DESC";
  const countValues = [...values];
  values.push(query.pageSize, (query.page - 1) * query.pageSize);

  const [rows, totalRow, currencyRows] = await Promise.all([
    queryMany<PlatformTransactionDbRow>(
      `${platformTransactionCte()}
       SELECT *
       FROM all_transactions
       ${whereClause}
       ORDER BY "createdAt" ${orderDirection}, id ${orderDirection}
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    ),
    queryOne<{ total: string }>(
      `${platformTransactionCte()}
       SELECT COUNT(*)::text AS total
       FROM all_transactions
       ${whereClause}`,
      countValues
    ),
    queryMany<{ currency: string }>(
      `${platformTransactionCte()}
       SELECT DISTINCT currency
       FROM all_transactions
       ORDER BY currency ASC`
    )
  ]);

  const total = Number(totalRow?.total ?? 0);
  return {
    rows: rows.map(mapTransactionRow),
    filters: query,
    currencies: currencyRows.map((row) => row.currency),
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      pageCount: Math.max(1, Math.ceil(total / query.pageSize))
    }
  };
}

export async function getPlatformTransaction(id: string) {
  const row = await queryOne<PlatformTransactionDbRow>(
    `${platformTransactionCte()}
     SELECT *
     FROM all_transactions
     WHERE id = $1
     LIMIT 1`,
    [id]
  );

  return row ? mapTransactionRow(row) : null;
}

export async function getPlatformTransactionDocumentPdf(
  id: string,
  type: "invoice" | "receipt"
) {
  const transaction = await getPlatformTransaction(id);
  if (!transaction) {
    throw new Error("Transaction not found.");
  }

  if (type === "invoice" && !transaction.invoiceAvailable) {
    throw new Error("Invoice PDF is unavailable.");
  }

  if (type === "receipt" && !transaction.receiptAvailable) {
    throw new Error("Receipt PDF is unavailable.");
  }

  return getBillingDocumentPdf(transaction.workspaceId, transaction.documentId, type);
}

function platformTransactionCte() {
  return `
    WITH invoice_transactions AS (
      SELECT
        'invoice'::text AS source,
        i.id,
        ('invoice:' || i.id) AS "documentId",
        i."workspaceId",
        CASE
          WHEN i.status = 'PAID' THEN 'PAID'
          WHEN i.status IN ('CANCELLED', 'VOID') THEN 'CANCELLED'
          WHEN i.status = 'REFUNDED' THEN 'REFUNDED'
          WHEN i.status = 'FAILED' THEN 'FAILED'
          ELSE 'PENDING'
        END AS status,
        i."receiptNumber",
        i."invoiceNo" AS "invoiceNumber",
        COALESCE(pt."transactionId", i."providerReference", i."orderNo") AS "transactionId",
        i."providerReference" AS "gatewayTransactionId",
        i."customerName",
        i."customerEmail",
        i."packageName",
        COALESCE(i."totalAmount", i.amount, 0)::text AS subtotal,
        0::text AS discount,
        0::text AS tax,
        COALESCE(i."totalAmount", i.amount, 0)::text AS total,
        COALESCE(i."paidAmount", i."totalAmount", i.amount, 0)::text AS amount,
        i.currency,
        COALESCE(pt."paymentMethod", i.provider) AS "paymentMethod",
        i."createdAt",
        COALESCE(i."paidAt", i."paymentDate", pt."paidAt") AS "paidAt",
        i."receiptIssuedAt",
        pt."failureReason",
        pt."gatewayResponseJson" AS "gatewayResponse",
        COALESCE(i."invoicePdfPath", i."pdfPath") AS "invoicePath",
        i."receiptPdfPath" AS "receiptPath"
      FROM "Invoice" i
      LEFT JOIN LATERAL (
        SELECT *
        FROM "PaymentTransaction" pt
        WHERE pt."invoiceId" = i.id
           OR (i."providerReference" IS NOT NULL AND pt."providerReference" = i."providerReference")
           OR (pt."providerReference" = i."orderNo")
        ORDER BY COALESCE(pt."paidAt", pt."createdAt") DESC
        LIMIT 1
      ) pt ON TRUE
    ),
    upgrade_transactions AS (
      SELECT
        'upgrade'::text AS source,
        u.id,
        ('upgrade:' || u.id) AS "documentId",
        u."workspaceId",
        CASE
          WHEN u.status = 'PAID' THEN 'PAID'
          WHEN u.status IN ('PAYMENT_FAILED') THEN 'FAILED'
          WHEN u.status IN ('CANCELLED', 'SUPERSEDED') THEN 'CANCELLED'
          WHEN u.status = 'EXPIRED' THEN 'EXPIRED'
          ELSE 'PENDING'
        END AS status,
        u."receiptNumber",
        u."invoiceNumber" AS "invoiceNumber",
        COALESCE(u."providerReference", u."invoiceNumber") AS "transactionId",
        u."providerReference" AS "gatewayTransactionId",
        COALESCE(a.name, w.name) AS "customerName",
        COALESCE(a.email, '') AS "customerEmail",
        u."targetPlan" AS "packageName",
        COALESCE(u.amount, 0)::text AS subtotal,
        0::text AS discount,
        0::text AS tax,
        COALESCE(u.amount, 0)::text AS total,
        COALESCE(u.amount, 0)::text AS amount,
        COALESCE(u.currency, 'MYR') AS currency,
        u.provider AS "paymentMethod",
        u."createdAt",
        u."paidAt",
        u."receiptIssuedAt",
        CASE WHEN u.status = 'PAYMENT_FAILED' THEN u."replacementReason" ELSE NULL END AS "failureReason",
        NULL::text AS "gatewayResponse",
        u."invoiceNumber" AS "invoicePath",
        NULL::text AS "receiptPath"
      FROM "PendingWorkspacePackageUpgrade" u
      LEFT JOIN "Agent" a ON a.id = u."requestedByAgentId"
      LEFT JOIN "Workspace" w ON w.id = u."workspaceId"
      WHERE NOT EXISTS (
        SELECT 1
        FROM "Invoice" i
        WHERE i."orderNo" = u."providerReference"
           OR i."providerReference" = u."providerReference"
      )
    ),
    all_transactions AS (
      SELECT * FROM invoice_transactions
      UNION ALL
      SELECT * FROM upgrade_transactions
    )
  `;
}

function mapTransactionRow(row: PlatformTransactionDbRow): PlatformTransactionRow {
  const receiptAvailable = row.status === "PAID" && Boolean(row.receiptNumber);
  return {
    ...row,
    source: row.source,
    subtotal: toNumber(row.subtotal),
    discount: toNumber(row.discount),
    tax: toNumber(row.tax),
    total: toNumber(row.total),
    amount: toNumber(row.amount),
    paymentMethod: normalizePaymentMethod(row.paymentMethod),
    createdAt: row.createdAt.toISOString(),
    paidAt: row.paidAt?.toISOString() ?? null,
    receiptIssuedAt: row.receiptIssuedAt?.toISOString() ?? null,
    invoiceAvailable: Boolean(row.invoicePath),
    receiptAvailable
  };
}

function toInteger(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function toNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeStatus(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }
  const normalized = value.trim().toUpperCase().replace(/[\s-]+/g, "_");
  return TRANSACTION_STATUSES.has(normalized) ? normalized : "";
}

function normalizeCurrency(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }
  const normalized = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(normalized) ? normalized : "";
}

function parseDate(value: unknown, mode: "from" | "to") {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const date = new Date(`${value.trim()}T${mode === "from" ? "00:00:00.000" : "23:59:59.999"}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizePaymentMethod(value: string | null) {
  if (!value) {
    return null;
  }

  return value.toLowerCase() === "billplz" ? "Billplz" : value;
}
