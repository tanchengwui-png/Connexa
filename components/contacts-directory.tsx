"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { parseContactPasteBlock } from "@/lib/contact-paste-parser";
import { validateContactAddress } from "@/lib/contact-address";

const DEFAULT_COUNTRY_CODE = "60";
const COMMON_COUNTRY_CODES = [
  { code: "65", label: "Singapore (+65)" },
  { code: "66", label: "Thailand (+66)" },
  { code: "62", label: "Indonesia (+62)" },
  { code: "63", label: "Philippines (+63)" },
  { code: "1", label: "United States / Canada (+1)" },
  { code: "44", label: "United Kingdom (+44)" },
  { code: "61", label: "Australia (+61)" },
  { code: "971", label: "UAE (+971)" }
];

const EMPTY_CREATE_FORM = {
  displayName: "",
  email: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  state: "",
  postalCode: "",
  country: "",
  tags: "",
  phoneNumber: ""
};

type ContactSummary = {
  id: string;
  displayName: string;
  displayNameManualOverride: boolean;
  phone: string;
  photoUrl?: string | null;
  email?: string | null;
  emailManualOverride: boolean;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
  lastInteractionAt: string;
  lastMessagePreview: string;
  tags: string[];
  tagsManualOverride: boolean;
  isHotLead: boolean;
  ownerId: string | null;
  ownerName: string | null;
  teammateIds: string[];
  teammates: Array<{
    id: string;
    name: string;
  }>;
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
  pagination: {
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
    pageCount: number;
  };
  search: string;
};

