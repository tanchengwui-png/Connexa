"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { useConfirmation } from "@/components/confirmation-provider";
import { useToast } from "@/components/toast-provider";

type TeamMember = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: string;
  status: string;
  isCurrentManager: boolean;
  availabilityLabel: string;
  availabilityTone: string;
};

type TeamMembersCardProps = {
  members: TeamMember[];
  workspaceName: string;
};

export function TeamMembersCard({ members, workspaceName }: TeamMembersCardProps) {
  const router = useRouter();
  const { confirm } = useConfirmation();
  const { success } = useToast();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { role: string; status: string; phone: string }>>({});

  useEffect(() => {
    setDrafts(
      Object.fromEntries(
        members.map((member) => [
          member.id,
          {
            role: member.role,
            status: member.status,
            phone: member.phone ?? ""
          }
        ])
      )
    );
  }, [members]);

  const updateDraft = (memberId: string, patch: Partial<{ role: string; status: string; phone: string }>) => {
    setDrafts((current) => ({
      ...current,
      [memberId]: {
        role: current[memberId]?.role ?? members.find((member) => member.id === memberId)?.role ?? "AGENT",
        status: current[memberId]?.status ?? members.find((member) => member.id === memberId)?.status ?? "ACTIVE",
        phone: current[memberId]?.phone ?? members.find((member) => member.id === memberId)?.phone ?? "",
        ...patch
      }
    }));
  };

  const saveMember = async (member: TeamMember) => {
    const draft = drafts[member.id] ?? { role: member.role, status: member.status, phone: member.phone ?? "" };
    const nextRole = draft.role;
    const nextStatus = draft.status;
    const nextPhone = draft.phone.trim();

    if (nextRole === member.role && nextStatus === member.status && nextPhone === (member.phone ?? "")) {
      return;
    }

    const accepted = await confirm({
      title: "Confirm member update",
      description: `Save ${member.name} as ${nextRole} with ${nextStatus.toLowerCase()} status?`,
      confirmLabel: "Save changes"
    });

    if (!accepted) {
      return;
    }

    setError(null);
    startTransition(async () => {
      const response = await fetch(`/api/team/members/${member.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          role: nextRole,
          status: nextStatus,
          phone: nextPhone || null
        })
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(payload?.error ?? "Unable to update team member.");
        return;
      }

      success("Member updated", `${member.name} is now ${nextRole.toLowerCase()} and ${nextStatus.toLowerCase()}.`);
      router.refresh();
    });
  };

  const removeMember = async (member: TeamMember) => {
    if (member.isCurrentManager) {
      setError("You cannot remove your own account.");
      return;
    }

    const accepted = await confirm({
      title: "Remove team member",
      description: `Remove ${member.name} from the workspace? This cannot be undone from this screen.`,
      confirmLabel: "Remove member",
      tone: "danger"
    });

    if (!accepted) {
      return;
    }

    setError(null);
    startTransition(async () => {
      const response = await fetch(`/api/team/members/${member.id}`, {
        method: "DELETE"
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(payload?.error ?? "Unable to remove team member.");
        return;
      }

      success("Member removed", `${member.name} has been removed from the workspace.`);
      router.refresh();
    });
  };

  return (
    <section className="content-card">
      <div className="card-header">
        <div>
          <h3 className="card-title">Workspace members</h3>
          <p className="muted">Current roles and statuses for {workspaceName}.</p>
        </div>
      </div>

      {error ? <div className="form-error">{error}</div> : null}

      <div className="team-member-list">
        {members.map((member) => (
          <article className="team-member-row" key={member.id}>
            <div className="team-member-identity">
              <strong>{member.name}</strong>
              <span className="table-subtle">{member.email}</span>
              <span className="table-subtle">{member.phone ? `WhatsApp: ${member.phone}` : "WhatsApp not set"}</span>
              <span className={`team-availability-pill ${member.availabilityTone}`}>{member.availabilityLabel}</span>
            </div>
            <div className="team-member-controls">
              <label className="contact-assignment-label">
                <span>Role</span>
                <select
                  className="lead-record-input app-select contact-assignment-select"
                  value={drafts[member.id]?.role ?? member.role}
                  disabled={isPending}
                  onChange={(event) => updateDraft(member.id, { role: event.target.value })}
                >
                  <option value="AGENT">Agent</option>
                  <option value="MANAGER">Manager</option>
                </select>
              </label>
              <label className="contact-assignment-label">
                <span>Status</span>
                <select
                  className="lead-record-input app-select contact-assignment-select"
                  value={drafts[member.id]?.status ?? member.status}
                  disabled={isPending}
                  onChange={(event) => updateDraft(member.id, { status: event.target.value })}
                >
                  <option value="ACTIVE">Active</option>
                  <option value="AWAY">Away</option>
                </select>
              </label>
              <label className="contact-assignment-label">
                <span>WhatsApp</span>
                <input
                  className="lead-record-input contact-assignment-select"
                  disabled={isPending}
                  onChange={(event) => updateDraft(member.id, { phone: event.target.value })}
                  placeholder="+60123456789"
                  value={drafts[member.id]?.phone ?? member.phone ?? ""}
                />
              </label>
            </div>
            <div className="team-member-actions">
              <button
                className="inbox-search-tool team-member-save"
                disabled={
                  isPending ||
                  ((drafts[member.id]?.role ?? member.role) === member.role &&
                    (drafts[member.id]?.status ?? member.status) === member.status &&
                    (drafts[member.id]?.phone ?? member.phone ?? "") === (member.phone ?? ""))
                }
                onClick={() => saveMember(member)}
                type="button"
              >
                Save
              </button>
              <button
                className="inbox-search-tool product-delete-button team-member-remove"
                disabled={isPending || member.isCurrentManager}
                onClick={() => removeMember(member)}
                type="button"
              >
                Remove
              </button>
            </div>
            <span className="table-subtle">
              {member.isCurrentManager ? "Current session" : `Current: ${member.role} | ${member.status}`}
            </span>
          </article>
        ))}
      </div>
    </section>
  );
}
