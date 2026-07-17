"use client";

import { FormEvent, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { validatePasswordResetForm } from "@/lib/auth/password-reset-shared";

type ResetPasswordFormProps = {
  token: string;
};

export function ResetPasswordForm({ token }: ResetPasswordFormProps) {
  const router = useRouter();
  const passwordHintId = useId();
  const validationErrorId = useId();
  const serverErrorId = useId();
  const successId = useId();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
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

    const validation = validatePasswordResetForm(password, confirmPassword);

    if (!validation.ok) {
      setValidationError(validation.error);
      return;
    }

    setPending(true);

    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          token,
          password,
          confirmPassword
        })
      });

      const data = (await response.json().catch(() => null)) as { error?: string } | null;

      if (!response.ok) {
        setSuccessMessage(null);
        if (response.status === 400) {
          setValidationError(data?.error ?? "Unable to reset password.");
        } else {
          setServerError(data?.error ?? "Unable to reset password right now. Please try again shortly.");
        }
        return;
      }

      setPassword("");
      setConfirmPassword("");
      setSuccessMessage("Your password has been reset. Use your new password to sign in.");
      router.push("/login");
    } catch {
      setSuccessMessage(null);
      setServerError("Unable to reset password right now. Please try again shortly.");
    } finally {
      setPending(false);
    }
  }

  const describedBy = [
    passwordHintId,
    validationError ? validationErrorId : null,
    serverError ? serverErrorId : null,
    successMessage ? successId : null
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <form autoComplete="on" className="auth-form forgot-password-form" method="post" onSubmit={handleSubmit}>
      <label className="control-block">
        <span className="control-label">New password</span>
        <input
          aria-describedby={describedBy}
          aria-invalid={validationError ? "true" : "false"}
          autoComplete="new-password"
          className="control-input forgot-password-input"
          name="password"
          onChange={(event) => setPassword(event.target.value)}
          required
          type="password"
          value={password}
        />
      </label>

      <label className="control-block">
        <span className="control-label">Confirm new password</span>
        <input
          aria-describedby={describedBy}
          aria-invalid={validationError ? "true" : "false"}
          autoComplete="new-password"
          className="control-input forgot-password-input"
          name="confirmPassword"
          onChange={(event) => setConfirmPassword(event.target.value)}
          required
          type="password"
          value={confirmPassword}
        />
      </label>

      <p className="muted forgot-password-hint" id={passwordHintId}>
        Use at least 8 characters. Resetting your password signs out existing sessions for this email.
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
        {pending ? "Resetting..." : successMessage ? "Reset again" : "Reset password"}
      </button>

      <div className="forgot-password-footer">
        <a className="auth-inline-link" href="/login">
          Back to login
        </a>
      </div>
    </form>
  );
}
