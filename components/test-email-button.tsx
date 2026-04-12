"use client";

import { useState } from "react";

export function TestEmailButton() {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setPending(true);
    setMessage(null);
    setError(null);

    const response = await fetch("/api/test-email", {
      method: "POST"
    });

    const data = (await response.json()) as { error?: string };

    if (!response.ok) {
      setError(data.error ?? "Unable to send test email.");
      setPending(false);
      return;
    }

    setMessage("Test email sent to tanchengwui@hotmail.com.");
    setPending(false);
  }

  return (
    <div className="panel-row">
      <button className="button button-primary" disabled={pending} onClick={handleClick} type="button">
        {pending ? "Sending test email..." : "Send test email"}
      </button>
      {message ? <div className="table-subtle">{message}</div> : null}
      {error ? <div className="form-error">{error}</div> : null}
    </div>
  );
}
