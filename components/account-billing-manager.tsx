"use client";

import { FormEvent, useEffect, useState } from "react";

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
  profile: {
    billingName: string;
    billingEmail: string;
    contactNumber: string;
    billingAddress1: string;
    billingAddress2: string | null;
    billingCity: string;
    billingState: string;
    billingPostcode: string;
    billingCountry: string;
    taxNumber: string | null;
  };
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
  initialMessage?: string | null;
};

export function AccountBillingManager({
  canManage,
  profile,
  initialOverview,
  subscription,
  limits,
  cleanupWarning,
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

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending("profile");
    setMessage(null);
    setError(null);
    const formData = new FormData(event.currentTarget);
    const response = await fetch("/api/account/billing/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        billingName: String(formData.get("billingName") ?? ""),
        billingEmail: String(formData.get("billingEmail") ?? ""),
        billingPhoneNumber: String(formData.get("billingPhoneNumber") ?? ""),
        billingAddressLine1: String(formData.get("billingAddressLine1") ?? ""),
        billingAddressLine2: String(formData.get("billingAddressLine2") ?? ""),
        billingCity: String(formData.get("billingCity") ?? ""),
        billingState: String(formData.get("billingState") ?? ""),
        billingPostcode: String(formData.get("billingPostcode") ?? ""),
        billingCountry: String(formData.get("billingCountry") ?? ""),
        billingTaxId: String(formData.get("billingTaxId") ?? "")
      })
    });
    const data = (await response.json()) as { error?: string };
    setPending(null);
    if (!response.ok) {
      setError(data.error ?? "Unable to save billing information.");
      return;
    }
    setMessage("Billing information saved.");
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
  const showReminder =
    overview.summary.openInvoices > 0 ||
    currentPackage?.status === "grace_period" ||
    currentPackage?.status === "expired";

  return (
    <div className="subscriber-billing-page">
      <header className="subscriber-billing-header">
        <span>Subscriber billing</span>
        <h1>My plan</h1>
        <p>See your current package, settle outstanding invoices, and download your billing documents.</p>
      </header>

      {cleanupWarning ? <div className="billing-expiry-warning">{cleanupWarning}</div> : null}
      {message ? <p className="form-success">{message}</p> : null}
      {error ? <p className="form-error">{error}</p> : null}

      <section className="subscriber-plan-card">
        <div className="subscriber-plan-topline">
          <div>
            <span className="subscriber-section-label">Current package</span>
            <h2>{currentPackage?.name ?? "No active package"}</h2>
            {currentPackage ? (
              <p>
                {formatMoney(currentPackage.price, currentPackage.currency)}
                <i />
                {formatBillingCycle(currentPackage.billingCycle)}
              </p>
            ) : null}
          </div>
          {currentPackage ? (
            <span className={`subscriber-status-badge is-${currentPackage.status}`}>
              {formatStatus(currentPackage.status)}
            </span>
          ) : null}
        </div>
        <div className="subscriber-summary-grid">
          <SummaryStat label="Open invoices" value={String(overview.summary.openInvoices)} />
          <SummaryStat
            label="Outstanding"
            value={formatMoney(
              overview.summary.outstandingAmount,
              currentPackage?.currency ?? "MYR"
            )}
          />
          <SummaryStat label="Receipts ready" value={String(overview.summary.receiptsReady)} />
        </div>
      </section>

      {showReminder ? <PaymentReminder overview={overview} /> : null}

      <section className="subscriber-documents-card">
        <div className="subscriber-documents-heading">
          <div>
            <span className="subscriber-section-label">Documents</span>
            <h2>Invoices and receipts</h2>
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
                      {document.invoiceAvailable ? (
                        <a
                          className="subscriber-action-secondary"
                          href={documentUrl(document.id, "invoice")}
                        >
                          Download invoice
                        </a>
                      ) : null}
                      {document.receiptAvailable ? (
                        <a
                          className="subscriber-action-secondary"
                          href={documentUrl(document.id, "receipt")}
                        >
                          Download receipt
                        </a>
                      ) : (
                        null
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {!overview.documents.length ? (
                <tr>
                  <td className="subscriber-empty-documents" colSpan={8}>
                    No invoices or receipts have been issued yet.
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

      <div className="subscriber-section-break">
        <span className="subscriber-section-label">Workspace billing controls</span>
        <h2>Billing settings and package controls</h2>
        <p>Manage invoice contact details, package limits, and subscription actions in separate sections below.</p>
      </div>

      {canManage ? <section className="content-card settings-dark-panel subscriber-settings-card subscriber-settings-section">
        <div className="card-header settings-dark-panel-head">
          <div>
            <h3 className="card-title">Billing information</h3>
            <p className="muted">Used as the billing source of truth for invoices, receipts, and payment confirmations.</p>
          </div>
        </div>
        <form className="availability-settings-form" onSubmit={saveProfile}>
          <div className="platform-settings-field-grid compact">
            <label className="control-block">
              <span className="control-label">Billing name / company name</span>
              <input className="control-input" defaultValue={profile.billingName} name="billingName" required />
            </label>
            <label className="control-block">
              <span className="control-label">Billing Email</span>
              <input className="control-input" defaultValue={profile.billingEmail} name="billingEmail" required type="email" />
            </label>
            <label className="control-block">
              <span className="control-label">Phone number</span>
              <input className="control-input" defaultValue={profile.contactNumber} name="billingPhoneNumber" required />
            </label>
            <label className="control-block">
              <span className="control-label">Tax ID / SST number</span>
              <input className="control-input" defaultValue={profile.taxNumber ?? ""} name="billingTaxId" />
            </label>
            <label className="control-block">
              <span className="control-label">Billing address line 1</span>
              <input className="control-input" defaultValue={profile.billingAddress1} name="billingAddressLine1" required />
            </label>
            <label className="control-block">
              <span className="control-label">Billing address line 2</span>
              <input className="control-input" defaultValue={profile.billingAddress2 ?? ""} name="billingAddressLine2" />
            </label>
            <label className="control-block">
              <span className="control-label">City</span>
              <input className="control-input" defaultValue={profile.billingCity} name="billingCity" required />
            </label>
            <label className="control-block">
              <span className="control-label">State</span>
              <input className="control-input" defaultValue={profile.billingState} name="billingState" required />
            </label>
            <label className="control-block">
              <span className="control-label">Postcode</span>
              <input className="control-input" defaultValue={profile.billingPostcode} name="billingPostcode" pattern="[0-9]{5}" required />
            </label>
            <label className="control-block">
              <span className="control-label">Country</span>
              <input className="control-input" defaultValue={profile.billingCountry} name="billingCountry" required />
            </label>
          </div>
          <div className="panel-row">
            <button className="button button-primary" disabled={pending === "profile"} type="submit">
              {pending === "profile" ? "Saving..." : "Save"}
            </button>
          </div>
        </form>
      </section> : null}

      <section className="content-card settings-dark-panel subscriber-settings-card subscriber-settings-section">
        <div className="card-header settings-dark-panel-head">
          <div>
            <h3 className="card-title">Package limits and controls</h3>
            <p className="muted">Review package capacity or change the current subscription.</p>
          </div>
        </div>
        <div className="billing-limit-grid">
          {limits.map((limit) => <SummaryStat key={limit.label} label={limit.label} value={limit.value} />)}
        </div>
        {canManage ? (
          <div className="panel-row">
            <a className="button button-primary" href="#package-management">Upgrade plan</a>
            <a className="button button-secondary" href="#package-management">Manage subscription</a>
            <button
              className="button button-secondary"
              disabled={pending === "cancel" || !subscription?.autoRenew}
              onClick={() => void cancelSubscription()}
              type="button"
            >
              {pending === "cancel" ? "Updating..." : "Unsubscribe plan"}
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
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

function formatStatus(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}
