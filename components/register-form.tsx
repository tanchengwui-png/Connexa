"use client";

import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import {
  DEFAULT_BILLING_COUNTRY,
  getBillingDetailsErrorMessage,
  normalizeBillingDetails,
  type BillingDetailsErrors,
  validateBillingDetails
} from "@/lib/billing-details";

type RegisterFormControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

export function findFirstInvalidFormControl(form: HTMLFormElement) {
  return Array.from(form.elements).find(
    (element): element is RegisterFormControl =>
      (element instanceof HTMLInputElement ||
        element instanceof HTMLSelectElement ||
        element instanceof HTMLTextAreaElement) &&
      element.willValidate &&
      !element.checkValidity()
  ) ?? null;
}

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
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [confirmationWorkspaceName, setConfirmationWorkspaceName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [billingErrors, setBillingErrors] = useState<BillingDetailsErrors>({});
  const pendingRegistrationRef = useRef<FormData | null>(null);
  const isCreatingRef = useRef(false);
  const submitButtonRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!confirmationOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    cancelButtonRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [confirmationOpen]);

  useEffect(() => {
    if (!confirmationOpen) {
      return;
    }

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        if (!isCreating) {
          event.preventDefault();
          closeConfirmation();
        }
        return;
      }

      if (event.key !== "Tab" || !dialogRef.current) {
        return;
      }

      const focusableElements = getDialogFocusableElements(dialogRef.current);
      if (!focusableElements.length) {
        event.preventDefault();
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
        return;
      }

      if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [confirmationOpen, isCreating]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = event.currentTarget;
    const firstInvalidControl = findFirstInvalidFormControl(form);

    if (firstInvalidControl) {
      firstInvalidControl.scrollIntoView({
        behavior: "smooth",
        block: "center"
      });
      firstInvalidControl.focus();
      firstInvalidControl.reportValidity();
      return;
    }

    const formData = new FormData(form);
    if (!validateRegistrationDetails(formData)) {
      return;
    }

    pendingRegistrationRef.current = formData;
    setConfirmationWorkspaceName(String(formData.get("workspaceName") ?? "").trim() || "this workspace");
    setConfirmationOpen(true);
  }

  function validateRegistrationDetails(formData: FormData) {
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
      return false;
    }

    const billingError = getBillingDetailsErrorMessage(nextBillingErrors);
    if (billingError) {
      setError(billingError);
      return false;
    }

    return true;
  }

  async function submitWorkspace(formData: FormData) {
    const password = String(formData.get("password") ?? "");
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

    const data = (await response.json().catch(() => null)) as { error?: string } | null;

    if (!response.ok) {
      throw new Error(data?.error ?? "Unable to create workspace. Please try again.");
    }

    setBillingErrors({});
    router.push("/verify-email");
    router.refresh();
  }

  async function confirmWorkspaceCreation() {
    if (isCreatingRef.current) return;

    const formData = pendingRegistrationRef.current;
    if (!formData) {
      setError("Your registration details are no longer available. Go back and submit the form again.");
      return;
    }

    try {
      isCreatingRef.current = true;
      setIsCreating(true);
      setPending(true);
      setError(null);
      await submitWorkspace(formData);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to create workspace. Please try again.");
    } finally {
      isCreatingRef.current = false;
      setIsCreating(false);
      setPending(false);
    }
  }

  function closeConfirmation() {
    if (isCreatingRef.current) {
      return;
    }

    pendingRegistrationRef.current = null;
    setError(null);
    setConfirmationOpen(false);
    submitButtonRef.current?.focus();
  }

  function handleDialogKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter") {
      event.stopPropagation();
    }
  }

  const confirmationDialog = confirmationOpen ? (
    <div className="payment-confirmation-overlay" onClick={closeConfirmation}>
      <div
        aria-describedby="register-confirmation-description"
        aria-labelledby="register-confirmation-title"
        aria-modal="true"
        className="payment-confirmation-dialog"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={handleDialogKeyDown}
        ref={dialogRef}
        role="dialog"
      >
        <div className="payment-confirmation-header">
          <h2 id="register-confirmation-title">Create this workspace?</h2>
          <button
            aria-label="Close confirmation"
            className="payment-confirmation-close"
            disabled={isCreating}
            onClick={closeConfirmation}
            type="button"
          >
            ×
          </button>
        </div>
        <p className="payment-confirmation-description" id="register-confirmation-description">
          You’re about to create {confirmationWorkspaceName}. Please confirm that your workspace and billing details are
          correct.
        </p>
        {error ? (
          <p className="payment-confirmation-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="payment-confirmation-actions">
          <button
            className="button button-secondary payment-confirmation-secondary"
            disabled={isCreating}
            onClick={closeConfirmation}
            ref={cancelButtonRef}
            type="button"
          >
            Go back
          </button>
          <button
            className="button button-primary payment-confirmation-primary"
            disabled={isCreating}
            onClick={() => void confirmWorkspaceCreation()}
            type="button"
          >
            {isCreating ? "Creating workspace…" : error ? "Try again" : "Create workspace"}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <form autoComplete="off" className="auth-form" onSubmit={handleSubmit}>
      <input name="plan" type="hidden" value={selectedPlan} />

      <label className="control-block">
        <span className="control-label">Selected package</span>
        <input className="control-input" disabled type="text" value={selectedPlanLabel} />
      </label>

      <label className="control-block">
        <span className="control-label">Your name</span>
        <input autoComplete="off" className="control-input" name="name" placeholder="Farid Rahman" required type="text" />
      </label>

      <label className="control-block">
        <span className="control-label">Work email</span>
        <input autoComplete="off" className="control-input" name="email" placeholder="you@company.com" required type="email" />
      </label>

      <label className="control-block">
        <span className="control-label">Workspace name</span>
        <input
          className="control-input"
          autoComplete="off"
          name="workspaceName"
          placeholder="Serene Peak Realty"
          required
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
          required
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
          required
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

      <button className="button button-primary auth-submit" disabled={pending} ref={submitButtonRef} type="submit">
        {pending ? "Creating workspace…" : "Create workspace"}
      </button>

      {confirmationDialog && typeof document !== "undefined"
        ? createPortal(confirmationDialog, document.body)
        : null}
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

function getDialogFocusableElements(dialog: HTMLElement) {
  return Array.from(
    dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  ).filter((element) => !element.hasAttribute("disabled") && element.tabIndex !== -1);
}
