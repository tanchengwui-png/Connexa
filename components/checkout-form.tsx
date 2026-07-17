"use client";

import { FormEvent, useState } from "react";
import {
  DEFAULT_BILLING_COUNTRY,
  getBillingDetailsErrorMessage,
  normalizeBillingDetails,
  type BillingDetailsErrors,
  validateBillingDetails
} from "@/lib/billing-details";

export function CheckoutForm({
  selectedPlan,
  selectedBillingPeriod,
  selectedPlanLabel,
  selectedPlanPriceAmount,
  selectedPlanCurrency
}: {
  selectedPlan: string;
  selectedBillingPeriod: "MONTHLY" | "YEARLY";
  selectedPlanLabel: string;
  selectedPlanPriceAmount: number | null;
  selectedPlanCurrency: string | null;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [billingErrors, setBillingErrors] = useState<BillingDetailsErrors>({});
  const [discountCode, setDiscountCode] = useState("");
  const [discountPending, setDiscountPending] = useState(false);
  const [discountMessage, setDiscountMessage] = useState<string | null>(null);
  const [discountSummary, setDiscountSummary] = useState<{
    code: string | null;
    percentage: number | null;
    amountOff: number | null;
    originalAmount: number;
    discountAmount: number;
    finalAmount: number;
    formattedOriginalAmount: string;
    formattedDiscountAmount: string;
    formattedFinalAmount: string;
  } | null>(null);

  const canApplyDiscount = selectedPlanPriceAmount !== null;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const formData = new FormData(event.currentTarget);
    const password = String(formData.get("password") ?? "");
    const confirmPassword = String(formData.get("confirm_password") ?? "");
    const billingDetails = normalizeBillingDetails({
      billingName: formData.get("billing_name"),
      billingPhoneNumber: formData.get("billing_phone_number"),
      billingAddressLine1: formData.get("billing_address_line_1"),
      billingAddressLine2: formData.get("billing_address_line_2"),
      billingCity: formData.get("billing_city"),
      billingState: formData.get("billing_state"),
      billingPostcode: formData.get("billing_postcode"),
      billingCountry: formData.get("billing_country"),
      billingTaxId: formData.get("billing_tax_id")
    });
    const nextBillingErrors = validateBillingDetails(billingDetails);

    setBillingErrors(nextBillingErrors);

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      setPending(false);
      return;
    }

    if (getBillingDetailsErrorMessage(nextBillingErrors)) {
      setError(getBillingDetailsErrorMessage(nextBillingErrors));
      setPending(false);
      return;
    }

    const response = await fetch("/api/public/checkout", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name: String(formData.get("name") ?? ""),
        email: String(formData.get("email") ?? ""),
        workspaceName: String(formData.get("workspace_name") ?? ""),
        password,
        plan: String(formData.get("plan") ?? ""),
        billingPeriod: String(formData.get("billing_period") ?? "monthly"),
        billingDetails,
        remember: formData.get("remember") === "on",
        discountCode: discountCode.trim()
      })
    });

    const data = (await response.json()) as { error?: string; paymentUrl?: string };

    if (!response.ok || !data.paymentUrl) {
      setError(data.error ?? "Unable to start payment.");
      setPending(false);
      return;
    }

    setBillingErrors({});
    window.location.href = data.paymentUrl;
  }

  async function applyDiscount() {
    if (!canApplyDiscount) {
      return;
    }

    setDiscountPending(true);
    setError(null);
    setDiscountMessage(null);

    const response = await fetch("/api/public/discounts/apply", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        plan: selectedPlan,
        billingPeriod: selectedBillingPeriod,
        discountCode
      })
    });

    const data = (await response.json()) as {
      error?: string;
      discount?: {
        code: string | null;
        percentage: number | null;
        amountOff: number | null;
        originalAmount: number;
        discountAmount: number;
        finalAmount: number;
        formattedOriginalAmount: string;
        formattedDiscountAmount: string;
        formattedFinalAmount: string;
      };
    };

    if (!response.ok || !data.discount) {
      setDiscountSummary(null);
      setError(data.error ?? "Unable to apply discount code.");
      setDiscountPending(false);
      return;
    }

    if (!data.discount.code) {
      setDiscountSummary(null);
      setDiscountMessage("No discount code applied.");
      setDiscountPending(false);
      return;
    }

    setDiscountSummary(data.discount);
    setDiscountMessage(
      `${data.discount.code} applied. ${formatDiscountLabel(
        data.discount.percentage,
        data.discount.amountOff,
        selectedPlanCurrency
      )} discount is ready.`
    );
    setDiscountPending(false);
  }

  return (
    <form autoComplete="off" className="auth-form" onSubmit={handleSubmit}>
      <input name="plan" type="hidden" value={selectedPlan} />
      <input name="billing_period" type="hidden" value={selectedBillingPeriod.toLowerCase()} />

      <label className="control-block">
        <span className="control-label">Selected package</span>
        <input className="control-input" disabled type="text" value={selectedPlanLabel} />
      </label>

      <label className="control-block">
        <span className="control-label">Your name</span>
        <input autoComplete="off" className="control-input" name="name" placeholder="Farid Rahman" type="text" />
      </label>

      <label className="control-block">
        <span className="control-label">Work email</span>
        <input autoComplete="off" className="control-input" name="email" placeholder="you@company.com" type="email" />
      </label>

      <label className="control-block">
        <span className="control-label">Workspace name</span>
        <input
          autoComplete="off"
          className="control-input"
          name="workspace_name"
          placeholder="Serene Peak Realty"
          type="text"
        />
      </label>

      <label className="control-block">
        <span className="control-label">Password</span>
        <input
          autoComplete="off"
          className="control-input"
          name="password"
          placeholder="Create a password"
          type="password"
        />
      </label>

      <label className="control-block">
        <span className="control-label">Confirm password</span>
        <input
          autoComplete="off"
          className="control-input"
          name="confirm_password"
          placeholder="Repeat your password"
          type="password"
        />
      </label>

      <div className="checkout-billing-card">
        <div className="checkout-billing-head">
          <strong>Billing details</strong>
          <p>These details will appear on your invoices and receipts.</p>
        </div>

        <div className="platform-settings-field-grid compact checkout-billing-grid">
          <label className="control-block">
            <span className="control-label">Billing name / company name</span>
            <input
              className="control-input"
              name="billing_name"
              onChange={() => clearBillingError("billingName")}
              required
              type="text"
            />
            {billingErrors.billingName ? <p className="form-error">{billingErrors.billingName}</p> : null}
          </label>

          <label className="control-block">
            <span className="control-label">Phone number</span>
            <input
              className="control-input"
              name="billing_phone_number"
              onChange={() => clearBillingError("billingPhoneNumber")}
              required
              type="tel"
            />
            {billingErrors.billingPhoneNumber ? <p className="form-error">{billingErrors.billingPhoneNumber}</p> : null}
          </label>

          <label className="control-block">
            <span className="control-label">Billing address line 1</span>
            <input
              className="control-input"
              name="billing_address_line_1"
              onChange={() => clearBillingError("billingAddressLine1")}
              required
              type="text"
            />
            {billingErrors.billingAddressLine1 ? <p className="form-error">{billingErrors.billingAddressLine1}</p> : null}
          </label>

          <label className="control-block">
            <span className="control-label">Billing address line 2</span>
            <input
              className="control-input"
              name="billing_address_line_2"
              onChange={() => clearBillingError("billingAddressLine2")}
              type="text"
            />
          </label>

          <label className="control-block">
            <span className="control-label">City</span>
            <input
              className="control-input"
              name="billing_city"
              onChange={() => clearBillingError("billingCity")}
              required
              type="text"
            />
            {billingErrors.billingCity ? <p className="form-error">{billingErrors.billingCity}</p> : null}
          </label>

          <label className="control-block">
            <span className="control-label">State</span>
            <input
              className="control-input"
              name="billing_state"
              onChange={() => clearBillingError("billingState")}
              required
              type="text"
            />
            {billingErrors.billingState ? <p className="form-error">{billingErrors.billingState}</p> : null}
          </label>

          <label className="control-block">
            <span className="control-label">Postcode</span>
            <input
              className="control-input"
              inputMode="numeric"
              name="billing_postcode"
              onChange={() => clearBillingError("billingPostcode")}
              pattern="[0-9]{5}"
              required
              type="text"
            />
            {billingErrors.billingPostcode ? <p className="form-error">{billingErrors.billingPostcode}</p> : null}
          </label>

          <label className="control-block">
            <span className="control-label">Country</span>
            <input
              className="control-input"
              defaultValue={DEFAULT_BILLING_COUNTRY}
              name="billing_country"
              onChange={() => clearBillingError("billingCountry")}
              required
              type="text"
            />
            {billingErrors.billingCountry ? <p className="form-error">{billingErrors.billingCountry}</p> : null}
          </label>

          <label className="control-block">
            <span className="control-label">Tax ID / SST number</span>
            <input
              className="control-input"
              name="billing_tax_id"
              onChange={() => clearBillingError("billingTaxId")}
              type="text"
            />
          </label>
        </div>
      </div>

      {canApplyDiscount ? (
        <div className="checkout-discount-card">
          <div className="checkout-discount-head">
            <strong>Discount code</strong>
            <span className="table-subtle">Optional</span>
          </div>

          <div className="checkout-discount-input-row">
            <input
              autoComplete="off"
              className="control-input"
              onChange={(event) => {
                setDiscountCode(event.target.value.toUpperCase());
                setDiscountSummary(null);
                setDiscountMessage(null);
              }}
              placeholder="Enter discount code"
              type="text"
              value={discountCode}
            />
            <button className="button button-secondary" disabled={discountPending || !discountCode.trim()} onClick={applyDiscount} type="button">
              {discountPending ? "Applying..." : "Apply"}
            </button>
          </div>

          <div className="checkout-discount-summary">
            <div>
              <span className="table-subtle">Package price</span>
              <strong>
                {discountSummary?.formattedOriginalAmount ??
                  formatPackageAmount(selectedPlanPriceAmount, selectedPlanCurrency, selectedBillingPeriod)}
              </strong>
            </div>
            <div>
              <span className="table-subtle">Discount</span>
              <strong>{discountSummary ? `- ${discountSummary.formattedDiscountAmount}` : "None"}</strong>
            </div>
            <div>
              <span className="table-subtle">You pay</span>
              <strong>
                {discountSummary?.formattedFinalAmount ??
                  formatPackageAmount(selectedPlanPriceAmount, selectedPlanCurrency, selectedBillingPeriod)}
              </strong>
            </div>
          </div>

          {discountMessage ? <p className="table-subtle">{discountMessage}</p> : null}
        </div>
      ) : null}

      <div className="auth-form-meta">
        <label className="auth-checkbox">
          <input defaultChecked name="remember" type="checkbox" />
          <span>Keep me signed in after payment</span>
        </label>
      </div>

      {error ? <p className="muted">{error}</p> : null}

      <button className="button button-primary auth-submit" disabled={pending} type="submit">
        {pending ? "Preparing payment..." : "Continue to payment"}
      </button>
    </form>
  );

  function clearBillingError(field: keyof BillingDetailsErrors) {
    setBillingErrors((current) => {
      if (!current[field]) {
        return current;
      }
      const next = { ...current };
      delete next[field];
      return next;
    });
  }
}

function formatPackageAmount(
  amount: number | null,
  currency: string | null,
  billingPeriod: "MONTHLY" | "YEARLY" | null
) {
  if (amount === null) {
    return "Custom";
  }

  const formattedAmount = new Intl.NumberFormat("en-MY", {
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2
  }).format(amount);
  const currencyPrefix = currency === "MYR" || !currency ? "RM" : `${currency} `;
  const periodSuffix = billingPeriod === "YEARLY" ? "/yr" : billingPeriod === "MONTHLY" ? "/mo" : "";
  return `${currencyPrefix}${formattedAmount}${periodSuffix}`;
}

function formatDiscountLabel(percentage: number | null, amountOff: number | null, currency: string | null) {
  if (amountOff !== null) {
    return formatPackageAmount(amountOff, currency, null);
  }

  if (percentage !== null) {
    return `${percentage}%`;
  }

  return "";
}
