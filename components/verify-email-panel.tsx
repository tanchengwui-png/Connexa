"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { disableInboxBrowserPushSubscription } from "@/lib/inbox-browser-notifications-client";

type VerifyEmailPanelProps = {
  email: string;
  tokenError?: string | null;
  verified?: boolean;
  continueHref?: string;
  continueLabel?: string;
  verificationAttempted?: boolean;
};

export function VerifyEmailPanel({
  email,
  tokenError = null,
  verified = false,
  continueHref = "/login",
  continueLabel = "Go to login",
  verificationAttempted = false
}: VerifyEmailPanelProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(tokenError);
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);
  const [stage, setStage] = useState<"verify" | "success">(
    verificationAttempted && verified && !tokenError ? "verify" : "success"
  );
  const [countdown, setCountdown] = useState(4);
  const destinationLabel =
    continueHref === "/onboarding"
      ? "onboarding"
      : continueHref === "/inbox"
        ? "your inbox"
        : "the next page";

  useEffect(() => {
    if (!verified) {
      setStage("success");
      setCountdown(4);
      return;
    }

    if (verificationAttempted && !tokenError) {
      setStage("verify");
      setCountdown(4);

      const verifyTimeout = window.setTimeout(() => {
        setStage("success");
        setCountdown(4);
      }, 2200);

      return () => {
        window.clearTimeout(verifyTimeout);
      };
    }

    setStage("success");
    setCountdown(4);
  }, [tokenError, verificationAttempted, verified]);

  useEffect(() => {
    if (!verified || stage !== "success") {
      return;
    }

    setCountdown(4);

    const interval = window.setInterval(() => {
      setCountdown((current) => (current > 0 ? current - 1 : 0));
    }, 1000);
    const timeout = window.setTimeout(() => {
      router.replace(continueHref);
      router.refresh();
    }, 4000);

    return () => {
      window.clearInterval(interval);
      window.clearTimeout(timeout);
    };
  }, [continueHref, router, stage, verified]);

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
        <h2>
          {verified
            ? stage === "verify"
              ? "Verifying your email"
              : "Email verified"
            : "Verify your email"}
        </h2>
        <p className="muted">
          {verified
            ? stage === "verify"
              ? "We are confirming your email now."
              : "Verification completed. We are taking you to your workspace."
            : `We sent a verification email to ${email}.`}
        </p>
      </div>

      {error ? <p className="form-error">{error}</p> : null}

      {verified ? (
        <>
          {stage === "verify" ? (
            <p className="muted" aria-live="polite">
              Verifying your email address now. Please wait a moment.
            </p>
          ) : (
            <>
              <p className="muted" aria-live="polite">
                Verified completed. Taking you to {destinationLabel} in {countdown} second{countdown === 1 ? "" : "s"}.
              </p>
              <a className="button button-primary auth-submit" href={continueHref}>
                {continueLabel}
              </a>
            </>
          )}
        </>
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
              await disableInboxBrowserPushSubscription().catch(() => false);
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
