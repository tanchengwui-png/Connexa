"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { useToast } from "@/components/toast-provider";
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

const CONTACT_IMPORT_ACCEPT = ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

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

type ContactImportSummary = {
  totalRows: number;
  readyRows: number;
  importedRows: number;
  skippedRows: number;
  failedRows: number;
  duplicateExistingRows: number;
  duplicateFileRows: number;
  duplicateBehavior: "skip" | "update";
};

export function ContactsDirectory({ agents, contacts, pagination, search }: ContactsDirectoryProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { success: showSuccessToast, error: showErrorToast } = useToast();
  const importFileInputRef = useRef<HTMLInputElement | null>(null);
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
  const [isExporting, setIsExporting] = useState(false);
  const [isDownloadingTemplate, setIsDownloadingTemplate] = useState(false);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [isImportDragging, setIsImportDragging] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [duplicateBehavior, setDuplicateBehavior] = useState<"skip" | "update">("skip");
  const [importSummary, setImportSummary] = useState<ContactImportSummary | null>(null);
  const [previewedFileSignature, setPreviewedFileSignature] = useState("");
  const [importStage, setImportStage] = useState<"idle" | "validating" | "ready" | "importing">("idle");
  const [importProgress, setImportProgress] = useState(0);
  const [isImportSubmitting, setIsImportSubmitting] = useState(false);
  const persistentFilterParams = buildPersistentContactFilterParams(searchParams);

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

  const closeImportDialog = (force = false) => {
    if (isImportSubmitting && !force) {
      return;
    }

    setIsImportDialogOpen(false);
    setIsImportDragging(false);
    setImportFile(null);
    setDuplicateBehavior("skip");
    setImportSummary(null);
    setPreviewedFileSignature("");
    setImportStage("idle");
    setImportProgress(0);
    if (importFileInputRef.current) {
      importFileInputRef.current.value = "";
    }
  };

  const applyImportFile = (file: File | null) => {
    setImportFile(file);
    setImportSummary(null);
    setPreviewedFileSignature("");
    setImportStage("idle");
    setImportProgress(0);
    setError(null);
  };

  const handleOpenImportDialog = () => {
    setError(null);
    setIsImportDialogOpen(true);
  };

  const handleExportContacts = async () => {
    if (isExporting) {
      return;
    }

    setError(null);
    setIsExporting(true);

    try {
      const params = new URLSearchParams(searchParams?.toString() ?? "");
      params.delete("page");
      params.delete("pageSize");

      const response = await fetch(`/api/contacts/export${params.toString() ? `?${params.toString()}` : ""}`, {
        method: "GET"
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "Unable to export contacts.");
      }

      const blob = await response.blob();
      const contentDisposition = response.headers.get("content-disposition") ?? "";
      const filenameMatch = contentDisposition.match(/filename="?([^";]+)"?/i);
      const filename = filenameMatch?.[1] ?? "contacts_export.xlsx";
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(downloadUrl);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to export contacts.");
    } finally {
      setIsExporting(false);
    }
  };

  const handleDownloadTemplate = async () => {
    if (isDownloadingTemplate) {
      return;
    }

    setError(null);
    setIsDownloadingTemplate(true);

    try {
      const response = await fetch("/api/contacts/import/template", {
        method: "GET"
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "Unable to download the import template.");
      }

      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = "contact_import_template.xlsx";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(downloadUrl);
    } catch (caughtError) {
      const message =
        caughtError instanceof Error ? caughtError.message : "Unable to download the import template.";
      setError(message);
      showErrorToast("Template download failed", message);
    } finally {
      setIsDownloadingTemplate(false);
    }
  };

  const handleValidateImport = async () => {
    if (!importFile || isImportSubmitting) {
      return;
    }

    const fileSignature = getImportFileSignature(importFile);
    if (fileSignature === previewedFileSignature && importSummary) {
      return;
    }

    setError(null);
    setIsImportSubmitting(true);
    setImportStage("validating");
    setImportProgress(6);

    try {
      const payload = (await sendContactImportRequest({
        file: importFile,
        mode: "preview",
        duplicateBehavior,
        onProgress: (ratio) => {
          setImportProgress(Math.min(55, Math.max(8, Math.round(ratio * 55))));
        }
      })) as { summary?: ContactImportSummary; error?: string };

      if (!payload.summary) {
        throw new Error(payload.error ?? "Unable to validate the contact import template.");
      }

      setImportSummary(payload.summary);
      setPreviewedFileSignature(fileSignature);
      setImportStage("ready");
      setImportProgress(100);
    } catch (caughtError) {
      const message =
        caughtError instanceof Error ? caughtError.message : "Unable to validate the contact import template.";
      setImportSummary(null);
      setPreviewedFileSignature("");
      setImportStage("idle");
      setImportProgress(0);
      setError(message);
      showErrorToast(message.includes("empty Name or Phone") ? message : "Import failed", message);
    } finally {
      setIsImportSubmitting(false);
    }
  };

  const handleImportContacts = async () => {
    if (!importFile || isImportSubmitting) {
      return;
    }

    setError(null);
    setIsImportSubmitting(true);
    setImportStage("importing");
    setImportProgress(10);

    try {
      const payload = (await sendContactImportRequest({
        file: importFile,
        mode: "import",
        duplicateBehavior,
        onProgress: (ratio) => {
          setImportProgress(Math.min(85, Math.max(12, Math.round(ratio * 85))));
        }
      })) as { summary?: ContactImportSummary; error?: string };

      if (!payload.summary) {
        throw new Error(payload.error ?? "Unable to import contacts.");
      }

      setImportSummary(payload.summary);
      setImportProgress(100);
      showSuccessToast(
        "Contacts imported successfully",
        `Total ${payload.summary.totalRows} · Imported ${payload.summary.importedRows} · Skipped ${payload.summary.skippedRows} · Failed ${payload.summary.failedRows}`
      );
      closeImportDialog(true);
      router.refresh();
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : "Unable to import contacts.";
      setImportStage("ready");
      setImportProgress(0);
      setError(message);
      showErrorToast(message.includes("empty Name or Phone") ? message : "Import failed", message);
    } finally {
      setIsImportSubmitting(false);
    }
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

  const hotLeadCount = contactList.filter((contact) => contact.isHotLead).length;
  const assignedContactCount = contactList.filter((contact) => contact.ownerId).length;
  const hasContacts = contactList.length > 0;

  return (
    <section className="contacts-directory-shell">
      <section className="contacts-directory-hero">
        <div className="contacts-directory-hero-copy">
          <span className="contacts-directory-kicker">Customer directory</span>
          <h2>Contacts</h2>
          <p>Keep contact details, ownership, notes, and follow-up context in one clean operating view.</p>
          <div className="contacts-directory-hero-metrics">
            <span className="contacts-directory-hero-stat">
              <strong>{pagination.total}</strong>
              <small>{pagination.total === 1 ? "total contact" : "total contacts"}</small>
            </span>
            <span className="contacts-directory-hero-stat">
              <strong>{hotLeadCount}</strong>
              <small>{hotLeadCount === 1 ? "hot lead" : "hot leads"}</small>
            </span>
            <span className="contacts-directory-hero-stat">
              <strong>{assignedContactCount}</strong>
              <small>assigned owners</small>
            </span>
          </div>
        </div>
        <div className="contacts-directory-hero-side">
          <div className="contacts-directory-hero-actions">
            <button
              className="button button-secondary"
              disabled={isDownloadingTemplate || isImportSubmitting}
              onClick={() => void handleDownloadTemplate()}
              type="button"
            >
              {isDownloadingTemplate ? "Preparing..." : "Download Template"}
            </button>
            <button
              className="button button-secondary"
              disabled={isImportSubmitting}
              onClick={handleOpenImportDialog}
              type="button"
            >
              Import Contacts
            </button>
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
          <div className="contacts-directory-hero-panel">
            <span className="contacts-directory-hero-panel-label">Directory status</span>
            <strong>
              Showing {pagination.pageCount} of {pagination.total}{" "}
              {pagination.total === 1 ? "contact" : "contacts"}
            </strong>
            <p>
              {search.trim()
                ? "Search filters are active. Clear them to return to the full directory."
                : "Import spreadsheets, assign ownership, and keep internal notes close to each contact."}
            </p>
          </div>
        </div>
      </section>

      <article className="table-card contacts-directory-card">
        <div className="card-header">
          <div>
            <h3 className="card-title">Directory view</h3>
            <p className="muted">Search, edit, and route your customer records from one workspace.</p>
          </div>
          <div className="contacts-directory-toolbar">
            <span className="product-catalog-count">
              Page {pagination.page} of {pagination.totalPages}
            </span>
            <span className="product-catalog-count">
              {pagination.pageSize} rows per page
            </span>
          </div>
        </div>

        <form action="/contacts" className="search-form contacts-directory-search">
        {persistentFilterParams.map(([key, value]) => (
          <input key={`search-${key}-${value}`} name={key} type="hidden" value={value} />
        ))}
        <input
          className="search-input"
          defaultValue={search}
          name="q"
          placeholder="Search contact, phone, tag, or owner..."
          type="search"
        />
        <input name="page" type="hidden" value="1" />
        <input name="pageSize" type="hidden" value={String(pagination.pageSize)} />
        <button className="button button-secondary" type="submit">
          Search
        </button>
        <button
          className="button button-secondary"
          disabled={isExporting}
          onClick={() => void handleExportContacts()}
          type="button"
        >
          {isExporting ? "Exporting..." : "Export Contacts"}
        </button>
        </form>

        <div className="contacts-directory-toolbar contacts-directory-toolbar-secondary">
          <span className="table-subtle">
            Showing up to {pagination.pageSize} contacts per page. Adjust the list density below.
          </span>
          <form action="/contacts" className="contacts-pagination-form">
          {persistentFilterParams.map(([key, value]) => (
            <input key={`paginate-${key}-${value}`} name={key} type="hidden" value={value} />
          ))}
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
          {hasContacts ? (
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
                    <span
                      className={`contact-owner-pill${contact.ownerId ? " is-assigned" : " is-unassigned"}`}
                      style={contact.ownerId ? getOwnerPillStyle(contact.ownerId) : undefined}
                    >
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
                      <span className={getContactTagClassName(tag)} key={tag}>
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
              <div className="contact-directory-empty-illustration" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
              <strong>No contacts yet</strong>
              <p>Add your first contact manually or import a spreadsheet to start building the shared directory.</p>
              <div className="contact-directory-empty-actions">
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
                <button
                  className="button button-secondary"
                  disabled={isImportSubmitting}
                  onClick={handleOpenImportDialog}
                  type="button"
                >
                  Import Contacts
                </button>
              </div>
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
              pageSize: pagination.pageSize,
              filters: persistentFilterParams
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
                  pageSize: pagination.pageSize,
                  filters: persistentFilterParams
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
              pageSize: pagination.pageSize,
              filters: persistentFilterParams
            })}
          >
            Next
          </a>
          </div>
        ) : null}
      </article>

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

      {isImportDialogOpen ? (
        <div className="inbox-dialog-backdrop" onClick={() => closeImportDialog()}>
          <div
            aria-modal="true"
            className="inbox-dialog contact-dialog"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="inbox-dialog-head">
              <div>
                <strong>Import contacts</strong>
                <p>Upload the Excel template, validate the rows, then import everything into this workspace.</p>
              </div>
              <button className="inbox-dialog-close" onClick={() => closeImportDialog()} type="button">
                ×
              </button>
            </div>

            <div className="contact-import-progress-card">
              <div className="contact-import-progress-copy">
                <span>{describeImportStage(importStage)}</span>
                <strong>
                  {importSummary
                    ? `Ready ${importSummary.readyRows} of ${importSummary.totalRows} rows`
                    : importFile
                      ? importFile.name
                      : "Use the provided template to keep the column format correct."}
                </strong>
                <p>
                  {importSummary
                    ? `Imported ${importSummary.importedRows} · Skipped ${importSummary.skippedRows} · Failed ${importSummary.failedRows}`
                    : "Required columns: Name and Phone. Tags can contain multiple comma-separated values."}
                </p>
              </div>
              <div className="contact-import-progress-track" aria-hidden="true">
                <div style={{ width: `${importProgress}%` }} />
              </div>
            </div>

            <div className="contact-import-actions">
              <button
                className="button button-secondary"
                disabled={isDownloadingTemplate || isImportSubmitting}
                onClick={() => void handleDownloadTemplate()}
                type="button"
              >
                {isDownloadingTemplate ? "Preparing..." : "Download Template"}
              </button>
              <label className="contact-import-duplicate-label">
                <span>Duplicates</span>
                <select
                  className="inbox-dialog-input app-select"
                  disabled={isImportSubmitting}
                  onChange={(event) => {
                    const nextBehavior = event.target.value === "update" ? "update" : "skip";
                    setDuplicateBehavior(nextBehavior);
                    setImportSummary(null);
                    setPreviewedFileSignature("");
                    setImportStage("idle");
                    setImportProgress(0);
                  }}
                  value={duplicateBehavior}
                >
                  <option value="skip">Skip existing contacts</option>
                  <option value="update">Update existing contacts</option>
                </select>
              </label>
            </div>

            <div
              className={`contact-import-dropzone${isImportDragging ? " dragging" : ""}${importFile ? " filled" : ""}`}
              onClick={() => importFileInputRef.current?.click()}
              onDragEnter={(event) => {
                event.preventDefault();
                setIsImportDragging(true);
              }}
              onDragLeave={(event) => {
                event.preventDefault();
                if (event.currentTarget === event.target) {
                  setIsImportDragging(false);
                }
              }}
              onDragOver={(event) => {
                event.preventDefault();
                setIsImportDragging(true);
              }}
              onDrop={(event) => {
                event.preventDefault();
                setIsImportDragging(false);
                applyImportFile(event.dataTransfer.files[0] ?? null);
              }}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  importFileInputRef.current?.click();
                }
              }}
            >
              <input
                accept={CONTACT_IMPORT_ACCEPT}
                hidden
                onChange={(event) => applyImportFile(event.target.files?.[0] ?? null)}
                ref={importFileInputRef}
                type="file"
              />
              <strong>{importFile ? importFile.name : "Drag and drop your completed template here"}</strong>
              <p>
                {importFile
                  ? `${Math.max(1, Math.round(importFile.size / 1024))} KB selected`
                  : "Only .xlsx files generated from the template are accepted."}
              </p>
            </div>

            {importSummary ? (
              <div className="contact-import-summary-grid">
                <div className="settings-dark-status-card">
                  <span>Total rows</span>
                  <strong>{importSummary.totalRows}</strong>
                </div>
                <div className="settings-dark-status-card">
                  <span>Ready</span>
                  <strong>{importSummary.readyRows}</strong>
                </div>
                <div className="settings-dark-status-card">
                  <span>Skipped</span>
                  <strong>{importSummary.skippedRows}</strong>
                </div>
                <div className="settings-dark-status-card">
                  <span>Failed</span>
                  <strong>{importSummary.failedRows}</strong>
                </div>
              </div>
            ) : null}

            {importSummary ? (
              <div className="contact-import-callout">
                <strong>Import summary</strong>
                <p>
                  Total rows {importSummary.totalRows} · Imported {importSummary.importedRows} · Ready{" "}
                  {importSummary.readyRows} · Skipped {importSummary.skippedRows} · Failed {importSummary.failedRows}
                </p>
                <p>
                  Duplicate in workspace {importSummary.duplicateExistingRows} · Duplicate in file{" "}
                  {importSummary.duplicateFileRows}
                </p>
              </div>
            ) : null}

            {error ? <div className="form-error contact-dialog-error">{error}</div> : null}

            <div className="inbox-dialog-actions">
              <button className="inbox-dialog-secondary" disabled={isImportSubmitting} onClick={() => closeImportDialog()} type="button">
                Cancel
              </button>
              <button
                className="inbox-dialog-secondary"
                disabled={
                  !importFile ||
                  isImportSubmitting ||
                  (previewedFileSignature === getImportFileSignature(importFile) && importSummary !== null)
                }
                onClick={() => void handleValidateImport()}
                type="button"
              >
                {isImportSubmitting && importStage === "validating" ? (
                  <span className="contact-import-button-copy">
                    <span className="contact-import-spinner" aria-hidden="true" />
                    Validating...
                  </span>
                ) : (
                  "Validate template"
                )}
              </button>
              <button
                className="inbox-dialog-primary"
                disabled={!importFile || !importSummary || isImportSubmitting || importSummary.readyRows < 1}
                onClick={() => void handleImportContacts()}
                type="button"
              >
                {isImportSubmitting && importStage === "importing" ? (
                  <span className="contact-import-button-copy">
                    <span className="contact-import-spinner" aria-hidden="true" />
                    Importing...
                  </span>
                ) : (
                  "Import contacts"
                )}
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
    </section>
  );
}

