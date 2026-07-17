"use client";

import { FormEvent, useEffect, useId, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useToast } from "@/components/toast-provider";

const PASSWORD_REQUIREMENTS = [
  "At least 8 characters",
  "One uppercase letter",
  "One number or symbol"
] as const;

export function AccountSecurityCard() {
  const { success, error: showError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [isMounted, setIsMounted] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const changePasswordButtonRef = useRef<HTMLButtonElement | null>(null);
  const currentPasswordInputRef = useRef<HTMLInputElement | null>(null);
  const dialogTitleId = useId();
  const dialogDescriptionId = useId();
  const dialogErrorId = useId();

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (!isDialogOpen) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      currentPasswordInputRef.current?.focus();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDialog();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isDialogOpen]);

  function resetForm() {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmNewPassword("");
    setError(null);
  }

  function closeDialog(options: { reset?: boolean } = {}) {
    setIsDialogOpen(false);
    setError(null);

    if (options.reset) {
      resetForm();
    }

    window.requestAnimationFrame(() => {
      changePasswordButtonRef.current?.focus();
    });
  }

  function openDialog() {
    setError(null);
    setIsDialogOpen(true);
  }

  function validateForm() {
    if (!currentPassword) {
      return "Current password is required.";
    }

    if (!newPassword) {
      return "New password is required.";
    }

    if (newPassword.length < 8) {
      return "Password must be at least 8 characters.";
    }

    if (!/[A-Z]/.test(newPassword)) {
      return "Password must include at least one uppercase letter.";
    }

    if (!/[^A-Za-z0-9]|[0-9]/.test(newPassword)) {
      return "Password must include at least one number or symbol.";
    }

    if (newPassword !== confirmNewPassword) {
      return "Passwords do not match.";
    }

    return null;
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const validationError = validateForm();
    setError(validationError);

    if (validationError) {
      return;
    }

    startTransition(async () => {
      const response = await fetch("/api/account/change-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          currentPassword,
          newPassword,
          confirmNewPassword
        })
      });

      const payload = (await response.json().catch(() => null)) as { error?: string } | null;

      if (!response.ok) {
        const nextError = payload?.error ?? "Unable to change password.";
        setError(nextError);
        showError("Password update failed", nextError);
        return;
      }

      resetForm();
      closeDialog({ reset: true });
      success("Password updated successfully.");
    });
  }

  return (
    <>
      <section className="content-card settings-dark-panel account-security-card">
        <div className="card-header settings-dark-panel-head account-security-card-head">
          <div>
            <h3 className="card-title">Account security</h3>
            <p className="muted">Manage your password and keep your workspace secure.</p>
          </div>
        </div>

        <div className="account-security-card-body">
          <div className="account-security-summary">
            <span className="account-security-summary-label">Password</span>
            <p className="account-security-summary-copy">
              Keep your account secure by updating your password regularly.
            </p>
          </div>

          <button
            ref={changePasswordButtonRef}
            className="button button-primary"
            onClick={openDialog}
            type="button"
          >
            Change password
          </button>
        </div>
      </section>

      {isMounted && isDialogOpen
        ? createPortal(
            <div
              aria-hidden={!isDialogOpen}
              className="inbox-dialog-backdrop"
              onClick={() => closeDialog()}
            >
              <div
                aria-describedby={error ? `${dialogDescriptionId} ${dialogErrorId}` : dialogDescriptionId}
                aria-labelledby={dialogTitleId}
                aria-modal="true"
                className="inbox-dialog confirmation-dialog account-security-dialog"
                onClick={(event) => event.stopPropagation()}
                role="dialog"
              >
                <div className="inbox-dialog-head">
                  <div>
                    <strong id={dialogTitleId}>Change password</strong>
                    <p id={dialogDescriptionId}>
                      For your security, enter your current password before choosing a new one.
                    </p>
                  </div>
                  <button
                    aria-label="Close change password dialog"
                    className="inbox-dialog-close"
                    onClick={() => closeDialog()}
                    type="button"
                  >
                    x
                  </button>
                </div>

                <form className="account-security-dialog-form" onSubmit={handleSubmit}>
                  <label className="control-block">
                    <span className="control-label">Current password</span>
                    <input
                      ref={currentPasswordInputRef}
                      aria-label="Current password"
                      className="control-input"
                      onChange={(event) => setCurrentPassword(event.target.value)}
                      required
                      type="password"
                      value={currentPassword}
                    />
                  </label>

                  <label className="control-block">
                    <span className="control-label">New password</span>
                    <input
                      aria-label="New password"
                      className="control-input"
                      minLength={8}
                      onChange={(event) => setNewPassword(event.target.value)}
                      required
                      type="password"
                      value={newPassword}
                    />
                  </label>

                  <label className="control-block">
                    <span className="control-label">Confirm new password</span>
                    <input
                      aria-label="Confirm new password"
                      className="control-input"
                      minLength={8}
                      onChange={(event) => setConfirmNewPassword(event.target.value)}
                      required
                      type="password"
                      value={confirmNewPassword}
                    />
                  </label>

                  <div className="account-security-requirements">
                    <strong>Password requirements</strong>
                    <ul>
                      {PASSWORD_REQUIREMENTS.map((requirement) => (
                        <li key={requirement}>{requirement}</li>
                      ))}
                    </ul>
                  </div>

                  {error ? (
                    <p className="form-error" id={dialogErrorId} role="alert">
                      {error}
                    </p>
                  ) : null}

                  <div className="inbox-dialog-actions">
                    <button className="button button-secondary" onClick={() => closeDialog()} type="button">
                      Cancel
                    </button>
                    <div className="inbox-dialog-actions-right">
                      <button className="button button-primary" disabled={isPending} type="submit">
                        {isPending ? "Updating..." : "Update password"}
                      </button>
                    </div>
                  </div>
                </form>
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
}
