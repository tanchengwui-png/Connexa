"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function PlatformLoginForm({ sessionMessage = null }: { sessionMessage?: string | null }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const formData = new FormData(event.currentTarget);
    const response = await fetch("/api/platform/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        email: String(formData.get("email") ?? ""),
        password: String(formData.get("password") ?? ""),
        remember: formData.get("remember") === "on"
      })
    });

    const data = (await response.json()) as { error?: string };

    if (!response.ok) {
      setError(data.error ?? "Unable to sign in.");
      setPending(false);
      return;
    }

    router.push("/platform");
    router.refresh();
  }

  return (
    <form autoComplete="on" className="auth-form metrica-login-form" method="post" onSubmit={handleSubmit}>
      <label className="control-block">
        <span className="control-label">Platform email</span>
        <span className="metrica-login-input-shell">
          <span aria-hidden="true" className="metrica-login-input-icon">
            <svg fill="none" viewBox="0 0 24 24">
              <path
                d="M4 7.75A1.75 1.75 0 0 1 5.75 6h12.5A1.75 1.75 0 0 1 20 7.75v8.5A1.75 1.75 0 0 1 18.25 18H5.75A1.75 1.75 0 0 1 4 16.25z"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.7"
              />
              <path
                d="m5 8 6.135 4.09a1.55 1.55 0 0 0 1.73 0L19 8"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.7"
              />
            </svg>
          </span>
          <input autoComplete="email" className="control-input" name="email" placeholder="owner@company.com" type="email" />
        </span>
      </label>

      <label className="control-block">
        <span className="control-label">Password</span>
        <span className="metrica-login-input-shell">
          <span aria-hidden="true" className="metrica-login-input-icon">
            <svg fill="none" viewBox="0 0 24 24">
              <path
                d="M8 10V7.75a4 4 0 1 1 8 0V10"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.7"
              />
              <rect
                height="10"
                rx="2"
                stroke="currentColor"
                strokeWidth="1.7"
                width="14"
                x="5"
                y="10"
              />
              <path
                d="M12 14.25v1.5"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.7"
              />
            </svg>
          </span>
          <input autoComplete="current-password" className="control-input" name="password" type={showPassword ? "text" : "password"} />
          <Button
            aria-label={showPassword ? "Hide password" : "Show password"}
            className="metrica-login-password-toggle"
            onClick={() => setShowPassword((current) => !current)}
            selected={showPassword}
            variant="icon"
          >
            {showPassword ? (
              <svg fill="none" viewBox="0 0 24 24">
                <path
                  d="M3 3l18 18"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.7"
                />
                <path
                  d="M10.585 10.587A2 2 0 0 0 12 14a2 2 0 0 0 1.413-.585"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.7"
                />
                <path
                  d="M9.88 5.09A10.94 10.94 0 0 1 12 4.875c5.25 0 8.625 7.125 8.625 7.125a18.6 18.6 0 0 1-2.115 3.148M6.364 6.365C4.547 7.603 3.375 9.998 3.375 12c0 0 3.375 7.125 8.625 7.125a10.9 10.9 0 0 0 3.003-.42"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.7"
                />
              </svg>
            ) : (
              <svg fill="none" viewBox="0 0 24 24">
                <path
                  d="M1.875 12S5.25 4.875 12 4.875 22.125 12 22.125 12 18.75 19.125 12 19.125 1.875 12 1.875 12Z"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.7"
                />
                <path
                  d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.7"
                />
              </svg>
            )}
          </Button>
        </span>
      </label>

      <div className="auth-form-meta">
        <label className="auth-checkbox">
          <input name="remember" type="checkbox" />
          <span>Remember me</span>
        </label>

        <span className="table-subtle">Platform owner access</span>
      </div>

      {sessionMessage ? <p className="auth-support-note">{sessionMessage}</p> : null}
      {error ? <p className="form-error metrica-login-error">{error}</p> : null}

      <button className="button button-primary auth-submit metrica-login-submit" disabled={pending} type="submit">
        {pending ? "Logging in..." : "Log In"}
      </button>
    </form>
  );
}
