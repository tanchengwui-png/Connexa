"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const formData = new FormData(event.currentTarget);
    const password = String(formData.get("password") ?? "");
    const confirmPassword = String(formData.get("confirmPassword") ?? "");

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      setPending(false);
      return;
    }

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
        remember: formData.get("remember") === "on"
      })
    });

    const data = (await response.json()) as { error?: string };

    if (!response.ok) {
      setError(data.error ?? "Unable to create workspace.");
      setPending(false);
      return;
    }

    router.push("/verify-email");
    router.refresh();
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      <input name="plan" type="hidden" value={selectedPlan} />

      <label className="control-block">
        <span className="control-label">Selected package</span>
        <input className="control-input" disabled type="text" value={selectedPlanLabel} />
      </label>

      <label className="control-block">
        <span className="control-label">Your name</span>
        <input className="control-input" name="name" placeholder="Farid Rahman" type="text" />
      </label>

      <label className="control-block">
        <span className="control-label">Work email</span>
        <input className="control-input" name="email" placeholder="you@company.com" type="email" />
      </label>

      <label className="control-block">
        <span className="control-label">Workspace name</span>
        <input
          className="control-input"
          name="workspaceName"
          placeholder="Serene Peak Realty"
          type="text"
        />
      </label>

      <label className="control-block">
        <span className="control-label">Password</span>
        <input
          className="control-input"
          name="password"
          placeholder="Create a password"
          type="password"
        />
      </label>

      <label className="control-block">
        <span className="control-label">Confirm password</span>
        <input
          className="control-input"
          name="confirmPassword"
          placeholder="Repeat your password"
          type="password"
        />
      </label>

      <div className="auth-form-meta">
        <label className="auth-checkbox">
          <input defaultChecked name="remember" type="checkbox" />
          <span>Keep me signed in</span>
        </label>
      </div>

      {error ? <p className="muted">{error}</p> : null}

      <button className="button button-primary auth-submit" disabled={pending} type="submit">
        {pending ? "Creating workspace..." : "Create workspace"}
      </button>
    </form>
  );
}
