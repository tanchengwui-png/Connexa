"use client";

import { FormEvent, useId, useState } from "react";
import {
  PASSWORD_RESET_GENERIC_MESSAGE,
  getPasswordResetServerErrorMessage,
  validatePasswordResetEmail
} from "@/lib/auth/password-reset-shared";

export function ForgotPasswordForm() {
  const emailHintId = useId();
  const validationErrorId = useId();
  const serverErrorId = useId();
  const successId = useId();
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (pending) {
      return;
    }

    setValidationError(null);
    setServerError(null);
    setSuccessMessage(null);

    const validation = validatePasswordResetEmail(email);

    if (!validation.ok) {
      setValidationError(validation.error);
      return;
    }

    setPending(true);

    try {
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email: validation.email
        })
      });

      const data = (await response.json().catch(() => null)) as
        | {
            error?: string;
            message?: string;
          }
        | null;

      if (!response.ok) {
        if (response.status === 400) {
          setValidationError(data?.error ?? "Enter a valid email address.");
        } else {
          setServerError(data?.error ?? getPasswordResetServerErrorMessage());
        }
        return;
      }

      setSuccessMessage(data?.message ?? PASSWORD_RESET_GENERIC_MESSAGE);
    } catch {
      setServerError(getPasswordResetServerErrorMessage());
    } finally {
      setPending(false);
    }
  }

  const describedBy = [
    emailHintId,
    validationError ? validationErrorId : null,
    serverError ? serverErrorId : null,
    successMessage ? successId : null
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <form autoComplete="on" className="auth-form forgot-password-form" method="post" onSubmit={handleSubmit}>
      <label className="control-block">
        <span className="control-label">Email</span>
        <input
          aria-describedby={describedBy}
          aria-invalid={validationError ? "true" : "false"}
          autoComplete="email"
          className="control-input forgot-password-input"
          inputMode="email"
          name="email"
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@company.com"
          required
          type="email"
          value={email}
        />
      </label>

      <p className="muted forgot-password-hint" id={emailHintId}>
        Enter the email used for your Connexa workspace login.
      </p>

      {validationError ? (
        <p className="form-error" id={validationErrorId} role="alert">
          {validationError}
        </p>
      ) : null}

      {serverError ? (
        <p className="form-error" id={serverErrorId} role="alert">
          {serverError}
        </p>
      ) : null}

      {successMessage ? (
        <p className="form-success" id={successId} role="status">
          {successMessage}
        </p>
      ) : null}

      <button className="button button-primary auth-submit forgot-password-submit" disabled={pending} type="submit">
        {pending ? "Sending..." : successMessage ? "Send again" : "Send reset instructions"}
      </button>

      <div className="forgot-password-footer">
        <a className="auth-inline-link" href="/login">
          Back to login
        </a>
      </div>
    </form>
  );
}
