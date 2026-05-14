"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function PlatformLoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

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
    <form className="auth-form metrica-login-form" method="post" onSubmit={handleSubmit}>
      <label className="control-block">
        <span className="control-label">Platform email</span>
        <input className="control-input" name="email" placeholder="owner@company.com" type="email" />
      </label>

      <label className="control-block">
        <span className="control-label">Password</span>
        <input className="control-input" name="password" type="password" />
      </label>

      <div className="auth-form-meta">
        <label className="auth-checkbox">
          <input name="remember" type="checkbox" />
          <span>Remember me</span>
        </label>

        <span className="table-subtle">Platform owner access</span>
      </div>

      {error ? <p className="form-error metrica-login-error">{error}</p> : null}

      <button className="button button-primary auth-submit metrica-login-submit" disabled={pending} type="submit">
        {pending ? "Logging in..." : "Log In"}
      </button>
    </form>
  );
}
