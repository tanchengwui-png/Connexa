"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type BillingDocument = {
  id: string;
  source: "invoice" | "upgrade";
  invoiceNo: string;
  packageName: string;
  status: "open" | "paid" | "overdue" | "void" | "cancelled" | "expired";
  issueDateIso: string;
  dueDateIso: string | null;
  total: number;
  balance: number;
  currency: string;
  invoiceAvailable: boolean;
  receiptAvailable: boolean;
  paymentPending: boolean;
  payable: boolean;
};

type BillingOverview = {
  currentPackage: {
    id: string;
    name: string;
    price: number;
    currency: string;
    billingCycle: string;
    status: string;
    subscriptionStartDate: string;
    subscriptionEndDate: string | null;
    gracePeriodEndDate: string | null;
  } | null;
  summary: {
    openInvoices: number;
    outstandingAmount: number;
    receiptsReady: number;
  };
  documents: BillingDocument[];
  pagination: {
    page: number;
    perPage: number;
    total: number;
  };
};

type AccountBillingManagerProps = {
  canManage: boolean;
  initialOverview: BillingOverview;
  subscription: {
    id: string;
    packageName: string;
    status: string;
    startedAtIso: string;
    endsAtIso: string | null;
    nextBillingAtIso: string | null;
    autoRenew: boolean;
  } | null;
  limits: Array<{ label: string; value: string }>;
  cleanupWarning: string | null;
  isSubscriptionExpired: boolean;
  initialMessage?: string | null;
};

