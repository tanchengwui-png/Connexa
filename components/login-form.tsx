"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const formData = new FormData(event.currentTarget);
    const response = await fetch("/api/auth/login", {
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

    router.push("/inbox");
    router.refresh();
  }

  return (
    <form className="auth-form metrica-login-form" onSubmit={handleSubmit}>
      <label className="control-block">
        <span className="control-label">Email</span>
        <input className="control-input" name="email" placeholder="you@company.com" type="email" />
      </label>

      <label className="control-block">
        <span className="control-label">Password</span>
        <input
          className="control-input"
          name="password"
          placeholder="Enter your password"
          type="password"
        />
      </label>

      <div className="auth-form-meta">
        <label className="auth-checkbox">
          <input name="remember" type="checkbox" />
          <span>Remember me</span>
        </label>

        <a className="auth-inline-link" href="/">
          Forgot password?
        </a>
      </div>

      {error ? <p className="form-error metrica-login-error">{error}</p> : null}

      <button className="button button-primary auth-submit metrica-login-submit" disabled={pending} type="submit">
        {pending ? "Logging in..." : "Log In"}
      </button>
    </form>
  );
}
