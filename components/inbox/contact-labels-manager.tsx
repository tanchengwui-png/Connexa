"use client";

import { useMemo, useState } from "react";
import type { InboxContactTag } from "@/components/inbox/types";
import { MetadataChip } from "@/components/inbox/metadata-chip";
import {
  buildCreateContactTagDraft,
  createAndApplyContactTag,
  DUPLICATE_CONTACT_TAG_MODAL_MESSAGE,
  findContactTagByName,
  normalizeContactTagName,
  sortContactTags
} from "@/lib/contact-tag-utils";

type ContactLabelsManagerProps = {
  availableTags: InboxContactTag[];
  selectedTags: string[];
  onAddTag: (tagName: string) => Promise<{ error?: string; ok: boolean }>;
  onCreateTag: (input: { description: string | null; name: string }) => Promise<{
    error?: string;
    ok: boolean;
    tag?: InboxContactTag;
  }>;
  onRemoveTag: (tagName: string) => void;
};

export function ContactLabelsManager({
  availableTags,
  selectedTags,
  onAddTag,
  onCreateTag,
  onRemoveTag
}: ContactLabelsManagerProps) {
  const [selectedExistingTagName, setSelectedExistingTagName] = useState("");
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [createForm, setCreateForm] = useState(() => buildCreateContactTagDraft(""));
  const [error, setError] = useState<string | null>(null);
  const [isAddPending, setIsAddPending] = useState(false);
  const [isCreatePending, setIsCreatePending] = useState(false);

  const sortedAvailableTags = useMemo(() => sortContactTags(availableTags), [availableTags]);
  const selectedExistingTag = useMemo(
    () => findContactTagByName(sortedAvailableTags, selectedExistingTagName),
    [selectedExistingTagName, sortedAvailableTags]
  );
  const canAddSelectedTag =
    Boolean(selectedExistingTag) &&
    !selectedTags.some((tag) => normalizeContactTagName(tag).toLowerCase() === selectedExistingTag!.name.toLowerCase());

  const openCreateDialog = () => {
    setCreateForm(buildCreateContactTagDraft(""));
    setError(null);
    setIsCreateDialogOpen(true);
  };

  const handleAddTag = async () => {
    if (!selectedExistingTag || !canAddSelectedTag) {
      return;
    }

    setError(null);
    setIsAddPending(true);

    const result = await onAddTag(selectedExistingTag.name);

    setIsAddPending(false);
    if (!result.ok) {
      setError(result.error ?? "Unable to add tag.");
      return;
    }

    setSelectedExistingTagName("");
  };

  const handleCreateTag = async () => {
    setError(null);
    setIsCreatePending(true);

    try {
      const result = await createAndApplyContactTag(
        {
          availableTags: sortedAvailableTags,
          currentTags: selectedTags,
          description: createForm.description,
          name: createForm.name
        },
        {
          createTag: async (input) => {
            const response = await onCreateTag(input);
            if (!response.ok || !response.tag) {
              throw new Error(response.error ?? "Unable to create tag.");
            }

            return response.tag;
          },
          applyTags: async (tags) => {
            const nextTag = tags[tags.length - 1];
            if (!nextTag) {
              return;
            }

            const response = await onAddTag(nextTag);
            if (!response.ok) {
              throw new Error(response.error ?? "Unable to apply tag.");
            }
          }
        }
      );

      if (!result.ok) {
        setError(result.error ?? DUPLICATE_CONTACT_TAG_MODAL_MESSAGE);
        setIsCreatePending(false);
        return;
      }

      setIsCreatePending(false);
      setIsCreateDialogOpen(false);
      setSelectedExistingTagName("");
    } catch (createError) {
      setIsCreatePending(false);
      setError(
        createError instanceof Error && createError.message
          ? createError.message
          : "Unable to create tag."
      );
    }
  };

  return (
    <>
      <div className="inbox-detail-chip-row">
        {selectedTags.length ? (
          selectedTags.map((tag) => (
            <MetadataChip key={tag} onRemove={() => onRemoveTag(tag)}>
              {tag}
            </MetadataChip>
          ))
        ) : (
          <span className="inbox-detail-placeholder">No tags applied yet.</span>
        )}
      </div>

      <div className="inbox-contact-tag-controls">
        <label className="inbox-contact-tag-field">
          <span className="inbox-contact-tag-label">Existing tags</span>
          <div className="inbox-contact-tag-row">
            <select
              className="lead-record-input app-select"
              onChange={(event) => {
                setSelectedExistingTagName(event.target.value);
                setError(null);
              }}
              value={selectedExistingTagName}
            >
              <option value="">Select a tag</option>
              {sortedAvailableTags.map((tag) => (
                <option key={tag.id} value={tag.name}>
                  {tag.name}
                </option>
              ))}
            </select>
            <button
              className="button button-primary compact-button"
              disabled={!canAddSelectedTag || isAddPending}
              onClick={() => void handleAddTag()}
              type="button"
            >
              {isAddPending ? "Adding..." : "Add"}
            </button>
          </div>
          {selectedExistingTag?.description ? (
            <p className="muted inbox-contact-tag-helper">{selectedExistingTag.description}</p>
          ) : null}
        </label>

        <button className="inbox-contact-tag-create-card" onClick={openCreateDialog} type="button">
          <strong>Create new tag</strong>
        </button>

        {error ? <p className="inbox-contact-tag-error">{error}</p> : null}
      </div>

      {isCreateDialogOpen ? (
        <CreateContactTagDialog
          description={createForm.description}
          error={error}
          isPending={isCreatePending}
          name={createForm.name}
          onCancel={() => {
            if (isCreatePending) {
              return;
            }

            setIsCreateDialogOpen(false);
            setError(null);
          }}
          onDescriptionChange={(value) => setCreateForm((current) => ({ ...current, description: value }))}
          onNameChange={(value) => setCreateForm((current) => ({ ...current, name: value }))}
          onSave={() => void handleCreateTag()}
        />
      ) : null}
    </>
  );
}