export function AccountBillingManager({
  canManage,
  initialOverview,
  subscription,
  limits,
  cleanupWarning,
  isSubscriptionExpired,
  initialMessage = null
}: AccountBillingManagerProps) {
  const [overview, setOverview] = useState(initialOverview);
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(initialMessage);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setOverview(initialOverview);
  }, [initialOverview]);

  useEffect(() => {
    setMessage(initialMessage);
  }, [initialMessage]);

  async function loadOverview(page = overview.pagination.page, perPage = overview.pagination.perPage) {
    setPending("documents");
    setError(null);
    const response = await fetch(`/api/account/billing/overview?page=${page}&perPage=${perPage}`, {
      cache: "no-store"
    });
    const data = (await response.json()) as BillingOverview & { error?: string };
    setPending(null);
    if (!response.ok) {
      setError(data.error ?? "Unable to refresh billing documents.");
      return;
    }
    setOverview(data);
  }

  async function payNow(document: BillingDocument) {
    setPending(`pay:${document.id}`);
    setError(null);
    const response = await fetch(
      `/api/account/billing/documents/${encodeURIComponent(document.id)}/pay`,
      { method: "POST" }
    );
    const data = (await response.json()) as { paymentUrl?: string; error?: string };
    if (!response.ok || !data.paymentUrl) {
      setPending(null);
      setError(data.error ?? "Unable to open payment.");
      return;
    }
    window.location.href = data.paymentUrl;
  }

  async function cancelSubscription() {
    setPending("cancel");
    setMessage(null);
    setError(null);
    const response = await fetch("/api/account/billing/cancel", { method: "POST" });
    const data = (await response.json()) as { error?: string };
    setPending(null);
    if (!response.ok) {
      setError(data.error ?? "Unable to cancel subscription renewal.");
      return;
    }
    setMessage("Auto-renewal stopped. Access remains available until the subscription end date.");
  }

  const currentPackage = overview.currentPackage;
  const totalPages = Math.max(1, Math.ceil(overview.pagination.total / overview.pagination.perPage));
  const firstRow = overview.pagination.total
    ? (overview.pagination.page - 1) * overview.pagination.perPage + 1
    : 0;
  const lastRow = Math.min(
    overview.pagination.page * overview.pagination.perPage,
    overview.pagination.total
  );
  const showReminder = !isSubscriptionExpired && (
    overview.summary.openInvoices > 0 ||
    currentPackage?.status === "grace_period"
  );

  return (
    <div className="subscriber-billing-page">
      <header className="subscriber-billing-header">
        <div className="subscriber-billing-header-content">
          <span>Subscriber billing</span>
          <h1>My plan</h1>
          <p>{isSubscriptionExpired ? "See your previous package and access your invoices and receipts." : "Manage your subscription and access your billing documents."}</p>
        </div>
      </header>

      {cleanupWarning ? <section className="billing-expiry-warning billing-expired-summary" aria-labelledby="expired-subscription-heading"><div><span className="subscriber-status-badge is-expired">Subscription expired</span><h2 id="expired-subscription-heading">Your subscription has expired</h2><strong>{currentPackage?.name || "Previous package"}</strong>{currentPackage && Number.isFinite(currentPackage.price) ? <p className="billing-expired-package-price">{formatMoney(currentPackage.price, currentPackage.currency)} <i /> {formatBillingCycle(currentPackage.billingCycle)}</p> : null}<p>Select “Continue subscription” to choose a package and restore access to Connexa.</p></div><Link className="button button-primary" href="/account-settings/billing/plans?source=expired">Continue subscription</Link></section> : null}
      {message ? <p className="form-success">{message}</p> : null}
      {error ? <p className="form-error">{error}</p> : null}

      {!isSubscriptionExpired ? <section className="subscriber-plan-card subscriber-active-plan-card">
        <div className="subscriber-plan-topline">
          <div>
            <span className="subscriber-section-label">Current plan</span>
            <h2>{currentPackage?.name ?? "No active package"}</h2>
            {currentPackage ? (
              <p>
                {formatMoney(currentPackage.price, currentPackage.currency)}
                <i />
                {formatBillingCycle(currentPackage.billingCycle)}
              </p>
            ) : null}
            {subscription?.nextBillingAtIso ? <p className="subscriber-plan-renewal">Expired on {formatDate(subscription.nextBillingAtIso)}</p> : subscription?.endsAtIso ? <p className="subscriber-plan-renewal">Ends on {formatDate(subscription.endsAtIso)}</p> : null}
          </div>
          {currentPackage ? (
            <span className={`subscriber-status-badge is-${currentPackage.status}`}>
              {formatStatus(currentPackage.status)}
            </span>
          ) : null}
        </div>
        <div className="subscriber-active-plan-limits">
          {limits.map((limit) => <SummaryStat key={limit.label} label={compactLimitLabel(limit.label)} value={limit.value} />)}
        </div>
        {canManage ? <div className="subscriber-active-plan-actions">
          <Link className="button button-primary" href="/account-settings/billing/plans">Change plan</Link>
          <Link className="button button-secondary" href="/account-settings/billing/plans">Manage subscription</Link>
          <details className="subscriber-subscription-more">
            <summary>More <span aria-hidden="true">⋯</span></summary>
            <div>
              <button
                className="subscriber-subscription-cancel"
                disabled={pending === "cancel" || !subscription?.autoRenew}
                onClick={() => void cancelSubscription()}
                type="button"
              >
                {pending === "cancel" ? "Updating..." : "Unsubscribe plan"}
              </button>
            </div>
          </details>
        </div> : null}
      </section> : <section className="subscriber-plan-card subscriber-plan-card-compact" aria-label="Billing summary">
        <div className="subscriber-summary-grid subscriber-summary-grid-compact">
          <SummaryStat label="Open invoices" value={String(overview.summary.openInvoices)} />
          <SummaryStat label="Outstanding" value={formatMoney(overview.summary.outstandingAmount, currentPackage?.currency ?? "MYR")} />
          <SummaryStat label="Receipts ready" value={String(overview.summary.receiptsReady)} />
        </div>
      </section>}

      {!isSubscriptionExpired ? <section className="subscriber-billing-summary" aria-label="Billing summary">
        <SummaryStat label="Open invoices" value={String(overview.summary.openInvoices)} />
        <SummaryStat label="Outstanding" value={formatMoney(overview.summary.outstandingAmount, currentPackage?.currency ?? "MYR")} />
        <SummaryStat label="Receipts ready" value={String(overview.summary.receiptsReady)} />
      </section> : null}

      {showReminder ? <PaymentReminder overview={overview} /> : null}

      <section className="subscriber-documents-card">
        <div className="subscriber-documents-heading">
          <div>
            <span className="subscriber-section-label">Documents</span>
            <h2>Invoices and receipts</h2>
            <p>{isSubscriptionExpired ? "View and download your previous billing documents." : "View and download your billing documents."}</p>
          </div>
          <div className="subscriber-documents-tools">
            <span className="subscriber-document-count">
              {overview.pagination.total} document{overview.pagination.total === 1 ? "" : "s"}
            </span>
            <button
              className="subscriber-icon-button"
              disabled={pending === "documents"}
              onClick={() => void loadOverview()}
              type="button"
            >
              {pending === "documents" ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        <div className="subscriber-documents-scroll">
          <table className="subscriber-documents-table">
            <colgroup>
              <col className="subscriber-documents-col-invoice" />
              <col className="subscriber-documents-col-package" />
              <col className="subscriber-documents-col-status" />
              <col className="subscriber-documents-col-date" />
              <col className="subscriber-documents-col-date" />
              <col className="subscriber-documents-col-money" />
              <col className="subscriber-documents-col-money" />
              <col className="subscriber-documents-col-actions" />
            </colgroup>
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Package</th>
                <th>Status</th>
                <th>Issue date</th>
                <th>Due date</th>
                <th>Total</th>
                <th>Balance</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {overview.documents.map((document) => (
                <tr key={document.id}>
                  <td data-label="Invoice">
                    <strong>{document.invoiceNo}</strong>
                    <span>{formatDate(document.issueDateIso)}</span>
                  </td>
                  <td data-label="Package">{document.packageName}</td>
                  <td data-label="Status">
                    <span className={`subscriber-invoice-status is-${document.status}`}>
                      {formatStatus(document.status)}
                    </span>
                  </td>
                  <td data-label="Issue date">{formatDate(document.issueDateIso)}</td>
                  <td data-label="Due date">{formatDate(document.dueDateIso)}</td>
                  <td data-label="Total">{formatMoney(document.total, document.currency)}</td>
                  <td className={document.balance > 0 ? "has-balance" : ""} data-label="Balance">
                    {formatMoney(document.balance, document.currency)}
                  </td>
                  <td data-label="Actions">
                    <div className="subscriber-document-actions">
                      {document.paymentPending && document.balance > 0 ? (
                        <button
                          className="button button-primary"
                          disabled
                          type="button"
                        >
                          Payment pending
                        </button>
                      ) : document.payable && document.balance > 0 ? (
                        <button
                          className="button button-primary"
                          disabled={pending === `pay:${document.id}`}
                          onClick={() => void payNow(document)}
                          type="button"
                        >
                          {pending === `pay:${document.id}` ? "Opening..." : "Pay now"}
                        </button>
                      ) : (
                        null
                      )}
                      {document.invoiceAvailable && document.receiptAvailable ? (
                        <details className="subscriber-document-download-menu">
                          <summary>Download</summary>
                          <div>
                            <a href={documentUrl(document.id, "invoice")}>Download invoice</a>
                            <a href={documentUrl(document.id, "receipt")}>Download receipt</a>
                          </div>
                        </details>
                      ) : document.invoiceAvailable ? (
                        <a
                          className="subscriber-action-secondary"
                          href={documentUrl(document.id, "invoice")}
                        >
                          Download invoice
                        </a>
                      ) : document.receiptAvailable ? (
                        <a
                          className="subscriber-action-secondary"
                          href={documentUrl(document.id, "receipt")}
                        >
                          Download receipt
                        </a>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
              {!overview.documents.length ? (
                <tr>
                  <td className="subscriber-empty-documents" colSpan={8}>
                    No invoices or receipts are available yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <footer className="subscriber-pagination">
          <span>Showing {firstRow}-{lastRow} of {overview.pagination.total}</span>
          <label>
            Rows
            <select
              value={overview.pagination.perPage}
              onChange={(event) => void loadOverview(1, Number(event.target.value))}
            >
              <option value={5}>5</option>
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
            </select>
          </label>
          <button
            disabled={overview.pagination.page <= 1}
            onClick={() => void loadOverview(overview.pagination.page - 1)}
            type="button"
          >
            Prev
          </button>
          <strong>Page {overview.pagination.page} / {totalPages}</strong>
          <button
            disabled={overview.pagination.page >= totalPages}
            onClick={() => void loadOverview(overview.pagination.page + 1)}
            type="button"
          >
            Next
          </button>
        </footer>
      </section>

      <AccountBillingSettingsCard />

    </div>
  );
}

export function AccountBillingSettingsCard() {
  return <section className="subscriber-account-settings-card" aria-labelledby="account-billing-settings-heading">
    <div className="subscriber-account-settings-intro">
      <span className="subscriber-account-settings-icon" aria-hidden="true"><SettingsIcon /></span>
      <div>
        <h2 id="account-billing-settings-heading">Account and billing settings</h2>
        <p>Manage your billing information and account settings.</p>
      </div>
    </div>
    <nav aria-label="Account and billing settings" className="subscriber-account-settings-links">
      <SettingsNavigationItem description="Update your billing information" href="/account-settings/billing/details" icon="billing" title="Manage billing details" />
      <SettingsNavigationItem description="Manage your data and account" href="/account-settings/data-and-account" icon="account" title="Data and account" />
    </nav>
  </section>;
}

function SettingsNavigationItem({ description, href, icon, title }: { description: string; href: string; icon: "billing" | "account"; title: string }) {
  return <Link className="subscriber-account-settings-link" href={href}>
    <span className="subscriber-account-settings-item-icon" aria-hidden="true">{icon === "billing" ? <BillingDetailsIcon /> : <DataAndAccountIcon />}</span>
    <span className="subscriber-account-settings-copy"><strong>{title}</strong><span>{description}</span></span>
    <ChevronRightIcon />
  </Link>;
}

function SettingsIcon() {
  return <svg fill="none" height="20" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="20"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.12 2.12-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V20h-3v-.08A1.7 1.7 0 0 0 10.68 18.36a1.7 1.7 0 0 0-1.88.34l-.06.06-2.12-2.12.06-.06A1.7 1.7 0 0 0 7.02 14.7 1.7 1.7 0 0 0 5.46 13.67H5v-3h.08A1.7 1.7 0 0 0 6.64 9.64 1.7 1.7 0 0 0 6.3 7.76l-.06-.06 2.12-2.12.06.06a1.7 1.7 0 0 0 1.88.34A1.7 1.7 0 0 0 11.33 4.42V4h3v.08a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.12 2.12-.06.06a1.7 1.7 0 0 0-.34 1.88 1.7 1.7 0 0 0 1.56 1.03H20v3h-.08A1.7 1.7 0 0 0 19.4 15Z" /></svg>;
}

function BillingDetailsIcon() {
  return <svg fill="none" height="18" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="18"><rect height="16" rx="2" width="14" x="5" y="4" /><path d="M8 8h8M8 12h8M8 16h5" /></svg>;
}

function DataAndAccountIcon() {
  return <svg fill="none" height="18" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="18"><path d="M12 3 5 6v5c0 4.5 2.9 8.6 7 10 4.1-1.4 7-5.5 7-10V6l-7-3Z" /><path d="M9.5 12 11 13.5l3.5-3.5" /></svg>;
}

function ChevronRightIcon() {
  return <svg aria-hidden="true" fill="none" height="18" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="18"><path d="m9 18 6-6-6-6" /></svg>;
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return <div className="subscriber-summary-stat"><span>{label}</span><strong>{value}</strong></div>;
}

function PaymentReminder({ overview }: { overview: BillingOverview }) {
  const currentPackage = overview.currentPackage;
  const expired = currentPackage?.status === "expired";
  const openInvoice = overview.documents.find((document) => document.status === "open") ?? null;
  const reminderDeadline =
    currentPackage?.status === "free_trial"
      ? openInvoice?.dueDateIso ?? null
      : currentPackage?.gracePeriodEndDate ?? null;
  const timeLeftLabel = formatReminderTimeLeft(reminderDeadline);
  return (
    <section className={`subscriber-payment-reminder${expired ? " is-expired" : ""}`}>
      <span className="subscriber-section-label">Payment reminder</span>
      <h2>{expired ? "Your subscription is expired" : "Package payment is still pending"}</h2>
      <p>
        {expired
          ? "Your subscription is expired. Please settle your outstanding invoice to continue using Connexa."
          : reminderDeadline
            ? `Your billing access remains available until ${formatReminderDateTime(reminderDeadline)}. ${timeLeftLabel} left to pay before access is restricted.`
            : `${overview.summary.openInvoices} invoice${overview.summary.openInvoices === 1 ? " is" : "s are"} awaiting payment.`}
      </p>
    </section>
  );
}

function documentUrl(id: string, type: "invoice" | "receipt") {
  return `/api/account/billing/documents/${encodeURIComponent(id)}/${type}`;
}

function formatDate(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-MY", { year: "numeric", month: "short", day: "numeric" }).format(new Date(value));
}

function formatReminderDateTime(value: string | null) {
  if (!value) return "the due date";
  return `${new Intl.DateTimeFormat("en-MY", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kuala_Lumpur"
  }).format(new Date(value))} (GMT+8)`;
}

function formatReminderTimeLeft(value: string | null) {
  if (!value) return "Time";
  const remainingMs = new Date(value).getTime() - Date.now();
  if (remainingMs <= 0) return "0 hours";
  if (remainingMs < 86_400_000) {
    const hoursLeft = Math.max(1, Math.ceil(remainingMs / 3_600_000));
    return `${hoursLeft} hour${hoursLeft === 1 ? "" : "s"}`;
  }
  const daysLeft = Math.ceil(remainingMs / 86_400_000);
  return `${daysLeft} day${daysLeft === 1 ? "" : "s"}`;
}

function formatMoney(amount: number, currency: string) {
  return new Intl.NumberFormat("en-MY", {
    style: "currency",
    currency: currency === "RM" ? "MYR" : currency || "MYR"
  }).format(amount);
}

function formatBillingCycle(value: string) {
  return value.toUpperCase() === "YEARLY" ? "Every year" : "Every month";
}

function compactLimitLabel(label: string) {
  const labels: Record<string, string> = {
    "Maximum Channels": "Channels",
    "Maximum Users": "Users",
    "Maximum Message Flows": "Message flows",
    "Message Quota": "Messages"
  };
  return labels[label] ?? label;
}

function formatStatus(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}
