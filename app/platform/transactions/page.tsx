import Link from "next/link";
import { PlatformAdminShell } from "@/components/platform-admin-shell";
import { getPlatformAdminNavItems } from "@/lib/platform-admin-nav";
import { requireCurrentPlatformAdmin } from "@/lib/platform-auth/current-user";
import {
  getPlatformTransaction,
  listPlatformTransactions,
  type PlatformTransactionRow
} from "@/lib/platform-transactions";

type PlatformTransactionsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const STATUS_OPTIONS = [
  "PENDING",
  "PAID",
  "FAILED",
  "CANCELLED",
  "EXPIRED",
  "REFUNDED",
  "PARTIALLY_REFUNDED"
];

export default async function PlatformTransactionsPage({ searchParams }: PlatformTransactionsPageProps) {
  const params = (await searchParams) ?? {};
  const [admin, transactions] = await Promise.all([
    requireCurrentPlatformAdmin(),
    listPlatformTransactions({
      search: getParam(params, "search"),
      status: getParam(params, "status"),
      currency: getParam(params, "currency"),
      dateFrom: getParam(params, "date_from"),
      dateTo: getParam(params, "date_to"),
      sort: getParam(params, "sort"),
      page: getParam(params, "page")
    })
  ]);
  const selectedTransactionId = getParam(params, "transaction");
  const selectedTransaction = selectedTransactionId ? await getPlatformTransaction(selectedTransactionId) : null;
  const hasFilters = Boolean(
    transactions.filters.search ||
    transactions.filters.status ||
    transactions.filters.currency ||
    transactions.filters.dateFrom ||
    transactions.filters.dateTo
  );

  return (
    <main className="connexa-dark-shell connexa-public-shell">
      <PlatformAdminShell
        adminEmail={admin.email}
        currentKey="transactions"
        description="Review gateway payments, invoice documents, receipt issuance, and transaction status from one platform owner screen."
        items={getPlatformAdminNavItems()}
        title="Transaction history should be searchable, auditable, and tied to the documents customers receive."
      >
        <div className="platform-page-stack platform-transactions-page">
          <div className="platform-admin-toolbar platform-ops-summary">
            <SummaryCard label="Total records" value={transactions.pagination.total.toLocaleString()} />
          </div>

          <section className="content-card settings-dark-panel platform-packages-form-panel platform-transactions-panel">
            <div className="settings-dark-panel-head">
              <div>
                <span>Transaction history</span>
                <h2>Payments, invoices, receipts, and gateway references</h2>
                <p>Completed payments and generated receipts appear here. Old paid records without issued receipt numbers remain visible without receipt actions.</p>
              </div>
            </div>

            <form action="/platform/transactions" className="platform-transactions-filters">
              <label>
                <span>Search</span>
                <input
                  defaultValue={transactions.filters.search}
                  name="search"
                  placeholder="Receipt, invoice, transaction, customer"
                />
              </label>
              <label>
                <span>Status</span>
                <select defaultValue={transactions.filters.status} name="status">
                  <option value="">All statuses</option>
                  {STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>{formatStatus(status)}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Currency</span>
                <select defaultValue={transactions.filters.currency} name="currency">
                  <option value="">All currencies</option>
                  {transactions.currencies.map((currency) => (
                    <option key={currency} value={currency}>{currency}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Date from</span>
                <input defaultValue={formatDateInput(transactions.filters.dateFrom)} name="date_from" type="date" />
              </label>
              <label>
                <span>Date to</span>
                <input defaultValue={formatDateInput(transactions.filters.dateTo)} name="date_to" type="date" />
              </label>
              <label>
                <span>Sort</span>
                <select defaultValue={transactions.filters.sort} name="sort">
                  <option value="newest">Newest</option>
                  <option value="oldest">Oldest</option>
                </select>
              </label>
              <div className="platform-transactions-filter-actions">
                <button className="button button-primary" type="submit">Apply</button>
                <Link className="button button-secondary" href="/platform/transactions">Reset</Link>
              </div>
            </form>

            <div aria-label="Transaction table" className="platform-transactions-table-shell" tabIndex={0}>
              <table className="platform-transactions-table">
                <thead>
                  <tr>
                    <th>Status</th>
                    <th>Receipt Number</th>
                    <th>Invoice Number</th>
                    <th>Transaction ID</th>
                    <th>Customer</th>
                    <th>Amount</th>
                    <th>Currency</th>
                    <th>Payment Method</th>
                    <th>Created At</th>
                    <th>Paid At</th>
                    <th>Documents</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.rows.map((transaction) => (
                    <tr key={transaction.id}>
                      <td>
                        <Link className="platform-transactions-row-link" href={withQuery(params, { transaction: transaction.id })}>
                          <span className={`platform-transaction-status ${transaction.status.toLowerCase().replace(/_/g, "-")}`}>
                            {formatStatus(transaction.status)}
                          </span>
                        </Link>
                      </td>
                      <td>{transaction.receiptNumber ?? <span className="table-subtle">Not issued</span>}</td>
                      <td>{transaction.invoiceNumber}</td>
                      <td><span className="platform-transaction-mono">{transaction.transactionId}</span></td>
                      <td>
                        <strong>{transaction.customerName || "Unknown customer"}</strong>
                        {transaction.customerEmail ? <span className="table-subtle">{transaction.customerEmail}</span> : null}
                      </td>
                      <td>{formatMoney(transaction.amount, transaction.currency)}</td>
                      <td>{transaction.currency}</td>
                      <td>{transaction.paymentMethod ?? <span className="table-subtle">Not recorded</span>}</td>
                      <td>{formatDateTime(transaction.createdAt)}</td>
                      <td>{transaction.paidAt ? formatDateTime(transaction.paidAt) : <span className="table-subtle">Not paid</span>}</td>
                      <td>
                        <DocumentActions transaction={transaction} />
                      </td>
                    </tr>
                  ))}
                  {!transactions.rows.length ? (
                    <tr>
                      <td className="table-subtle platform-transactions-empty" colSpan={11}>
                        {hasFilters
                          ? "No transactions match the current search and filters."
                          : "No transaction history yet. Completed payments and generated receipts will appear here."}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            <div className="platform-transactions-pagination">
              <Link
                aria-disabled={transactions.pagination.page <= 1}
                className="button button-secondary"
                href={withQuery(params, { page: String(Math.max(1, transactions.pagination.page - 1)) })}
              >
                Previous
              </Link>
              <span className="table-subtle">
                Page {transactions.pagination.page} of {transactions.pagination.pageCount}
              </span>
              <Link
                aria-disabled={transactions.pagination.page >= transactions.pagination.pageCount}
                className="button button-secondary"
                href={withQuery(params, { page: String(Math.min(transactions.pagination.pageCount, transactions.pagination.page + 1)) })}
              >
                Next
              </Link>
            </div>
          </section>

          {selectedTransaction ? (
            <TransactionDetailPanel transaction={selectedTransaction} closeHref={withQuery(params, { transaction: "" })} />
          ) : selectedTransactionId ? (
            <section className="content-card settings-dark-panel platform-transactions-detail-panel">
              <p className="table-subtle">Transaction not found or no longer available.</p>
              <Link className="button button-secondary" href={withQuery(params, { transaction: "" })}>Close</Link>
            </section>
          ) : null}
        </div>
      </PlatformAdminShell>
    </main>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="settings-dark-status-card platform-ops-kpi-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function DocumentActions({ transaction }: { transaction: PlatformTransactionRow }) {
  const invoiceHref = `/api/platform/transactions/${encodeURIComponent(transaction.id)}/documents?type=invoice`;
  const receiptHref = `/api/platform/transactions/${encodeURIComponent(transaction.id)}/documents?type=receipt`;
  return (
    <div className="platform-transaction-documents">
      {transaction.invoiceAvailable ? (
        <>
          <a href={`${invoiceHref}&disposition=inline`} target="_blank" rel="noreferrer">View invoice</a>
          <a href={invoiceHref}>Download invoice</a>
        </>
      ) : (
        <span className="table-subtle">Invoice unavailable</span>
      )}
      {transaction.receiptAvailable ? (
        <>
          <a href={`${receiptHref}&disposition=inline`} target="_blank" rel="noreferrer">View receipt</a>
          <a href={receiptHref}>Download receipt</a>
        </>
      ) : (
        <span className="table-subtle">Receipt unavailable</span>
      )}
    </div>
  );
}

function TransactionDetailPanel({ transaction, closeHref }: { transaction: PlatformTransactionRow; closeHref: string }) {
  const rows = [
    ["Transaction ID", transaction.transactionId],
    ["Gateway transaction ID", transaction.gatewayTransactionId ?? "Not recorded"],
    ["Receipt number", transaction.receiptNumber ?? "Not issued"],
    ["Invoice number", transaction.invoiceNumber],
    ["Customer", `${transaction.customerName || "Unknown"}${transaction.customerEmail ? ` (${transaction.customerEmail})` : ""}`],
    ["Package or product", transaction.packageName],
    ["Subtotal", formatMoney(transaction.subtotal, transaction.currency)],
    ["Discount", formatMoney(transaction.discount, transaction.currency)],
    ["Tax", formatMoney(transaction.tax, transaction.currency)],
    ["Total", formatMoney(transaction.total, transaction.currency)],
    ["Currency", transaction.currency],
    ["Payment method", transaction.paymentMethod ?? "Not recorded"],
    ["Payment status", formatStatus(transaction.status)],
    ["Created timestamp", formatDateTime(transaction.createdAt)],
    ["Paid timestamp", transaction.paidAt ? formatDateTime(transaction.paidAt) : "Not paid"],
    ["Receipt-issued timestamp", transaction.receiptIssuedAt ? formatDateTime(transaction.receiptIssuedAt) : "Not issued"],
    ["Failure or cancellation reason", transaction.failureReason ?? "None recorded"],
    ["Gateway response/reference", transaction.gatewayResponse ?? transaction.gatewayTransactionId ?? "Not recorded"]
  ];

  return (
    <section className="content-card settings-dark-panel platform-transactions-detail-panel">
      <div className="settings-dark-panel-head">
        <div>
          <span>Transaction detail</span>
          <h2>{transaction.invoiceNumber}</h2>
          <p>Gateway references and document availability for this transaction.</p>
        </div>
        <Link className="button button-secondary" href={closeHref}>Close</Link>
      </div>
      <div className="platform-transactions-detail-grid">
        {rows.map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

function getParam(params: Record<string, string | string[] | undefined>, key: string) {
  const value = params[key];
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function withQuery(params: Record<string, string | string[] | undefined>, updates: Record<string, string>) {
  const next = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (key === "page_size") {
      return;
    }
    const normalized = Array.isArray(value) ? value[0] : value;
    if (normalized) {
      next.set(key, normalized);
    }
  });
  Object.entries(updates).forEach(([key, value]) => {
    if (value) {
      next.set(key, value);
    } else {
      next.delete(key);
    }
  });
  return `/platform/transactions${next.toString() ? `?${next.toString()}` : ""}`;
}

function formatDateInput(value: Date | null) {
  return value ? value.toISOString().slice(0, 10) : "";
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-MY", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kuala_Lumpur"
  }).format(new Date(value));
}

function formatMoney(value: number, currency: string) {
  return new Intl.NumberFormat("en-MY", {
    style: "currency",
    currency
  }).format(value);
}

function formatStatus(status: string) {
  return status
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
