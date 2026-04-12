"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type ContactSummary = {
  id: string;
  displayName: string;
  displayNameManualOverride: boolean;
  phone: string;
  email?: string | null;
  emailManualOverride: boolean;
  lastInteractionAt: string;
  lastMessagePreview: string;
  tags: string[];
  tagsManualOverride: boolean;
  isHotLead: boolean;
  ownerId: string | null;
  ownerName: string | null;
  notes: Array<{
    id: string;
    body: string;
    author: string;
    createdAt: string;
  }>;
};

type ContactsDirectoryProps = {
  agents: Array<{
    id: string;
    name: string;
    role: string;
  }>;
  contacts: ContactSummary[];
  search: string;
};

export function ContactsDirectory({ agents, contacts, search }: ContactsDirectoryProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [contactDrafts, setContactDrafts] = useState<Record<string, EditableContactDraft>>({});
  const [openComposerId, setOpenComposerId] = useState<string | null>(null);
  const [openEditorId, setOpenEditorId] = useState<string | null>(null);

  const handleAssign = (contactId: string, ownerId: string) => {
    setError(null);
    startTransition(async () => {
      const response = await fetch(`/api/contacts/${contactId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          ownerId
        })
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(payload?.error ?? "Unable to update contact assignment.");
        return;
      }

      router.refresh();
    });
  };

  const handleSaveNote = (contactId: string) => {
    const body = drafts[contactId]?.trim() ?? "";

    if (!body) {
      setError("Note body is required.");
      return;
    }

    setError(null);
    startTransition(async () => {
      const response = await fetch(`/api/contacts/${contactId}/notes`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ body })
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(payload?.error ?? "Unable to save note.");
        return;
      }

      setDrafts((current) => ({ ...current, [contactId]: "" }));
      setOpenComposerId(null);
      router.refresh();
    });
  };

  const handleOpenEditor = (contact: ContactSummary) => {
    setError(null);
    setOpenEditorId((current) => (current === contact.id ? null : contact.id));
    setContactDrafts((current) => ({
      ...current,
      [contact.id]: current[contact.id] ?? createEditableContactDraft(contact)
    }));
  };

  const handleSaveContact = (contactId: string) => {
    const draft = contactDrafts[contactId];

    if (!draft?.displayName.trim()) {
      setError("Display name is required.");
      return;
    }

    setError(null);
    startTransition(async () => {
      const response = await fetch(`/api/contacts/${contactId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          displayName: draft.displayName.trim(),
          email: draft.email.trim(),
          tags: normalizeTagsInput(draft.tags)
        })
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(payload?.error ?? "Unable to update contact.");
        return;
      }

      setOpenEditorId(null);
      router.refresh();
    });
  };

  const handleResetContactField = (
    contactId: string,
    field: "displayName" | "email" | "tags"
  ) => {
    setError(null);
    startTransition(async () => {
      const response = await fetch(`/api/contacts/${contactId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          resetFields: [field]
        })
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(payload?.error ?? "Unable to reset contact field.");
        return;
      }

      router.refresh();
    });
  };

  return (
    <article className="table-card contacts-directory-card">
      <div className="card-header">
        <div>
          <h3 className="card-title">Contact list</h3>
          <p className="muted">Shared customer directory for support, follow-up, and sales handoff.</p>
        </div>
        <span className="product-catalog-count">
          {contacts.length} {contacts.length === 1 ? "contact" : "contacts"}
        </span>
      </div>

      <form action="/contacts" className="search-form contacts-directory-search">
        <input
          className="search-input"
          defaultValue={search}
          name="q"
          placeholder="Search contact, phone, or tag..."
          type="search"
        />
        <button className="button button-secondary" type="submit">
          Search
        </button>
      </form>

      {error ? <div className="form-error">{error}</div> : null}

      <div className="timeline-list">
        {contacts.length ? (
          contacts.map((contact) => {
            const initials = getContactInitials(contact.displayName);

            return (
              <article className="timeline-row contact-directory-row" key={contact.id}>
                <div className="contact-directory-main">
                  <div className="contact-directory-top">
                    <div className="contact-directory-identity">
                      <div className="contact-directory-avatar">{initials || "C"}</div>
                      <div className="contact-directory-copy">
                        <strong>{contact.displayName}</strong>
                        <span className="table-subtle">{contact.phone}</span>
                      </div>
                    </div>
                    <span className="timeline-time">{contact.lastInteractionAt}</span>
                  </div>

                  <p className="contact-directory-preview">{contact.lastMessagePreview}</p>

                  <div className="contact-directory-badges">
                    <span className="contact-owner-pill">{contact.ownerName ?? "Unassigned"}</span>
                    {contact.tags.map((tag) => (
                      <span className="lead-chip" key={tag}>
                        {tag}
                      </span>
                    ))}
                    {contact.isHotLead ? <span className="badge hot-badge">Hot lead</span> : null}
                  </div>
                </div>

                <div className="contact-assignment-panel">
                  <label className="contact-assignment-label">
                    <span>Assign contact</span>
                    <select
                      className="lead-record-input app-select contact-assignment-select"
                      defaultValue={contact.ownerId ?? ""}
                      disabled={isPending}
                      onChange={(event) => handleAssign(contact.id, event.target.value)}
                    >
                      <option value="">Unassigned</option>
                      {agents.map((agent) => (
                        <option key={agent.id} value={agent.id}>
                          {agent.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <span className="table-subtle contact-assignment-caption">
                    {contact.ownerName ? `Owned by ${contact.ownerName}` : "No owner assigned"}
                  </span>
                  <button
                    className="inbox-search-tool contact-note-toggle"
                    onClick={() =>
                      setOpenComposerId((current) => (current === contact.id ? null : contact.id))
                    }
                    type="button"
                  >
                    {openComposerId === contact.id ? "Hide note composer" : "Add note"}
                  </button>
                  <button
                    className="inbox-search-tool contact-note-toggle"
                    onClick={() => handleOpenEditor(contact)}
                    type="button"
                  >
                    {openEditorId === contact.id ? "Hide editor" : "Edit contact"}
                  </button>
                </div>

                {openEditorId === contact.id ? (
                  <div className="contact-note-composer contact-edit-composer">
                    <label className="contact-assignment-label">
                      <span>Display name</span>
                      <input
                        className="lead-record-input"
                        type="text"
                        value={contactDrafts[contact.id]?.displayName ?? contact.displayName}
                        onChange={(event) =>
                          setContactDrafts((current) => ({
                            ...current,
                            [contact.id]: {
                              ...createEditableContactDraft(contact),
                              ...current[contact.id],
                              displayName: event.target.value
                            }
                          }))
                        }
                      />
                      {contact.displayNameManualOverride ? (
                        <button
                          className="inbox-search-tool contact-field-reset"
                          disabled={isPending}
                          onClick={() => handleResetContactField(contact.id, "displayName")}
                          type="button"
                        >
                          Reset to WhatsApp
                        </button>
                      ) : null}
                    </label>
                    <label className="contact-assignment-label">
                      <span>Email</span>
                      <input
                        className="lead-record-input"
                        placeholder="name@example.com"
                        type="email"
                        value={contactDrafts[contact.id]?.email ?? contact.email ?? ""}
                        onChange={(event) =>
                          setContactDrafts((current) => ({
                            ...current,
                            [contact.id]: {
                              ...createEditableContactDraft(contact),
                              ...current[contact.id],
                              email: event.target.value
                            }
                          }))
                        }
                      />
                      {contact.emailManualOverride ? (
                        <button
                          className="inbox-search-tool contact-field-reset"
                          disabled={isPending}
                          onClick={() => handleResetContactField(contact.id, "email")}
                          type="button"
                        >
                          Reset email
                        </button>
                      ) : null}
                    </label>
                    <label className="contact-assignment-label">
                      <span>Tags</span>
                      <input
                        className="lead-record-input"
                        placeholder="whatsapp, priority, buyer"
                        type="text"
                        value={contactDrafts[contact.id]?.tags ?? contact.tags.join(", ")}
                        onChange={(event) =>
                          setContactDrafts((current) => ({
                            ...current,
                            [contact.id]: {
                              ...createEditableContactDraft(contact),
                              ...current[contact.id],
                              tags: event.target.value
                            }
                          }))
                        }
                      />
                      {contact.tagsManualOverride ? (
                        <button
                          className="inbox-search-tool contact-field-reset"
                          disabled={isPending}
                          onClick={() => handleResetContactField(contact.id, "tags")}
                          type="button"
                        >
                          Reset to WhatsApp
                        </button>
                      ) : null}
                    </label>
                    <div className="contact-note-actions">
                      <button
                        className="button button-secondary"
                        onClick={() => {
                          setOpenEditorId(null);
                          setContactDrafts((current) => {
                            const next = { ...current };
                            delete next[contact.id];
                            return next;
                          });
                        }}
                        type="button"
                      >
                        Cancel
                      </button>
                      <button
                        className="button button-primary"
                        disabled={isPending}
                        onClick={() => handleSaveContact(contact.id)}
                        type="button"
                      >
                        {isPending ? "Saving..." : "Save contact"}
                      </button>
                    </div>
                  </div>
                ) : null}

                {openComposerId === contact.id ? (
                  <div className="contact-note-composer">
                    <textarea
                      className="lead-record-input contact-note-textarea"
                      placeholder="Add internal context for this contact..."
                      rows={3}
                      value={drafts[contact.id] ?? ""}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [contact.id]: event.target.value
                        }))
                      }
                    />
                    <div className="contact-note-actions">
                      <button
                        className="button button-secondary"
                        onClick={() => {
                          setOpenComposerId(null);
                          setDrafts((current) => ({ ...current, [contact.id]: "" }));
                        }}
                        type="button"
                      >
                        Cancel
                      </button>
                      <button
                        className="button button-primary"
                        disabled={isPending}
                        onClick={() => handleSaveNote(contact.id)}
                        type="button"
                      >
                        {isPending ? "Saving..." : "Save note"}
                      </button>
                    </div>
                  </div>
                ) : null}

                {contact.notes.length ? (
                  <div className="contact-note-list">
                    {contact.notes.map((note) => (
                      <div className="contact-note-item" key={note.id}>
                        <div className="contact-note-meta">
                          <strong>{note.author}</strong>
                          <span>{note.createdAt}</span>
                        </div>
                        <p>{note.body}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="table-subtle contact-note-empty">No internal notes yet.</div>
                )}
              </article>
            );
          })
        ) : (
          <div className="lead-record-empty contact-directory-empty">
            No contacts yet. Add one from the left panel to start building your directory.
          </div>
        )}
      </div>
    </article>
  );
}

type EditableContactDraft = {
  displayName: string;
  email: string;
  tags: string;
};

function createEditableContactDraft(contact: ContactSummary): EditableContactDraft {
  return {
    displayName: contact.displayName,
    email: contact.email ?? "",
    tags: contact.tags.join(", ")
  };
}

function getContactInitials(displayName: string) {
  const parts = displayName
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  const initials = parts
    .map((part) => Array.from(part)[0] ?? "")
    .join("")
    .toUpperCase();

  return initials || "C";
}

function normalizeTagsInput(tags: string) {
  return tags
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean)
    .join(", ");
}
