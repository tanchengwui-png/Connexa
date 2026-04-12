"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { useConfirmation } from "@/components/confirmation-provider";
import { useToast } from "@/components/toast-provider";

type InviteFormProps = {
  disabled?: boolean;
  capacityLabel?: string;
  memberLimit?: number | null;
};

export function InviteForm({ disabled = false, capacityLabel, memberLimit }: InviteFormProps) {
  const router = useRouter();
  const { confirm } = useConfirmation();
  const { success } = useToast();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (disabled) {
      return;
    }

    const form = event.currentTarget;
    const formData = new FormData(form);
    const email = String(formData.get("email") ?? "");
    const role = String(formData.get("role") ?? "AGENT");
    const accepted = await confirm({
      title: "Send team invitation",
      description: `Send an invitation to ${email || "this teammate"} as ${role.toLowerCase()}?`,
      confirmLabel: "Send invite"
    });

    if (!accepted) {
      return;
    }

    setPending(true);
    setError(null);

    const response = await fetch("/api/invites", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        email,
        role
      })
    });

    const data = (await response.json()) as { error?: string };

    if (!response.ok) {
      setError(data.error ?? "Unable to send invite.");
      setPending(false);
      return;
    }

    form.reset();
    success("Invite sent", `Invitation email sent to ${email}.`);
    router.refresh();
    setPending(false);
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      <label className="control-block">
        <span className="control-label">Team email</span>
        <input
          className="control-input"
          disabled={pending || disabled}
          name="email"
          placeholder="teammate@company.com"
          type="email"
        />
      </label>

      <label className="control-block">
        <span className="control-label">Role</span>
        <select className="control-select app-select" disabled={pending || disabled} name="role">
          <option value="AGENT">Agent</option>
          <option value="MANAGER">Manager</option>
        </select>
      </label>

      {error ? <p className="form-error">{error}</p> : null}
      {disabled && memberLimit !== null ? (
        <p className="muted">
          {capacityLabel ?? "Current"} plan seat cap reached. Remove a member, revoke a pending invite, or upgrade before inviting more teammates.
        </p>
      ) : null}

      <button className="button button-primary auth-submit" disabled={pending || disabled} type="submit">
        {pending ? "Sending invite..." : "Send invite"}
      </button>
    </form>
  );
}