type CreateContactTagDialogProps = {
  description: string;
  error: string | null;
  isPending: boolean;
  name: string;
  onCancel: () => void;
  onDescriptionChange: (value: string) => void;
  onNameChange: (value: string) => void;
  onSave: () => void;
};

export function CreateContactTagDialog({
  description,
  error,
  isPending,
  name,
  onCancel,
  onDescriptionChange,
  onNameChange,
  onSave
}: CreateContactTagDialogProps) {
  return (
    <div className="inbox-dialog-backdrop" onClick={onCancel}>
      <div
        aria-label="Create contact tag"
        aria-modal="true"
        className="inbox-dialog confirmation-dialog inbox-contact-tag-dialog"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="inbox-dialog-head">
          <div>
            <strong>Create new tag</strong>
            <span>Save a reusable contact label for Inbox.</span>
          </div>
        </div>
        <div className="inbox-dialog-body">
          <label className="inbox-contact-tag-field">
            <span className="inbox-contact-tag-label">Tag Name</span>
            <input
              className="inbox-dialog-input"
              onChange={(event) => onNameChange(event.target.value)}
              placeholder="Priority"
              type="text"
              value={name}
            />
          </label>
          <label className="inbox-contact-tag-field">
            <span className="inbox-contact-tag-label">Description</span>
            <textarea
              className="inbox-dialog-input inbox-contact-tag-textarea"
              onChange={(event) => onDescriptionChange(event.target.value)}
              placeholder="Optional note for teammates"
              rows={4}
              value={description}
            />
          </label>
          {error ? <p className="inbox-contact-tag-error">{error}</p> : null}
        </div>
        <div className="inbox-dialog-actions">
          <div className="inbox-dialog-actions-right">
            <button className="inbox-dialog-secondary" disabled={isPending} onClick={onCancel} type="button">
              Cancel
            </button>
            <button
              className="inbox-dialog-primary"
              disabled={!normalizeContactTagName(name) || isPending}
              onClick={onSave}
              type="button"
            >
              {isPending ? "Saving..." : "Save & Create"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
