"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type AcceptInviteFormProps = {
  token: string;
};

export function AcceptInviteForm({ token }: AcceptInviteFormProps) {
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

    const response = await fetch("/api/invites/accept", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        token,
        name: String(formData.get("name") ?? ""),
        password,
        remember: formData.get("remember") === "on"
      })
    });

    const data = (await response.json()) as { error?: string };

    if (!response.ok) {
      setError(data.error ?? "Unable to accept invitation.");
      setPending(false);
      return;
    }

    router.push("/inbox");
    router.refresh();
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      <label className="control-block">
        <span className="control-label">Your name</span>
        <input className="control-input" name="name" placeholder="Your full name" type="text" />
      </label>

      <label className="control-block">
        <span className="control-label">Password</span>
        <input className="control-input" name="password" placeholder="Create a password" type="password" />
      </label>

      <label className="control-block">
        <span className="control-label">Confirm password</span>
        <input className="control-input" name="confirmPassword" placeholder="Repeat your password" type="password" />
      </label>

      <label className="auth-checkbox">
        <input defaultChecked name="remember" type="checkbox" />
        <span>Keep me signed in</span>
      </label>

      {error ? <p className="form-error">{error}</p> : null}

      <button className="button button-primary auth-submit" disabled={pending} type="submit">
        {pending ? "Joining workspace..." : "Accept invitation"}
      </button>
    </form>
  );
}
