"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DEFAULT_BILLING_COUNTRY,
  getBillingDetailsErrorMessage,
  normalizeBillingDetails,
  type BillingDetailsErrors,
  validateBillingDetails
} from "@/lib/billing-details";

export function RegisterForm({
  selectedPlan,
  selectedPlanLabel
}: {
  selectedPlan: string;
  selectedPlanLabel: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [billingErrors, setBillingErrors] = useState<BillingDetailsErrors>({});

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const formData = new FormData(event.currentTarget);
    const password = String(formData.get("password") ?? "");
    const confirmPassword = String(formData.get("confirmPassword") ?? "");
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

    const response = await fetch("/api/auth/register", {
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
        billingDetails,
        remember: formData.get("remember") === "on",
        freeTrial: true
      })
    });

    const data = (await response.json()) as { error?: string };

    if (!response.ok) {
      setError(data.error ?? "Unable to create workspace.");
      setPending(false);
      return;
    }

    setBillingErrors({});
    router.push("/verify-email");
    router.refresh();
  }

  return (
    <form autoComplete="off" className="auth-form" onSubmit={handleSubmit}>
      <input name="plan" type="hidden" value={selectedPlan} />

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
          className="control-input"
          autoComplete="off"
          name="workspaceName"
          placeholder="Serene Peak Realty"
          type="text"
        />
      </label>

      <label className="control-block">
        <span className="control-label">Password</span>
        <input
          className="control-input"
          autoComplete="off"
          name="password"
          placeholder="Create a password"
          type="password"
        />
      </label>

      <label className="control-block">
        <span className="control-label">Confirm password</span>
        <input
          className="control-input"
          autoComplete="off"
          name="confirmPassword"
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

      <div className="auth-form-meta">
        <label className="auth-checkbox">
          <input defaultChecked name="remember" type="checkbox" />
          <span>Keep me signed in</span>
        </label>
      </div>

      {error ? <p className="muted">{error}</p> : null}

      <button className="button button-primary auth-submit" disabled={pending} type="submit">
        {pending ? "Creating workspace..." : "Create workspace"}
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
