"use client";

import { FormEvent, useState } from "react";

export function CheckoutForm({
  selectedPlan,
  selectedPlanLabel,
  selectedPlanPriceAmount,
  selectedPlanCurrency,
  selectedPlanBillingPeriod
}: {
  selectedPlan: string;
  selectedPlanLabel: string;
  selectedPlanPriceAmount: number | null;
  selectedPlanCurrency: string | null;
  selectedPlanBillingPeriod: "MONTHLY" | "YEARLY" | null;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [discountCode, setDiscountCode] = useState("");
  const [discountPending, setDiscountPending] = useState(false);
  const [discountMessage, setDiscountMessage] = useState<string | null>(null);
  const [discountSummary, setDiscountSummary] = useState<{
    code: string | null;
    percentage: number | null;
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
    const confirmPassword = String(formData.get("confirmPassword") ?? "");

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
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
        workspaceName: String(formData.get("workspaceName") ?? ""),
        password,
        plan: String(formData.get("plan") ?? ""),
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
        discountCode
      })
    });

    const data = (await response.json()) as {
      error?: string;
      discount?: {
        code: string | null;
        percentage: number | null;
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
    setDiscountMessage(`${data.discount.code} applied. ${data.discount.percentage}% discount is ready.`);
    setDiscountPending(false);
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      <input name="plan" type="hidden" value={selectedPlan} />

      <label className="control-block">
        <span className="control-label">Selected package</span>
        <input className="control-input" disabled type="text" value={selectedPlanLabel} />
      </label>

      <label className="control-block">
        <span className="control-label">Your name</span>
        <input className="control-input" name="name" placeholder="Farid Rahman" type="text" />
      </label>

      <label className="control-block">
        <span className="control-label">Work email</span>
        <input className="control-input" name="email" placeholder="you@company.com" type="email" />
      </label>

      <label className="control-block">
        <span className="control-label">Workspace name</span>
        <input
          className="control-input"
          name="workspaceName"
          placeholder="Serene Peak Realty"
          type="text"
        />
      </label>

      <label className="control-block">
        <span className="control-label">Password</span>
        <input
          className="control-input"
          name="password"
          placeholder="Create a password"
          type="password"
        />
      </label>

      <label className="control-block">
        <span className="control-label">Confirm password</span>
        <input
          className="control-input"
          name="confirmPassword"
          placeholder="Repeat your password"
          type="password"
        />
      </label>

      {canApplyDiscount ? (
        <div className="checkout-discount-card">
          <div className="checkout-discount-head">
            <strong>Discount code</strong>
            <span className="table-subtle">Optional</span>
          </div>

          <div className="checkout-discount-input-row">
            <input
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
            <button className="button" disabled={discountPending || !discountCode.trim()} onClick={applyDiscount} type="button">
              {discountPending ? "Applying..." : "Apply"}
            </button>
          </div>

          <div className="checkout-discount-summary">
            <div>
              <span className="table-subtle">Package price</span>
              <strong>
                {discountSummary?.formattedOriginalAmount ??
                  formatPackageAmount(selectedPlanPriceAmount, selectedPlanCurrency, selectedPlanBillingPeriod)}
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
                  formatPackageAmount(selectedPlanPriceAmount, selectedPlanCurrency, selectedPlanBillingPeriod)}
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
