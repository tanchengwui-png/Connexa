"use client";

import { useState } from "react";

export function BillingLinkAccountSwitcher({ returnTo }: { returnTo: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signInWithAnotherAccount() {
    setPending(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) {
        throw new Error("Unable to end the current session.");
      }

      window.location.assign(`/login?returnTo=${encodeURIComponent(returnTo)}`);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to change accounts.");
      setPending(false);
    }
  }

  return (
    <div className="forgot-password-form">
      <button
        className="button button-primary auth-submit forgot-password-submit"
        disabled={pending}
        onClick={signInWithAnotherAccount}
        type="button"
      >
        {pending ? "Signing out..." : "Sign in with another account"}
      </button>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="forgot-password-footer">
        <a className="auth-inline-link" href="/inbox">
          Return to Connexa
        </a>
      </div>
    </div>
  );
}