function getOwnerPillStyle(ownerId: string) {
  const hue = Array.from(ownerId).reduce((total, character) => total + character.charCodeAt(0), 0) % 360;

  return {
    borderColor: `hsla(${hue}, 85%, 72%, 0.32)`,
    color: `hsl(${hue}, 92%, 88%)`,
    background: `hsla(${hue}, 72%, 22%, 0.34)`
  };
}

function getContactTagClassName(tag: string) {
  const normalized = tag.trim().toLowerCase();

  if (normalized === "whatsapp") {
    return "lead-chip contact-tag-chip contact-tag-chip-whatsapp";
  }

  if (normalized === "hot lead" || normalized === "hot") {
    return "lead-chip contact-tag-chip contact-tag-chip-hot";
  }

  return "lead-chip contact-tag-chip";
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

function getImportFileSignature(file: File) {
  return [file.name, file.size, file.lastModified].join(":");
}

function describeImportStage(stage: "idle" | "validating" | "ready" | "importing") {
  if (stage === "validating") {
    return "Validating template";
  }

  if (stage === "ready") {
    return "Import summary";
  }

  if (stage === "importing") {
    return "Importing contacts";
  }

  return "Upload template";
}

function sendContactImportRequest(input: {
  file: File;
  mode: "preview" | "import";
  duplicateBehavior: "skip" | "update";
  onProgress?: (ratio: number) => void;
}) {
  return new Promise<unknown>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/contacts/import");
    xhr.responseType = "json";

    xhr.upload.onprogress = (event) => {
      if (!input.onProgress || !event.lengthComputable) {
        return;
      }

      input.onProgress(event.total > 0 ? event.loaded / event.total : 0);
    };

    xhr.onerror = () => {
      reject(new Error("Unable to upload the contact import file."));
    };

    xhr.onload = () => {
      const payload =
        typeof xhr.response === "object" && xhr.response !== null
          ? xhr.response
          : safeParseJson(xhr.responseText);

      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(payload);
        return;
      }

      const message =
        payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
          ? payload.error
          : "Unable to process the contact import file.";
      reject(new Error(message));
    };

    const formData = new FormData();
    formData.append("file", input.file);
    formData.append("mode", input.mode);
    formData.append("duplicateBehavior", input.duplicateBehavior);
    xhr.send(formData);
  });
}

function safeParseJson(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function buildContactsPageHref(input: { search: string; page: number; pageSize: number; filters?: Array<[string, string]> }) {
  const params = new URLSearchParams();
  input.filters?.forEach(([key, value]) => {
    params.append(key, value);
  });
  if (input.search.trim()) {
    params.set("q", input.search.trim());
  }
  params.set("page", String(input.page));
  params.set("pageSize", String(input.pageSize));
  return `/contacts?${params.toString()}`;
}

function buildPersistentContactFilterParams(searchParams: ReturnType<typeof useSearchParams>) {
  if (!searchParams) {
    return [] as Array<[string, string]>;
  }

  const persistentKeys = new Set(["tags", "tag", "ownerId", "ownerIds", "assignee", "assigneeIds"]);
  const values: Array<[string, string]> = [];

  persistentKeys.forEach((key) => {
    searchParams.getAll(key).forEach((value) => {
      const normalized = value.trim();
      if (normalized) {
        values.push([key, normalized]);
      }
    });
  });

  return values;
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
