"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type VerifyEmailPanelProps = {
  email: string;
  tokenError?: string | null;
  verified?: boolean;
  continueHref?: string;
  continueLabel?: string;
};

export function VerifyEmailPanel({
  email,
  tokenError = null,
  verified = false,
  continueHref = "/login",
  continueLabel = "Go to login"
}: VerifyEmailPanelProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(tokenError);
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  async function handleResend() {
    setPending(true);
    setError(null);

    const response = await fetch("/api/auth/resend-verification", {
      method: "POST"
    });

    const data = (await response.json()) as { error?: string };

    if (!response.ok) {
      setError(data.error ?? "Unable to resend verification email.");
      setPending(false);
      return;
    }

    setSent(true);
    setPending(false);
  }

  return (
    <section className="auth-panel auth-form-panel auth-form-card connexa-public-card connexa-public-form-card register-dark-form-card">
      <div className="auth-form-header">
        <span className="badge auth-badge">Email verification</span>
        <h2>{verified ? "Email verified" : "Verify your email"}</h2>
        <p className="muted">
          {verified
            ? "Your email is confirmed. You can continue to your workspace."
            : `We sent a verification email to ${email}.`}
        </p>
      </div>

      {error ? <p className="form-error">{error}</p> : null}

      {verified ? (
        <a className="button button-primary auth-submit" href={continueHref}>
          {continueLabel}
        </a>
      ) : (
        <>
          <p className="muted">
            Open the email from Connexa and click the verification link to activate your account.
          </p>
          {sent ? <p className="muted">A new verification email has been sent to your inbox.</p> : null}
          <button className="button button-secondary auth-submit" disabled={pending} onClick={handleResend} type="button">
            {pending ? "Sending..." : "Resend verification email"}
          </button>
          <button
            className="button button-secondary auth-submit"
            onClick={async () => {
              await fetch("/api/auth/logout", { method: "POST" });
              router.push("/login");
              router.refresh();
            }}
            type="button"
          >
            Sign out
          </button>
        </>
      )}
    </section>
  );
}
