"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useConfirmation } from "@/components/confirmation-provider";
import {
  buildWorkspacePackagePricingView,
  formatWorkspacePackageBillingPeriodLabel
} from "@/lib/workspace-package-management";
import { PACKAGE_BILLING_PERIOD, type PackageBillingPeriod } from "@/lib/package-pricing";

type UpgradeInvoice = {
  id: string;
  invoiceNumber: string;
  operationType: "UPGRADE" | "RENEWAL" | "DOWNGRADE";
  currentPlan: string;
  currentPackageLabel: string;
  targetPlan: string;
  targetPackageLabel: string;
  amount: number | null;
  currency: string | null;
  billingPeriod: "MONTHLY" | "YEARLY";
  status: string;
  providerCheckoutUrl: string | null;
  replacedById: string | null;
  replacesId: string | null;
  replacementReason: string | null;
  paymentStartedAt: string | null;
  paidAt: string | null;
  cancelledAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type WorkspacePackageOption = {
  key: string;
  name: string;
  operationType: "UPGRADE" | "RENEWAL" | "DOWNGRADE";
  summary: string;
  highlights: [string, string, string];
  priceAmount: number | null;
  monthlyPriceAmount: number | null;
  yearlyDiscountPercentage: number;
  currency: string | null;
  billingPeriod: "MONTHLY" | "YEARLY" | null;
  pricing: {
    monthly: {
      priceAmount: number | null;
      formattedPrice: string;
    };
    yearly: {
      discountPercentage: number;
      basePriceAmount: number | null;
      discountAmount: number | null;
      payablePriceAmount: number | null;
      savingsAmount: number | null;
      effectiveMonthlyPriceAmount: number | null;
      formattedBasePrice: string;
      formattedDiscountAmount: string;
      formattedPayablePrice: string;
      formattedSavingsAmount: string;
      formattedEffectiveMonthlyPrice: string;
    };
  };
  selfServe: boolean;
};

type WorkspacePackageUpgradeCardProps = {
  currentPackageLabel: string;
  currentPackageStatus?: string | null;
  currentPackageEndsAtIso?: string | null;
  entryNotice?: string | null;
  feedbackStatus?: "success" | "failed" | "pending" | null;
  initialBillingPeriod: PackageBillingPeriod;
  options: WorkspacePackageOption[];
  initialInvoices: UpgradeInvoice[];
};

export function WorkspacePackageUpgradeCard({
  currentPackageLabel,
  currentPackageStatus = null,
  currentPackageEndsAtIso = null,
  entryNotice = null,
  feedbackStatus = null,
  initialBillingPeriod,
  options,
  initialInvoices
}: WorkspacePackageUpgradeCardProps) {
  const router = useRouter();
  const { confirm } = useConfirmation();
  const [invoices, setInvoices] = useState(initialInvoices);
  const [billingPeriod, setBillingPeriod] = useState<PackageBillingPeriod>(initialBillingPeriod);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const historyDialogRef = useRef<HTMLDivElement | null>(null);
  const historyCloseRef = useRef<HTMLButtonElement | null>(null);
  const historyTriggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    setInvoices(initialInvoices);
  }, [initialInvoices]);

  useEffect(() => {
    setBillingPeriod(initialBillingPeriod);
  }, [initialBillingPeriod]);

  useEffect(() => {
    if (!isHistoryOpen) return;

    const previousOverflow = document.body.style.overflow;
    const previousActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = "hidden";
    historyCloseRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsHistoryOpen(false);
        return;
      }

      if (event.key !== "Tab" || !historyDialogRef.current) return;

      const focusableElements = Array.from(
        historyDialogRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((element) => !element.hasAttribute("disabled") && element.offsetParent !== null);

      if (!focusableElements.length) {
        event.preventDefault();
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      requestAnimationFrame(() => {
        (historyTriggerRef.current ?? previousActiveElement)?.focus();
      });
    };
  }, [isHistoryOpen]);

  async function handleCreateInvoice(option: WorkspacePackageOption) {
    const selectedBillingLabel = formatWorkspacePackageBillingPeriodLabel(billingPeriod);
    const openInvoice = invoices.find((invoice) => invoice.status === "ISSUED") ?? null;
    const processingInvoice = invoices.find((invoice) => invoice.status === "PAYMENT_PROCESSING") ?? null;
    const endpoint = option.operationType === "DOWNGRADE" ? "/api/account/billing/downgrade" : "/api/account/package-upgrade";
    const replacementCopy = openInvoice
      ? ` This will replace your unpaid ${openInvoice.operationType.toLowerCase()} ${getBillingIntervalText(openInvoice.billingPeriod)} invoice for ${openInvoice.targetPackageLabel}.`
      : "";
    const isExpiredSamePlanRenewal = option.operationType === "RENEWAL" && currentPackageStatus === "EXPIRED";
    const approved = await confirm({
      title: isExpiredSamePlanRenewal
        ? `Renew ${option.name} ${selectedBillingLabel}?`
        : `${getOperationVerb(option.operationType)} ${option.name} ${selectedBillingLabel}?`,
      description:
        isExpiredSamePlanRenewal
          ? `Your ${option.name} plan has expired. Create a ${selectedBillingLabel.toLowerCase()} renewal invoice to reactivate your existing plan. Once payment is completed, ${option.name} access and plan limits will be restored immediately.`
          : option.operationType === "DOWNGRADE"
            ? `You are changing from ${currentPackageLabel} to ${option.name} on ${selectedBillingLabel.toLowerCase()} billing. Some features and usage limits will be reduced. Existing data will not be deleted, but some actions may be restricted if current usage exceeds ${option.name} limits.${replacementCopy}`
            : `${currentPackageLabel} stays active until payment is completed. After payment, this workspace uses ${option.name} on ${selectedBillingLabel.toLowerCase()} billing and the new limits apply immediately.${replacementCopy}`,
      confirmLabel:
        option.operationType === "RENEWAL"
          ? `Renew ${option.name} ${selectedBillingLabel}`
          : option.operationType === "DOWNGRADE"
            ? `Downgrade to ${option.name} ${selectedBillingLabel}`
            : `Upgrade to ${option.name} ${selectedBillingLabel}`,
      cancelLabel: "Not Now"
    });

    if (!approved || processingInvoice) {
      if (processingInvoice) {
        setError("A package payment is already processing. Wait for it to complete before changing plans.");
      }
      return;
    }

    const targetPlan = option.key;
    const existingMatchingInvoice = invoices.find((invoice) =>
      invoice.targetPlan === targetPlan &&
      invoice.billingPeriod === billingPeriod &&
      invoice.operationType === option.operationType &&
      (invoice.status === "ISSUED" ||
        invoice.status === "PAYMENT_PROCESSING" ||
        invoice.status === "PAYMENT_FAILED")
    ) ?? null;
    setPendingAction(`create:${targetPlan}:${billingPeriod}`);
    setError(null);
    setMessage(null);

    const controller = new AbortController();
    const requestTimeout = window.setTimeout(() => controller.abort(), 15000);

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          targetPlan,
          billingPeriod
        }),
        signal: controller.signal
      });

      const data = (await response.json()) as { error?: string; invoices?: UpgradeInvoice[] };

      if (!response.ok || !data.invoices) {
        setError(data.error ?? "Unable to create package invoice.");
        return;
      }

      setInvoices(data.invoices);
      const matchingInvoice = data.invoices.find((invoice) =>
        invoice.targetPlan === targetPlan &&
        invoice.billingPeriod === billingPeriod &&
        invoice.operationType === option.operationType &&
        (invoice.status === "ISSUED" ||
          invoice.status === "PAYMENT_PROCESSING" ||
          invoice.status === "PAYMENT_FAILED")
      ) ?? null;
      setMessage(
        existingMatchingInvoice && matchingInvoice?.id === existingMatchingInvoice.id
          ? `${option.name} ${option.operationType.toLowerCase()} ${selectedBillingLabel.toLowerCase()} invoice already exists. Review it below, then pay when ready.`
          : `${option.name} ${option.operationType.toLowerCase()} ${selectedBillingLabel.toLowerCase()} invoice is ready. Review it below, then pay when ready.`
      );
    } catch (caughtError) {
      setError(
        caughtError instanceof DOMException && caughtError.name === "AbortError"
          ? "This request is taking too long. Refresh the page and check Package Invoice History."
          : caughtError instanceof Error
            ? caughtError.message
            : "Unable to create package invoice."
      );
      return;
    } finally {
      window.clearTimeout(requestTimeout);
      setPendingAction(null);
    }

    router.refresh();
  }

  async function handlePayInvoice(invoiceId: string) {
    setPendingAction(`pay:${invoiceId}`);
    setError(null);
    setMessage(null);

    const response = await fetch(`/api/account/package-upgrade/${invoiceId}/pay`, {
      method: "POST"
    });

    const data = (await response.json()) as { error?: string; paymentUrl?: string };

    if (!response.ok || !data.paymentUrl) {
      setError(data.error ?? "Unable to open invoice payment.");
      setPendingAction(null);
      return;
    }

    window.location.href = data.paymentUrl;
  }

  async function handleCancelInvoice(invoiceId: string) {
    setPendingAction(`cancel:${invoiceId}`);
    setError(null);
    setMessage(null);

    const response = await fetch(`/api/account/package-upgrade/${invoiceId}/cancel`, {
      method: "POST"
    });

    const data = (await response.json()) as { error?: string; invoices?: UpgradeInvoice[] };

    if (!response.ok || !data.invoices) {
      setError(data.error ?? "Unable to cancel package invoice.");
      setPendingAction(null);
      return;
    }

    setInvoices(data.invoices);
    setMessage("Package invoice cancelled.");
    setPendingAction(null);
  }

  const activeInvoices = invoices.filter(
    (invoice) =>
      invoice.status === "ISSUED" ||
      invoice.status === "PAYMENT_PROCESSING" ||
      invoice.status === "PAYMENT_FAILED"
  );
  const openInvoice = activeInvoices[0] ?? null;
  const historyStatusLabel = activeInvoices.length
    ? `${activeInvoices.length} awaiting payment`
    : "No open invoice";
  const isDowngradeLocked = currentPackageStatus !== "EXPIRED";
  const downgradeAvailableLabel = currentPackageEndsAtIso
    ? `You can downgrade after your current plan expires on ${formatDateTime(currentPackageEndsAtIso)}.`
    : "You can downgrade after your current plan expires.";

  const invoiceHistory = !invoices.length ? (
    <p className="table-subtle">No package invoices yet.</p>
  ) : (
    <div className="account-package-upgrade-list account-package-upgrade-list-history">
      {invoices.map((invoice) => (
        <article className="account-package-upgrade-item" key={invoice.id}>
          <div className="account-package-upgrade-copy">
            <div className="account-package-upgrade-title-row">
              <strong>{invoice.invoiceNumber}</strong>
              <span className={`account-package-upgrade-status status-${invoice.status.toLowerCase()}`}>
                {invoice.status}
              </span>
            </div>
            <p>
              {invoice.operationType}: {invoice.currentPackageLabel} to {invoice.targetPackageLabel} ({getBillingIntervalText(invoice.billingPeriod)})
            </p>
            <p className="table-subtle">
              {invoice.amount === null
                ? "Manual billing"
                : formatPackageAmount(invoice.amount, invoice.currency, invoice.billingPeriod)}
            </p>
            <p className="table-subtle">
              {getInvoiceStatusDescription(invoice)}
            </p>
            <p className="table-subtle">Issued {formatDateTime(invoice.createdAt)}</p>
            {invoice.replacementReason ? <p className="table-subtle">{invoice.replacementReason}</p> : null}
            {invoice.paidAt ? <p className="table-subtle">Paid {formatDateTime(invoice.paidAt)}</p> : null}
            {invoice.cancelledAt ? <p className="table-subtle">Cancelled {formatDateTime(invoice.cancelledAt)}</p> : null}
            {invoice.paymentStartedAt ? <p className="table-subtle">Payment started {formatDateTime(invoice.paymentStartedAt)}</p> : null}
          </div>

          {invoice.status === "ISSUED" || invoice.status === "PAYMENT_FAILED" ? (
            <div className="account-package-upgrade-actions">
              <button
                className="button button-primary"
                disabled={pendingAction !== null}
                onClick={() => void handlePayInvoice(invoice.id)}
                type="button"
              >
                {pendingAction === `pay:${invoice.id}`
                  ? "Opening..."
                  : invoice.status === "PAYMENT_FAILED"
                    ? "Retry Payment"
                    : "Pay Now"}
              </button>
              <button
                className="button button-secondary"
                disabled={pendingAction !== null}
                onClick={() => void handleCancelInvoice(invoice.id)}
                type="button"
              >
                {pendingAction === `cancel:${invoice.id}` ? "Cancelling..." : "Cancel"}
              </button>
            </div>
          ) : null}
        </article>
      ))}
    </div>
  );

  return (
    <div className="account-package-upgrade-panel">
      <div className="account-package-upgrade-head">
        <strong>Package management</strong>
        <span className="table-subtle">Current: {currentPackageLabel}</span>
      </div>

      {feedbackStatus === "success" ? <p className="form-success">Package payment completed.</p> : null}
      {feedbackStatus === "pending" ? (
        <p className="table-subtle">Payment return is still pending confirmation. Refresh this page in a moment.</p>
      ) : null}
      {feedbackStatus === "failed" ? <p className="form-error">Package payment could not be confirmed.</p> : null}
      {entryNotice ? <p className="form-success">{entryNotice}</p> : null}
      {message ? <p className="form-success">{message}</p> : null}
      {error ? <p className="form-error">{error}</p> : null}
      {openInvoice ? (
        <p className="table-subtle">
          Current pending selection: {openInvoice.operationType} to {openInvoice.targetPackageLabel} on {getBillingIntervalText(openInvoice.billingPeriod)} billing.
        </p>
      ) : null}

      {!options.length ? (
        <p className="table-subtle">No immediate paid package changes are available.</p>
      ) : (
        <div className="account-package-upgrade-stack">
          <div className="account-package-billing-strip" aria-label="Package billing interval">
            <div className="account-package-billing-toggle">
              <button
                className={`account-package-billing-pill${billingPeriod === PACKAGE_BILLING_PERIOD.MONTHLY ? " account-package-billing-pill-active" : ""}`}
                onClick={() => setBillingPeriod(PACKAGE_BILLING_PERIOD.MONTHLY)}
                type="button"
              >
                Monthly
              </button>
              <button
                className={`account-package-billing-pill${billingPeriod === PACKAGE_BILLING_PERIOD.YEARLY ? " account-package-billing-pill-active" : ""}`}
                onClick={() => setBillingPeriod(PACKAGE_BILLING_PERIOD.YEARLY)}
                type="button"
              >
                Yearly
              </button>
            </div>
            <p className="table-subtle">Your package checkout keeps this selected billing interval.</p>
          </div>

          <div className="account-package-upgrade-list account-package-upgrade-list-primary">
            {options.map((option) => {
              const pricingView = buildWorkspacePackagePricingView(option, billingPeriod);

              return (
                <article className="account-package-upgrade-item" key={`${option.operationType}:${option.key}`}>
                  <div className="account-package-upgrade-copy">
                    <div className="account-package-upgrade-title-row">
                      <strong>{option.name}</strong>
                      <span className="table-subtle">
                        {option.priceAmount === null
                          ? "Manual billing"
                          : `${pricingView.displayPrice} • ${pricingView.pricePeriodLabel}`}
                      </span>
                    </div>
                    <p>{option.operationType === "DOWNGRADE" && isDowngradeLocked ? downgradeAvailableLabel : option.summary}</p>
                    <p className="table-subtle">{option.highlights.join(" • ")}</p>
                    {pricingView.isYearly && option.priceAmount !== null ? (
                      <div className="account-package-pricing-meta">
                        {pricingView.yearlyOriginalPrice ? (
                          <span className="account-package-pricing-strike">
                            <s>{pricingView.yearlyOriginalPrice}</s>
                          </span>
                        ) : null}
                        {pricingView.yearlySavingsLabel ? (
                          <span className="account-package-pricing-badge">{pricingView.yearlySavingsLabel}</span>
                        ) : null}
                        {pricingView.yearlyEquivalentLabel ? (
                          <span className="account-package-pricing-note">{pricingView.yearlyEquivalentLabel}</span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>

                  {option.selfServe ? (
                    <button
                      className={`button ${option.operationType === "DOWNGRADE" ? "button-secondary" : "button-primary"}`}
                      disabled={
                        pendingAction !== null ||
                        openInvoice?.status === "PAYMENT_PROCESSING" ||
                        (option.operationType === "DOWNGRADE" && isDowngradeLocked)
                      }
                      onClick={() => void handleCreateInvoice(option)}
                      type="button"
                    >
                      {pendingAction === `create:${option.key}:${billingPeriod}`
                        ? "Creating..."
                        : option.operationType === "RENEWAL"
                          ? `Renew ${option.name} ${formatWorkspacePackageBillingPeriodLabel(billingPeriod)}`
                          : option.operationType === "DOWNGRADE"
                            ? `Downgrade to ${option.name} ${formatWorkspacePackageBillingPeriodLabel(billingPeriod)}`
                            : `Upgrade to ${option.name} ${formatWorkspacePackageBillingPeriodLabel(billingPeriod)}`}
                    </button>
                  ) : (
                    <span className="table-subtle">Manual billing support required.</span>
                  )}
                </article>
              );
            })}
          </div>
        </div>
      )}

      <div className="account-package-upgrade-invoices">
        <div className="account-package-history-summary">
          <div className="account-package-upgrade-head">
            <strong>Package Invoice History</strong>
            <span className="table-subtle">{historyStatusLabel}</span>
          </div>
          <button
            className="button button-secondary"
            onClick={() => setIsHistoryOpen(true)}
            ref={historyTriggerRef}
            type="button"
          >
            View package history
          </button>
        </div>
      </div>

      {isHistoryOpen ? (
        <div
          className="inbox-dialog-backdrop account-package-history-backdrop"
          onClick={() => setIsHistoryOpen(false)}
        >
          <div
            aria-labelledby="package-invoice-history-title"
            aria-modal="true"
            className="inbox-dialog confirmation-dialog account-package-history-dialog"
            onClick={(event) => event.stopPropagation()}
            ref={historyDialogRef}
            role="dialog"
          >
            <div className="inbox-dialog-head">
              <div>
                <strong id="package-invoice-history-title">Package Invoice History</strong>
                <p>{historyStatusLabel}</p>
              </div>
              <button
                aria-label="Close package invoice history"
                className="inbox-dialog-close"
                onClick={() => setIsHistoryOpen(false)}
                ref={historyCloseRef}
                type="button"
              >
                Close
              </button>
            </div>
            <div className="inbox-dialog-body account-package-history-dialog-body">
              {invoiceHistory}
            </div>
            <div className="inbox-dialog-actions">
              <div className="inbox-dialog-actions-right">
                <button className="inbox-dialog-primary" onClick={() => setIsHistoryOpen(false)} type="button">
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function getOperationVerb(operationType: UpgradeInvoice["operationType"]) {
  if (operationType === "DOWNGRADE") return "Downgrade to";
  if (operationType === "RENEWAL") return "Renew";
  return "Upgrade to";
}

function getBillingIntervalText(billingPeriod: UpgradeInvoice["billingPeriod"]) {
  return billingPeriod === PACKAGE_BILLING_PERIOD.YEARLY ? "yearly" : "monthly";
}

function getInvoiceStatusDescription(invoice: UpgradeInvoice) {
  if (invoice.status === "ISSUED") return "Awaiting payment";
  if (invoice.status === "PAYMENT_PROCESSING") return "Payment processing";
  if (invoice.status === "PAID") return "Payment completed";
  if (invoice.status === "SUPERSEDED") return "Replaced by a newer plan selection";
  if (invoice.status === "PAYMENT_FAILED") return "Payment failed";
  return "Invoice cancelled";
}

function formatPackageAmount(
  amount: number,
  currency: string | null,
  billingPeriod: "MONTHLY" | "YEARLY" | null
) {
  const formatter = new Intl.NumberFormat("en-MY", {
    style: "currency",
    currency: currency ?? "MYR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  });
  const periodSuffix = billingPeriod === "YEARLY" ? "/yr" : billingPeriod === "MONTHLY" ? "/mo" : "";
  return `${formatter.format(amount)}${periodSuffix}`;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-MY", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kuala_Lumpur"
  }).format(new Date(value));
}
