"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useConfirmation } from "@/components/confirmation-provider";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/toast-provider";

export type CampaignListDraft = {
  id: string;
  name: string;
  messageBody: string;
  scheduleAt: string;
  selectedContactIds: string[];
  selectedAttachmentIds: string[];
  updatedAt: string;
  createdAt: string;
  createdByName: string | null;
};

type CampaignListProps = {
  drafts: CampaignListDraft[];
};

export function getCampaignDraftStatus(draft: Pick<CampaignListDraft, "scheduleAt">) {
  if (!draft.scheduleAt) {
    return "Draft";
  }

  return Date.parse(draft.scheduleAt) > Date.now() ? "Scheduled" : "Ready";
}

export function formatCampaignListTimestamp(value: string) {
  const timestamp = Date.parse(value);

  if (!Number.isFinite(timestamp)) {
    return "Not available";
  }

  return new Intl.DateTimeFormat("en-MY", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kuala_Lumpur"
  }).format(new Date(timestamp));
}

export function CampaignListTable({ drafts }: CampaignListProps) {
  if (!drafts.length) {
    return (
      <section className="content-card campaigns-list-card campaigns-list-empty">
        <div className="campaigns-list-empty-copy">
          <span className="auth-page-kicker">Campaign library</span>
          <h2>No campaigns yet</h2>
          <p>Create the first campaign draft to start building an audience, message, and launch plan.</p>
        </div>
        <div className="campaigns-list-empty-actions">
          <a className="button button-primary" href="/campaigns/new">
            Create New Campaign
          </a>
        </div>
      </section>
    );
  }

  return (
    <section className="content-card campaigns-list-card">
      <div className="campaigns-list-head">
        <div>
          <h3 className="card-title">Campaigns</h3>
          <p className="muted">Manage saved campaign drafts, reopen them for editing, or remove drafts you no longer need.</p>
        </div>
        <a className="button button-primary" href="/campaigns/new">
          Create New Campaign
        </a>
      </div>

      <div className="campaigns-list-table-shell">
        <table className="campaigns-list-table">
          <thead>
            <tr>
              <th scope="col">Campaign</th>
              <th scope="col">Status</th>
              <th scope="col">Created</th>
              <th scope="col">Updated</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {drafts.map((draft) => {
              const status = getCampaignDraftStatus(draft);

              return (
                <tr key={draft.id}>
                  <td>
                    <div className="campaigns-list-primary-cell">
                      <strong>{draft.name}</strong>
                      <span>
                        {draft.selectedContactIds.length} recipients ·{" "}
                        {draft.selectedAttachmentIds.length
                          ? `${draft.selectedAttachmentIds.length} media`
                          : "Text only"}
                      </span>
                      {draft.createdByName ? <span>Created by {draft.createdByName}</span> : null}
                    </div>
                  </td>
                  <td>
                    <span className="campaigns-list-status" data-status={status.toLowerCase()}>
                      <span aria-hidden="true" className="campaigns-list-status-dot" />
                      {status}
                    </span>
                  </td>
                  <td>{formatCampaignListTimestamp(draft.createdAt)}</td>
                  <td>{formatCampaignListTimestamp(draft.updatedAt)}</td>
                  <td>
                    <div className="campaigns-list-actions">
                      <a className="button button-secondary" href={`/campaigns/${draft.id}/edit`}>
                        Edit
                      </a>
                      <Button
                        aria-label={`Delete ${draft.name}`}
                        className="campaigns-list-delete-button"
                        data-campaign-delete={draft.id}
                        variant="danger"
                      >
                        Delete
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function CampaignList({ drafts }: CampaignListProps) {
  const router = useRouter();
  const { confirm } = useConfirmation();
  const { error: showError, success } = useToast();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const deleteDraft = async (draft: CampaignListDraft) => {
    const accepted = await confirm({
      title: "Delete campaign?",
      description: `Delete ${draft.name} permanently? This campaign draft will no longer be available in the list.`,
      confirmLabel: "Delete campaign",
      tone: "danger"
    });

    if (!accepted) {
      return;
    }

    setDeletingId(draft.id);
    startTransition(async () => {
      try {
        const response = await fetch(`/api/campaigns/${draft.id}`, {
          method: "DELETE"
        });
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;

        if (!response.ok) {
          showError("Delete failed", payload?.error ?? "Unable to delete this campaign.");
          return;
        }

        success("Campaign deleted", `${draft.name} was removed from the campaign list.`);
        router.refresh();
      } finally {
        setDeletingId((current) => (current === draft.id ? null : current));
      }
    });
  };

  if (!drafts.length) {
    return <CampaignListTable drafts={drafts} />;
  }

  return (
    <section className="content-card campaigns-list-card">
      <div className="campaigns-list-head">
        <div>
          <h3 className="card-title">Campaigns</h3>
          <p className="muted">Manage saved campaign drafts, reopen them for editing, or remove drafts you no longer need.</p>
        </div>
        <a className="button button-primary" href="/campaigns/new">
          Create New Campaign
        </a>
      </div>

      <div className="campaigns-list-table-shell">
        <table className="campaigns-list-table">
          <thead>
            <tr>
              <th scope="col">Campaign</th>
              <th scope="col">Status</th>
              <th scope="col">Created</th>
              <th scope="col">Updated</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {drafts.map((draft) => {
              const status = getCampaignDraftStatus(draft);
              const isDeleting = deletingId === draft.id && isPending;

              return (
                <tr key={draft.id}>
                  <td>
                    <div className="campaigns-list-primary-cell">
                      <strong>{draft.name}</strong>
                      <span>
                        {draft.selectedContactIds.length} recipients ·{" "}
                        {draft.selectedAttachmentIds.length
                          ? `${draft.selectedAttachmentIds.length} media`
                          : "Text only"}
                      </span>
                      {draft.createdByName ? <span>Created by {draft.createdByName}</span> : null}
                    </div>
                  </td>
                  <td>
                    <span className="campaigns-list-status" data-status={status.toLowerCase()}>
                      <span aria-hidden="true" className="campaigns-list-status-dot" />
                      {status}
                    </span>
                  </td>
                  <td>{formatCampaignListTimestamp(draft.createdAt)}</td>
                  <td>{formatCampaignListTimestamp(draft.updatedAt)}</td>
                  <td>
                    <div className="campaigns-list-actions">
                      <a className="button button-secondary" href={`/campaigns/${draft.id}/edit`}>
                        Edit
                      </a>
                      <Button
                        aria-label={`Delete ${draft.name}`}
                        className="campaigns-list-delete-button"
                        disabled={isDeleting}
                        onClick={() => void deleteDraft(draft)}
                        variant="danger"
                      >
                        {isDeleting ? "Deleting..." : "Delete"}
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
