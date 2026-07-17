"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useConfirmation } from "@/components/confirmation-provider";
import { useToast } from "@/components/toast-provider";

type PendingInvite = {
  id: string;
  email: string;
  role: string;
  expiresAt: string;
};

type PendingInvitesCardProps = {
  invites: PendingInvite[];
};

export function PendingInvitesCard({ invites }: PendingInvitesCardProps) {
  const router = useRouter();
  const { confirm } = useConfirmation();
  const { success } = useToast();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleAction = async (inviteId: string, method: "PATCH" | "DELETE") => {
    const invite = invites.find((item) => item.id === inviteId);
    const accepted = await confirm({
      title: method === "PATCH" ? "Resend invitation" : "Revoke invitation",
      description:
        method === "PATCH"
          ? `Resend the workspace invite to ${invite?.email ?? "this user"}?`
          : `Revoke the workspace invite for ${invite?.email ?? "this user"}?`,
      confirmLabel: method === "PATCH" ? "Resend invite" : "Revoke invite",
      tone: method === "DELETE" ? "danger" : "default"
    });

    if (!accepted) {
      return;
    }

    setError(null);
    startTransition(async () => {
      const response = await fetch(`/api/team/invites/${inviteId}`, {
        method
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(payload?.error ?? `Unable to ${method === "PATCH" ? "resend" : "revoke"} invite.`);
        return;
      }

      success(
        method === "PATCH" ? "Invite resent" : "Invite revoked",
        method === "PATCH"
          ? `A fresh invitation was sent to ${invite?.email ?? "the teammate"}.`
          : `${invite?.email ?? "The invite"} has been revoked.`
      );
      router.refresh();
    });
  };

  return (
    <section className="content-card pending-invites-card">
      <div className="card-header">
        <div>
          <h3 className="card-title">Pending invites</h3>
          <p className="muted">Open invitations waiting for account setup.</p>
        </div>
      </div>

      {error ? <div className="form-error">{error}</div> : null}

      <div className="panel-row">
        {invites.length === 0 ? (
          <div className="lead-row">
            <div className="table-subtle">No pending invites.</div>
          </div>
        ) : (
          invites.map((invite) => (
            <div className="lead-row team-invite-row" key={invite.id}>
              <div>
                <strong>{invite.email}</strong>
                <div className="table-subtle">{invite.role} | expires {invite.expiresAt}</div>
              </div>
              <div className="product-card-actions">
                <button
                  className="inbox-search-tool"
                  disabled={isPending}
                  onClick={() => handleAction(invite.id, "PATCH")}
                  type="button"
                >
                  Resend
                </button>
                <button
                  className="inbox-search-tool product-delete-button"
                  disabled={isPending}
                  onClick={() => handleAction(invite.id, "DELETE")}
                  type="button"
                >
                  Revoke
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