export function ContactsDirectory({ agents, contacts, pagination, search }: ContactsDirectoryProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [contactDrafts, setContactDrafts] = useState<Record<string, EditableContactDraft>>({});
  const [contactList, setContactList] = useState(contacts);
  const [openComposerId, setOpenComposerId] = useState<string | null>(null);
  const [openEditorId, setOpenEditorId] = useState<string | null>(null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [createForm, setCreateForm] = useState(EMPTY_CREATE_FORM);
  const [pasteBlock, setPasteBlock] = useState("");
  const [isInternational, setIsInternational] = useState(false);
  const [countryCode, setCountryCode] = useState(DEFAULT_COUNTRY_CODE);
  const [ownerId, setOwnerId] = useState("");
  const [teammateIds, setTeammateIds] = useState<string[]>([]);

  useEffect(() => {
    setContactList(contacts);
  }, [contacts]);

  const closeCreateDialog = () => {
    setIsCreateDialogOpen(false);
    setCreateForm(EMPTY_CREATE_FORM);
    setPasteBlock("");
    setIsInternational(false);
    setCountryCode(DEFAULT_COUNTRY_CODE);
    setOwnerId("");
    setTeammateIds([]);
  };

  const handleAutofillPastedContact = () => {
    if (!pasteBlock.trim()) {
      setError("Paste the contact block first.");
      return;
    }

    const parsed = parseContactPasteBlock(pasteBlock);
    setCreateForm((current) => ({
      ...current,
      displayName: parsed.displayName || current.displayName,
      email: parsed.email || current.email,
      addressLine1: parsed.addressLine1 || current.addressLine1,
      addressLine2: parsed.addressLine2 || current.addressLine2,
      city: parsed.city || current.city,
      state: parsed.state || current.state,
      postalCode: parsed.postalCode || current.postalCode,
      country: parsed.country || current.country,
      phoneNumber: parsed.phoneNumber || current.phoneNumber
    }));
    setCountryCode(parsed.countryCode || DEFAULT_COUNTRY_CODE);
    setIsInternational(parsed.isInternational);
    setError(null);
  };

  const handleCreateContact = () => {
    if (!createForm.displayName.trim()) {
      setError("Contact name is required.");
      return;
    }

    if (!createForm.phoneNumber.trim()) {
      setError("Phone number is required.");
      return;
    }

    if (!(countryCode || DEFAULT_COUNTRY_CODE).trim()) {
      setError("Country code is required.");
      return;
    }

    const { error: addressError } = validateContactAddress({
      addressLine1: createForm.addressLine1,
      addressLine2: createForm.addressLine2,
      city: createForm.city,
      state: createForm.state,
      postalCode: createForm.postalCode,
      country: createForm.country
    });

    if (addressError) {
      setError(addressError);
      return;
    }

    setError(null);
    startTransition(async () => {
      const response = await fetch("/api/contacts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          displayName: createForm.displayName,
          email: createForm.email,
          addressLine1: createForm.addressLine1,
          addressLine2: createForm.addressLine2,
          city: createForm.city,
          state: createForm.state,
          postalCode: createForm.postalCode,
          country: createForm.country,
          tags: createForm.tags,
          ownerId,
          teammateIds,
          countryCode,
          phoneNumber: createForm.phoneNumber
        })
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(payload?.error ?? "Unable to create contact.");
        return;
      }

      closeCreateDialog();
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
    setOpenEditorId(contact.id);
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

    const { error: addressError } = validateContactAddress({
      addressLine1: draft.addressLine1,
      addressLine2: draft.addressLine2,
      city: draft.city,
      state: draft.state,
      postalCode: draft.postalCode,
      country: draft.country
    });

    if (addressError) {
      setError(addressError);
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
          ownerId: draft.ownerId,
          teammateIds: draft.teammateIds,
          displayName: draft.displayName.trim(),
          email: draft.email.trim(),
          addressLine1: draft.addressLine1.trim(),
          addressLine2: draft.addressLine2.trim(),
          city: draft.city.trim(),
          state: draft.state.trim(),
          postalCode: draft.postalCode.trim(),
          country: draft.country.trim(),
          tags: normalizeTagsInput(draft.tags)
        })
      });
      const payload = (await response.json().catch(() => null)) as
        | { error?: string; contact?: ContactUpdatePayload }
        | null;

      if (!response.ok) {
        setError(payload?.error ?? "Unable to update contact.");
        return;
      }

      if (payload?.contact) {
        applyUpdatedContact(payload.contact);
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
      const payload = (await response.json().catch(() => null)) as
        | { error?: string; contact?: ContactUpdatePayload }
        | null;

      if (!response.ok) {
        setError(payload?.error ?? "Unable to reset contact field.");
        return;
      }

      if (payload?.contact) {
        applyUpdatedContact(payload.contact);
      }
      router.refresh();
    });
  };

  const applyUpdatedContact = (updated: ContactUpdatePayload) => {
    setContactList((current) =>
      current.map((contact) =>
        contact.id === updated.id
          ? {
              ...contact,
              ownerId: updated.ownerId,
              ownerName: updated.ownerName,
              teammateIds: updated.teammateIds,
              teammates: updated.teammates,
              displayName: updated.displayName,
              displayNameManualOverride: updated.displayNameManualOverride,
              email: updated.email,
              emailManualOverride: updated.emailManualOverride,
              addressLine1: updated.addressLine1,
              addressLine2: updated.addressLine2,
              city: updated.city,
              state: updated.state,
              postalCode: updated.postalCode,
              country: updated.country,
              tags: updated.tags,
              tagsManualOverride: updated.tagsManualOverride
            }
          : contact
      )
    );

    setContactDrafts((current) => ({
      ...current,
      [updated.id]: {
        ownerId: updated.ownerId ?? "",
        teammateIds: updated.teammateIds,
        displayName: updated.displayName,
        email: updated.email ?? "",
        addressLine1: updated.addressLine1 ?? "",
        addressLine2: updated.addressLine2 ?? "",
        city: updated.city ?? "",
        state: updated.state ?? "",
        postalCode: updated.postalCode ?? "",
        country: updated.country ?? "",
        tags: updated.tags.join(", ")
      }
    }));
  };

  return (
    <article className="table-card contacts-directory-card">
      <div className="card-header">
        <div>
          <h3 className="card-title">Contact list</h3>
          <p className="muted">Shared customer directory for support, follow-up, and sales handoff.</p>
        </div>
        <div className="contacts-directory-toolbar">
          <span className="product-catalog-count">
            Showing {pagination.pageCount} of {pagination.total}{" "}
            {pagination.total === 1 ? "contact" : "contacts"}
          </span>
          <button
            className="button button-primary"
            onClick={() => {
              setError(null);
              setIsCreateDialogOpen(true);
            }}
            type="button"
          >
            Add contact
          </button>
        </div>
      </div>

      <form action="/contacts" className="search-form contacts-directory-search">
        <input
          className="search-input"
          defaultValue={search}
          name="q"
          placeholder="Search contact, phone, or tag..."
          type="search"
        />
        <input name="page" type="hidden" value="1" />
        <input name="pageSize" type="hidden" value={String(pagination.pageSize)} />
        <button className="button button-secondary" type="submit">
          Search
        </button>
      </form>

      <div className="contacts-directory-toolbar contacts-directory-toolbar-secondary">
        <span className="table-subtle">
          Page {pagination.page} of {pagination.totalPages}
        </span>
        <form action="/contacts" className="contacts-pagination-form">
          <input name="q" type="hidden" value={search} />
          <input name="page" type="hidden" value="1" />
          <label className="contacts-page-size-label">
            <span className="table-subtle">Rows</span>
            <select
              className="inbox-dialog-input app-select contacts-page-size-select"
              defaultValue={String(pagination.pageSize)}
              name="pageSize"
            >
              {[25, 50, 100].map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
          <button className="button button-secondary" type="submit">
            Apply
          </button>
        </form>
      </div>

      {error ? <div className="form-error">{error}</div> : null}

      <div className="timeline-list">
            {contactList.length ? (
          contactList.map((contact) => {
            const initials = getContactInitials(contact.displayName);

            return (
              <article className="timeline-row contact-directory-row" key={contact.id}>
                <div className="contact-directory-main">
                  <div className="contact-directory-top">
                    <div className="contact-directory-identity">
                      <div className="contact-directory-avatar">
                        {contact.photoUrl ? (
                          <img
                            alt={contact.displayName}
                            className="contact-directory-avatar-image"
                            src={`/api/contacts/${contact.id}/avatar`}
                          />
                        ) : (
                          initials || "C"
                        )}
                      </div>
                      <div className="contact-directory-copy">
                        <div className="contact-directory-headline">
                          <strong>{contact.displayName}</strong>
                          {contact.isHotLead ? <span className="badge hot-badge">Hot lead</span> : null}
                        </div>
                        <div className="contact-directory-meta-line">
                          <span className="table-subtle">{contact.phone}</span>
                          {contact.email ? (
                            <>
                              <span className="contact-directory-meta-dot" aria-hidden="true">
                                •
                              </span>
                              <span className="table-subtle">{contact.email}</span>
                            </>
                          ) : null}
                        </div>
                        {formatContactAddress(contact) ? (
                          <div className="contact-directory-meta-line">
                            <span className="table-subtle">{formatContactAddress(contact)}</span>
                          </div>
                        ) : null}
                      </div>
                    </div>
                    <div className="contact-directory-actions">
                      <div className="contact-directory-time-block">
                        <span className="contact-directory-time-label">Last activity</span>
                        <span className="timeline-time">{contact.lastInteractionAt}</span>
                      </div>
                      <div className="contact-directory-action-row">
                        <button
                          className="inbox-search-tool contact-note-toggle"
                          onClick={() =>
                            setOpenComposerId((current) => (current === contact.id ? null : contact.id))
                          }
                          type="button"
                        >
                          {openComposerId === contact.id ? "Close note" : "Add note"}
                        </button>
                        <button
                          className="inbox-search-tool contact-note-toggle"
                          onClick={() => handleOpenEditor(contact)}
                          type="button"
                        >
                          Edit
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="contact-directory-summary">
                    <span className="contact-directory-summary-label">Latest message</span>
                    <p className="contact-directory-preview">{contact.lastMessagePreview}</p>
                  </div>

                  <div className="contact-directory-badges">
                    <span className="contact-owner-pill">
                    <span className="contact-owner-pill-label">Owner</span>
                      <strong>{contact.ownerName ?? "Unassigned"}</strong>
                    </span>
                    {contact.teammates.length ? (
                      <span className="contact-owner-pill">
                        <span className="contact-owner-pill-label">Team</span>
                        <strong>{contact.teammates.map((teammate) => teammate.name).join(", ")}</strong>
                      </span>
                    ) : null}
                    {contact.tags.map((tag) => (
                      <span className="lead-chip" key={tag}>
                        {tag}
                      </span>
                    ))}
                    <span className="contact-notes-pill">
                      {contact.notes.length} {contact.notes.length === 1 ? "note" : "notes"}
                    </span>
                  </div>
                  {contact.notes[0] ? (
                    <div className="contact-note-inline">
                      <div className="contact-note-meta">
                        <strong>Latest note by {contact.notes[0].author}</strong>
                        <span>{contact.notes[0].createdAt}</span>
                      </div>
                      <p>{contact.notes[0].body}</p>
                    </div>
                  ) : null}
                </div>

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
              </article>
            );
          })
        ) : (
          <div className="lead-record-empty contact-directory-empty">
            No contacts yet. Add one to start building your directory.
          </div>
        )}
      </div>

      {pagination.totalPages > 1 ? (
        <div className="contacts-pagination">
          <a
            aria-disabled={pagination.page <= 1}
            className={`button button-secondary${pagination.page <= 1 ? " is-disabled" : ""}`}
            href={buildContactsPageHref({
              search,
              page: Math.max(1, pagination.page - 1),
              pageSize: pagination.pageSize
            })}
          >
            Previous
          </a>
          <div className="contacts-pagination-pages">
            {buildVisiblePageNumbers(pagination.page, pagination.totalPages).map((pageNumber) => (
              <a
                className={`button ${pageNumber === pagination.page ? "button-primary" : "button-secondary"}`}
                href={buildContactsPageHref({
                  search,
                  page: pageNumber,
                  pageSize: pagination.pageSize
                })}
                key={pageNumber}
              >
                {pageNumber}
              </a>
            ))}
          </div>
          <a
            aria-disabled={pagination.page >= pagination.totalPages}
            className={`button button-secondary${pagination.page >= pagination.totalPages ? " is-disabled" : ""}`}
            href={buildContactsPageHref({
              search,
              page: Math.min(pagination.totalPages, pagination.page + 1),
              pageSize: pagination.pageSize
            })}
          >
            Next
          </a>
        </div>
      ) : null}

      {isCreateDialogOpen ? (
        <div className="inbox-dialog-backdrop" onClick={closeCreateDialog}>
          <div
            aria-modal="true"
            className="inbox-dialog contact-dialog"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="inbox-dialog-head">
              <div>
                <strong>Add contact</strong>
                <p>Create a contact without leaving the directory view.</p>
              </div>
              <button className="inbox-dialog-close" onClick={closeCreateDialog} type="button">
                ×
              </button>
            </div>
            <div className="contact-dialog-grid">
              <label className="inbox-dialog-field contact-dialog-field-wide">
                <span>Paste full contact block</span>
                <textarea
                  className="inbox-dialog-input contact-paste-textarea"
                  onChange={(event) => setPasteBlock(event.target.value)}
                  placeholder={`Tan Ah Kow\n012-345 6789\nNo 12-3A, Jalan Ampang\nTaman Maju\n50450 Kuala Lumpur\nMalaysia`}
                  rows={6}
                  value={pasteBlock}
                />
                <div className="contacts-directory-toolbar">
                  <button className="button button-secondary" onClick={handleAutofillPastedContact} type="button">
                    Autofill from pasted text
                  </button>
                  <span className="table-subtle">
                    Malaysia-first parser. Review the fields before saving.
                  </span>
                </div>
              </label>
              <label className="inbox-dialog-field">
                <span>Contact name</span>
                <input
                  className="inbox-dialog-input"
                  value={createForm.displayName}
                  onChange={(event) =>
                    setCreateForm((current) => ({ ...current, displayName: event.target.value }))
                  }
                />
              </label>
              <label className="inbox-dialog-field">
                <span>Email</span>
                <input
                  className="inbox-dialog-input"
                  inputMode="email"
                  placeholder="Optional"
                  value={createForm.email}
                  onChange={(event) =>
                    setCreateForm((current) => ({ ...current, email: event.target.value }))
                  }
                />
              </label>
              <label className="inbox-dialog-field">
                <span>Primary owner</span>
                <select
                  className="inbox-dialog-input app-select"
                  onChange={(event) => {
                    const nextOwnerId = event.target.value;
                    setOwnerId(nextOwnerId);
                    setTeammateIds((current) => current.filter((teammateId) => teammateId !== nextOwnerId));
                  }}
                  value={ownerId}
                >
                  <option value="">Unassigned</option>
                  {agents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name} ({agent.role})
                    </option>
                  ))}
                </select>
              </label>
              <div className="inbox-dialog-field contact-dialog-field-wide">
                <span>Supporting teammates</span>
                <SupportingTeammatePicker
                  agents={agents}
                  ownerId={ownerId}
                  selectedIds={teammateIds}
                  onChange={setTeammateIds}
                />
              </div>
              <label className="inbox-dialog-field">
                <span>Phone number</span>
                <div className="contact-phone-input-shell">
                  <div className="contact-phone-prefix-cluster">
                    {isInternational ? (
                      <>
                        <span className="contact-phone-prefix-plus">+</span>
                        <input
                          className="contact-country-code-input"
                          inputMode="numeric"
                          list="contact-country-codes-dialog"
                          placeholder="Code"
                          value={countryCode}
                          onChange={(event) => setCountryCode(event.target.value.replace(/[^\d]/g, ""))}
                        />
                        <datalist id="contact-country-codes-dialog">
                          <option value={DEFAULT_COUNTRY_CODE}>Malaysia (+60)</option>
                          {COMMON_COUNTRY_CODES.map((option) => (
                            <option key={option.code} value={option.code}>
                              {option.label}
                            </option>
                          ))}
                        </datalist>
                      </>
                    ) : (
                      <button
                        className="contact-country-code-pill"
                        onClick={() => {
                          setIsInternational(true);
                          setCountryCode(DEFAULT_COUNTRY_CODE);
                        }}
                        type="button"
                      >
                        +60
                      </button>
                    )}
                  </div>
                  <input
                    className="inbox-dialog-input contact-phone-input"
                    inputMode="tel"
                    placeholder={isInternational ? "123456789" : "12 345 6789"}
                    value={createForm.phoneNumber}
                    onChange={(event) =>
                      setCreateForm((current) => ({
                        ...current,
                        phoneNumber: event.target.value.replace(/[^\d\s\-()]/g, "")
                      }))
                    }
                  />
                </div>
              </label>
              <label className="inbox-dialog-field contact-dialog-field-wide">
                <span>Tags</span>
                <input
                  className="inbox-dialog-input"
                  placeholder="Comma separated, for example buyer, vip"
                  value={createForm.tags}
                  onChange={(event) =>
                    setCreateForm((current) => ({ ...current, tags: event.target.value }))
                  }
                />
              </label>
              <label className="inbox-dialog-field contact-dialog-field-wide">
                <span>Address line 1</span>
                <input
                  className="inbox-dialog-input"
                  placeholder="Street address"
                  value={createForm.addressLine1}
                  onChange={(event) =>
                    setCreateForm((current) => ({ ...current, addressLine1: event.target.value }))
                  }
                />
              </label>
              <label className="inbox-dialog-field contact-dialog-field-wide">
                <span>Address line 2</span>
                <input
                  className="inbox-dialog-input"
                  placeholder="Unit, building, floor"
                  value={createForm.addressLine2}
                  onChange={(event) =>
                    setCreateForm((current) => ({ ...current, addressLine2: event.target.value }))
                  }
                />
              </label>
              <label className="inbox-dialog-field">
                <span>City</span>
                <input
                  className="inbox-dialog-input"
                  value={createForm.city}
                  onChange={(event) =>
                    setCreateForm((current) => ({ ...current, city: event.target.value }))
                  }
                />
              </label>
              <label className="inbox-dialog-field">
                <span>State</span>
                <input
                  className="inbox-dialog-input"
                  value={createForm.state}
                  onChange={(event) =>
                    setCreateForm((current) => ({ ...current, state: event.target.value }))
                  }
                />
              </label>
              <label className="inbox-dialog-field">
                <span>Postal code</span>
                <input
                  className="inbox-dialog-input"
                  value={createForm.postalCode}
                  onChange={(event) =>
                    setCreateForm((current) => ({ ...current, postalCode: event.target.value }))
                  }
                />
              </label>
              <label className="inbox-dialog-field">
                <span>Country</span>
                <input
                  className="inbox-dialog-input"
                  value={createForm.country}
                  onChange={(event) =>
                    setCreateForm((current) => ({ ...current, country: event.target.value }))
                  }
                />
              </label>
            </div>
            {error ? <div className="form-error contact-dialog-error">{error}</div> : null}
            <div className="inbox-dialog-actions">
              <button className="inbox-dialog-secondary" onClick={closeCreateDialog} type="button">
                Cancel
              </button>
              <button
                className="inbox-dialog-primary"
                disabled={isPending}
                onClick={handleCreateContact}
                type="button"
              >
                {isPending ? "Creating..." : "Create contact"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {openEditorId ? (
        <div
          className="inbox-dialog-backdrop"
          onClick={() => {
            setOpenEditorId(null);
          }}
        >
          <div
            aria-modal="true"
            className="inbox-dialog contact-dialog"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            {(() => {
              const contact = contactList.find((item) => item.id === openEditorId);
              if (!contact) {
                return null;
              }

              return (
                <>
                  <div className="inbox-dialog-head">
                    <div>
                      <strong>Edit contact</strong>
                      <p>Update saved contact details without leaving the directory view.</p>
                    </div>
                    <button className="inbox-dialog-close" onClick={() => setOpenEditorId(null)} type="button">
                      ×
                    </button>
                  </div>
                  <div className="contact-dialog-grid">
                    <label className="inbox-dialog-field">
                      <span>Primary owner</span>
                      <select
                        className="inbox-dialog-input app-select"
                        value={contactDrafts[contact.id]?.ownerId ?? contact.ownerId ?? ""}
                        onChange={(event) =>
                          setContactDrafts((current) => ({
                            ...current,
                            [contact.id]: {
                              ...createEditableContactDraft(contact),
                              ...current[contact.id],
                              ownerId: event.target.value,
                              teammateIds: (current[contact.id]?.teammateIds ?? contact.teammateIds).filter(
                                (teammateId) => teammateId !== event.target.value
                              )
                            }
                          }))
                        }
                      >
                        <option value="">Unassigned</option>
                        {agents.map((agent) => (
                          <option key={agent.id} value={agent.id}>
                            {agent.name} ({agent.role})
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="inbox-dialog-field contact-dialog-field-wide">
                      <span>Supporting teammates</span>
                      <SupportingTeammatePicker
                        agents={agents}
                        ownerId={contactDrafts[contact.id]?.ownerId ?? contact.ownerId ?? ""}
                        selectedIds={contactDrafts[contact.id]?.teammateIds ?? contact.teammateIds}
                        onChange={(nextTeammateIds) =>
                          setContactDrafts((current) => ({
                            ...current,
                            [contact.id]: {
                              ...createEditableContactDraft(contact),
                              ...current[contact.id],
                              teammateIds: nextTeammateIds
                            }
                          }))
                        }
                      />
                    </div>
                    <label className="inbox-dialog-field">
                      <span>Display name</span>
                      <input
                        className="inbox-dialog-input"
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
                    <label className="inbox-dialog-field">
                      <span>Email</span>
                      <input
                        className="inbox-dialog-input"
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
                    <label className="inbox-dialog-field contact-dialog-field-wide">
                      <span>Address line 1</span>
                      <input
                        className="inbox-dialog-input"
                        placeholder="Street address"
                        type="text"
                        value={contactDrafts[contact.id]?.addressLine1 ?? contact.addressLine1 ?? ""}
                        onChange={(event) =>
                          setContactDrafts((current) => ({
                            ...current,
                            [contact.id]: {
                              ...createEditableContactDraft(contact),
                              ...current[contact.id],
                              addressLine1: event.target.value
                            }
                          }))
                        }
                      />
                    </label>
                    <label className="inbox-dialog-field contact-dialog-field-wide">
                      <span>Address line 2</span>
                      <input
                        className="inbox-dialog-input"
                        placeholder="Unit, building, floor"
                        type="text"
                        value={contactDrafts[contact.id]?.addressLine2 ?? contact.addressLine2 ?? ""}
                        onChange={(event) =>
                          setContactDrafts((current) => ({
                            ...current,
                            [contact.id]: {
                              ...createEditableContactDraft(contact),
                              ...current[contact.id],
                              addressLine2: event.target.value
                            }
                          }))
                        }
                      />
                    </label>
                    <label className="inbox-dialog-field">
                      <span>City</span>
                      <input
                        className="inbox-dialog-input"
                        type="text"
                        value={contactDrafts[contact.id]?.city ?? contact.city ?? ""}
                        onChange={(event) =>
                          setContactDrafts((current) => ({
                            ...current,
                            [contact.id]: {
                              ...createEditableContactDraft(contact),
                              ...current[contact.id],
                              city: event.target.value
                            }
                          }))
                        }
                      />
                    </label>
                    <label className="inbox-dialog-field">
                      <span>State</span>
                      <input
                        className="inbox-dialog-input"
                        type="text"
                        value={contactDrafts[contact.id]?.state ?? contact.state ?? ""}
                        onChange={(event) =>
                          setContactDrafts((current) => ({
                            ...current,
                            [contact.id]: {
                              ...createEditableContactDraft(contact),
                              ...current[contact.id],
                              state: event.target.value
                            }
                          }))
                        }
                      />
                    </label>
                    <label className="inbox-dialog-field">
                      <span>Postal code</span>
                      <input
                        className="inbox-dialog-input"
                        type="text"
                        value={contactDrafts[contact.id]?.postalCode ?? contact.postalCode ?? ""}
                        onChange={(event) =>
                          setContactDrafts((current) => ({
                            ...current,
                            [contact.id]: {
                              ...createEditableContactDraft(contact),
                              ...current[contact.id],
                              postalCode: event.target.value
                            }
                          }))
                        }
                      />
                    </label>
                    <label className="inbox-dialog-field">
                      <span>Country</span>
                      <input
                        className="inbox-dialog-input"
                        type="text"
                        value={contactDrafts[contact.id]?.country ?? contact.country ?? ""}
                        onChange={(event) =>
                          setContactDrafts((current) => ({
                            ...current,
                            [contact.id]: {
                              ...createEditableContactDraft(contact),
                              ...current[contact.id],
                              country: event.target.value
                            }
                          }))
                        }
                      />
                    </label>
                    <label className="inbox-dialog-field contact-dialog-field-wide">
                      <span>Tags</span>
                      <input
                        className="inbox-dialog-input"
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
                  </div>
                  {error ? <div className="form-error contact-dialog-error">{error}</div> : null}
                  <div className="inbox-dialog-actions">
                    <button
                      className="inbox-dialog-secondary"
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
                      className="inbox-dialog-primary"
                      disabled={isPending}
                      onClick={() => handleSaveContact(contact.id)}
                      type="button"
                    >
                      {isPending ? "Saving..." : "Save contact"}
                    </button>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      ) : null}
    </article>
  );
}

function SupportingTeammatePicker({
  agents,
  ownerId,
  selectedIds,
  onChange
}: {
  agents: Array<{
    id: string;
    name: string;
    role: string;
  }>;
  ownerId: string;
  selectedIds: string[];
  onChange: (nextSelectedIds: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const selectedAgents = selectedIds
    .map((agentId) => agents.find((agent) => agent.id === agentId) ?? null)
    .filter((agent): agent is (typeof agents)[number] => Boolean(agent));
  const availableAgents = agents.filter((agent) => agent.id !== ownerId && !selectedIds.includes(agent.id));
  const normalizedQuery = query.trim().toLowerCase();
  const visibleAgents = availableAgents
    .filter((agent) => {
      if (!normalizedQuery) {
        return true;
      }

      return [agent.name, agent.role].join(" ").toLowerCase().includes(normalizedQuery);
    })
    .slice(0, 6);

  const addTeammate = (agentId: string) => {
    if (!agentId || selectedIds.includes(agentId) || agentId === ownerId) {
      return;
    }

    onChange([...selectedIds, agentId]);
    setQuery("");
  };

  return (
    <div className="contact-supporting-picker">
      <p className="contact-supporting-hint">
        Supporting teammates can assist with this contact, while the primary owner remains responsible.
      </p>

      <div className="contact-supporting-selected" aria-label="Selected supporting teammates">
        {selectedAgents.length ? (
          selectedAgents.map((agent) => (
            <span className="contact-supporting-pill" key={agent.id}>
              <span className="contact-supporting-pill-avatar">{getContactInitials(agent.name)}</span>
              <span className="contact-supporting-pill-copy">
                <strong>{agent.name}</strong>
                <span>{agent.role}</span>
              </span>
              <button
                aria-label={`Remove ${agent.name}`}
                className="contact-supporting-pill-remove"
                onClick={() => onChange(selectedIds.filter((agentId) => agentId !== agent.id))}
                type="button"
              >
                x
              </button>
            </span>
          ))
        ) : (
          <span className="contact-supporting-empty-pill">No supporting teammates</span>
        )}
      </div>

      <div className="contact-supporting-search">
        <input
          className="inbox-dialog-input"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search teammate to add"
          type="search"
          value={query}
        />
        {query.trim() ? (
          <div className="contact-supporting-options">
            {visibleAgents.length ? (
              visibleAgents.map((agent) => (
                <button
                  className="contact-supporting-option"
                  key={agent.id}
                  onClick={() => addTeammate(agent.id)}
                  type="button"
                >
                  <span className="contact-supporting-pill-avatar">{getContactInitials(agent.name)}</span>
                  <span>
                    <strong>{agent.name}</strong>
                    <small>{agent.role}</small>
                  </span>
                </button>
              ))
            ) : (
              <div className="contact-supporting-no-results">No available teammate matches.</div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

type EditableContactDraft = {
  ownerId: string;
  teammateIds: string[];
  displayName: string;
  email: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  tags: string;
};

type ContactUpdatePayload = {
  id: string;
  ownerId: string | null;
  ownerName: string | null;
  teammateIds: string[];
  teammates: Array<{
    id: string;
    name: string;
  }>;
  displayName: string;
  displayNameManualOverride: boolean;
  email: string | null;
  emailManualOverride: boolean;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  tags: string[];
  tagsManualOverride: boolean;
};

function createEditableContactDraft(contact: ContactSummary): EditableContactDraft {
  return {
    ownerId: contact.ownerId ?? "",
    teammateIds: contact.teammateIds,
    displayName: contact.displayName,
    email: contact.email ?? "",
    addressLine1: contact.addressLine1 ?? "",
    addressLine2: contact.addressLine2 ?? "",
    city: contact.city ?? "",
    state: contact.state ?? "",
    postalCode: contact.postalCode ?? "",
    country: contact.country ?? "",
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

function formatContactAddress(contact: {
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
}) {
  return [
    contact.addressLine1,
    contact.addressLine2,
    [contact.city, contact.state, contact.postalCode].filter(Boolean).join(" ").trim() || null,
    contact.country
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .join(", ");
}

function buildContactsPageHref(input: { search: string; page: number; pageSize: number }) {
  const params = new URLSearchParams();
  if (input.search.trim()) {
    params.set("q", input.search.trim());
  }
  params.set("page", String(input.page));
  params.set("pageSize", String(input.pageSize));
  return `/contacts?${params.toString()}`;
}

function buildVisiblePageNumbers(currentPage: number, totalPages: number) {
  const start = Math.max(1, currentPage - 2);
  const end = Math.min(totalPages, currentPage + 2);
  const pages: number[] = [];

  for (let page = start; page <= end; page += 1) {
    pages.push(page);
  }

  return pages;
}
