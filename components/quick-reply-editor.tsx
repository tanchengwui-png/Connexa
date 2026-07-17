"use client";

import { createPortal } from "react-dom";
import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useConfirmation } from "@/components/confirmation-provider";
import { FullEmojiPicker } from "@/components/full-emoji-picker";
import { EmojiIcon } from "@/components/inbox/icons";
import { INBOX_LAYERS } from "@/components/inbox/layers";
import { PortalDropdown } from "@/components/inbox/portal-dropdown";
import type { InboxMediaAsset } from "@/components/inbox/types";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/toast-provider";
import type { QuickReplyRecord } from "@/components/quick-reply-types";
import { UPLOAD_PROXY_LIMIT_ERROR } from "@/lib/inbox-upload";
import { MediaAssetSource } from "@/lib/db-types";
import { formatMediaAssetSize, getMediaAssetAccept, getMediaKindLabel } from "@/lib/media-library-shared";

type QuickReplyEditorProps = {
  categories: string[];
  mediaAssets: InboxMediaAsset[];
  quickReplies: QuickReplyRecord[];
  initialReply?: QuickReplyRecord | null;
  mode: "create" | "edit";
  redirectOnSaveTo?: string;
};

type ReplyFormState = {
  id: string | null;
  title: string;
  shortcut: string;
  category: string;
  body: string;
  mediaAssetIds: string[];
};

const EMPTY_FORM: ReplyFormState = {
  id: null,
  title: "",
  shortcut: "",
  category: "General",
  body: "",
  mediaAssetIds: []
};

const STARTER_TEMPLATES = [
  {
    category: "Lead Capture",
    description: "Simple first reply to start qualification.",
    title: "Buyer qualification",
    shortcut: "/buyer",
    body: "Thanks for reaching out. Are you looking to buy, rent, or sell a property? If buying, which area and budget range should I note for you?"
  },
  {
    category: "Viewing",
    description: "Confirms appointment and what happens next.",
    title: "Viewing confirmation",
    shortcut: "/viewing",
    body: "Your viewing is confirmed. I’ll send the exact location, access instructions, and contact person shortly before the appointment."
  },
  {
    category: "Pricing",
    description: "Guides the customer into a more useful pricing conversation.",
    title: "Pricing prompt",
    shortcut: "/price",
    body: "Please share the property name or preferred area and I’ll send the latest price range, layout, and availability for you."
  },
  {
    category: "Follow-up",
    description: "Soft re-engagement for leads who went quiet.",
    title: "Follow-up nudge",
    shortcut: "/followup",
    body: "Just checking in on your property search. If you're still looking, I can shortlist a few options based on your preferred area and budget."
  },
  {
    category: "Docs",
    description: "Useful when a buyer asks for formal materials.",
    title: "Brochure send",
    shortcut: "/brochure",
    body: "Sure. I can send the brochure, floor plan, and latest price list. Let me know the project name if you already have one in mind."
  }
] as const;

export function QuickReplyEditor({
  categories,
  mediaAssets,
  quickReplies,
  initialReply = null,
  mode,
  redirectOnSaveTo = "/quick-replies"
}: QuickReplyEditorProps) {
  const router = useRouter();
  const { confirm } = useConfirmation();
  const { success, error: showError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [assetList, setAssetList] = useState(mediaAssets);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<ReplyFormState>(
    initialReply
      ? {
          id: initialReply.id,
          title: initialReply.title,
          shortcut: initialReply.shortcut,
          category: initialReply.category,
          body: initialReply.body,
          mediaAssetIds: initialReply.mediaAssetIds
        }
      : EMPTY_FORM
  );
  const [isEmojiOpen, setIsEmojiOpen] = useState(false);
  const emojiButtonRef = useRef<HTMLButtonElement | null>(null);

  const starterTemplates = useMemo(() => {
    const usedShortcuts = new Set(quickReplies.map((item) => item.shortcut.toLowerCase()));
    return STARTER_TEMPLATES.filter((item) => !usedShortcuts.has(item.shortcut.toLowerCase()));
  }, [quickReplies]);

  const selectedReplyMetrics = useMemo(() => {
    const bodyLength = form.body.trim().length;

    return {
      bodyLength,
      mediaCount: form.mediaAssetIds.length,
      tone:
        bodyLength > 240
          ? "Long-form"
          : bodyLength > 90
            ? "Balanced"
            : bodyLength > 0
              ? "Short-form"
              : "Draft"
    };
  }, [form.body, form.mediaAssetIds.length]);

  const selectedMediaAssets = mapSelectedMediaAssets(assetList, form.mediaAssetIds);

  const createOrUpdateReply = async () => {
    setError(null);

    const accepted = await confirm({
      title: form.id ? "Save quick reply?" : "Create quick reply?",
      description: form.id
        ? `This will update ${form.title || "this quick reply"} in the shared library.`
        : `This will add ${form.title || "a new quick reply"} to the shared library.`,
      confirmLabel: form.id ? "Save reply" : "Create reply"
    });

    if (!accepted) {
      return;
    }

    startTransition(async () => {
      const response = await fetch(form.id ? `/api/quick-replies/${form.id}` : "/api/quick-replies", {
        method: form.id ? "PATCH" : "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(form)
      });

      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        const message = payload?.error ?? "Unable to save quick reply.";
        setError(message);
        showError("Quick reply not saved", message);
        return;
      }

      success(
        form.id ? "Quick reply updated" : "Quick reply created",
        `${form.title || "Quick reply"} is ready for the inbox.`
      );
      router.push(redirectOnSaveTo);
      router.refresh();
    });
  };

  const installStarterTemplate = async (template: (typeof STARTER_TEMPLATES)[number]) => {
    setError(null);

    startTransition(async () => {
      const response = await fetch("/api/quick-replies", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          ...template,
          mediaAssetIds: []
        })
      });

      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        const message = payload?.error ?? "Unable to install starter template.";
        setError(message);
        showError("Starter template not installed", message);
        return;
      }

      success("Starter template added", `${template.title} is now available in the shared library.`);
      router.refresh();
    });
  };

  const applyStarterTemplate = (template: (typeof STARTER_TEMPLATES)[number]) => {
    setForm((current) => ({
      id: current.id,
      title: template.title,
      shortcut: template.shortcut,
      category: template.category,
      body: template.body,
      mediaAssetIds: current.mediaAssetIds
    }));
    setError(null);
  };

  const title = mode === "edit" ? "Edit quick reply" : "Create quick reply";
  const description =
    mode === "edit"
      ? "Update the saved quick reply, preview the final message, and return to the list after saving."
      : "Create a new quick reply with message content, media, template samples, and preview controls.";

  return (
    <section className="quick-replies-editor-shell">
      <section className="auth-page-hero auth-page-hero-compact">
        <div className="auth-page-hero-copy">
          <span className="auth-page-kicker">Quick replies</span>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        <div className="auth-page-hero-side">
          <div className="auth-page-hero-actions">
            <a className="button button-secondary" href="/quick-replies">
              Cancel
            </a>
            <button className="button button-primary" disabled={isPending} onClick={() => void createOrUpdateReply()} type="button">
              {isPending ? "Saving..." : mode === "edit" ? "Save quick reply" : "Create quick reply"}
            </button>
          </div>
        </div>
      </section>

      <div className="quick-replies-editor-grid-layout">
        <article className="content-card quick-replies-editor-pane">
          <div className="card-header">
            <div>
              <h3 className="card-title">Create reply</h3>
              <p className="muted">Keep the editor focused on the title, shortcut, category, body, media, and preview.</p>
            </div>
            <div className="quick-replies-editor-summary">
              <span>{selectedReplyMetrics.tone}</span>
              <span>{selectedReplyMetrics.bodyLength} chars</span>
              <span>{selectedReplyMetrics.mediaCount} media</span>
            </div>
          </div>

          <div className="quick-replies-editor-workbench">
            <div className="quick-replies-editor-main">
              <div className="quick-replies-editor-grid">
                <label className="control-block">
                  <span className="control-label">Title</span>
                  <input
                    className="control-input"
                    onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                    placeholder="Viewing confirmation"
                    value={form.title}
                  />
                </label>

                <label className="control-block">
                  <span className="control-label">Shortcut</span>
                  <input
                    className="control-input"
                    onChange={(event) => setForm((current) => ({ ...current, shortcut: event.target.value }))}
                    placeholder="/viewing"
                    value={form.shortcut}
                  />
                </label>

                <label className="control-block full-span">
                  <span className="control-label">Category</span>
                  <select
                    className="control-input app-select"
                    onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))}
                    value={form.category}
                  >
                    {categories.map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="control-block full-span">
                  <span className="control-label">Reply body</span>
                  <textarea
                    className="composer-textarea quick-replies-editor-textarea"
                    onChange={(event) => setForm((current) => ({ ...current, body: event.target.value }))}
                    placeholder="Your viewing is confirmed for tomorrow at 3pm..."
                    rows={8}
                    value={form.body}
                  />
                  <div className="automation-emoji-toolbar">
                    <button
                      aria-label="Open emoji picker"
                      className="automation-emoji-icon-button"
                      onClick={() => setIsEmojiOpen((current) => !current)}
                      ref={emojiButtonRef}
                      type="button"
                    >
                      <EmojiIcon />
                    </button>
                  </div>
                </label>

                <label className="control-block full-span">
                  <span className="control-label">Add template</span>
                  <div className="quick-replies-starter-grid quick-replies-starter-grid-inline">
                    {starterTemplates.length ? (
                      starterTemplates.map((template) => (
                        <div className="quick-replies-starter-card" key={template.shortcut}>
                          <div className="quick-replies-starter-head">
                            <span className="lead-chip">{template.category}</span>
                            <strong>{template.title}</strong>
                          </div>
                          <p>{template.description}</p>
                          <div className="table-subtle">{template.body}</div>
                          <div className="quick-replies-starter-actions">
                            <Button onClick={() => applyStarterTemplate(template)} variant="secondary">
                              Use template
                            </Button>
                            <Button
                              className="compact-button"
                              disabled={isPending}
                              onClick={() => void installStarterTemplate(template)}
                              variant="outline"
                            >
                              Add template
                            </Button>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="lead-record-empty">All starter templates are already installed.</div>
                    )}
                  </div>
                </label>

                <label className="control-block full-span">
                  <span className="control-label">Reply media</span>
                  <QuickReplyMediaSelector
                    assets={assetList}
                    onAssetCreated={(asset) => setAssetList((current) => [...current, asset])}
                    onChange={(mediaAssetIds) => setForm((current) => ({ ...current, mediaAssetIds }))}
                    selectedIds={form.mediaAssetIds}
                  />
                </label>
              </div>
            </div>

            <aside className="quick-replies-editor-side">
              <div className="quick-replies-preview-card">
                <div className="quick-replies-preview-titlebar">
                  <span className="control-label">Template sample</span>
                  <div className="quick-replies-preview-summary">
                    <span>{countReplyLines(form.body) || 0} lines</span>
                    <span>{selectedReplyMetrics.bodyLength} chars</span>
                  </div>
                </div>
                <div className="quick-replies-preview-bubble">
                  <div className="quick-replies-preview-head">
                    <strong>{form.title || "Untitled reply"}</strong>
                    <div className="quick-replies-preview-meta">
                      <span>{form.shortcut || "/shortcut"}</span>
                      <span>{form.category}</span>
                    </div>
                  </div>
                  <p>{form.body || "Your saved reply preview will appear here."}</p>
                </div>
                {selectedMediaAssets.length ? (
                  <div className="automation-media-preview-list">
                    {selectedMediaAssets.map((asset) => (
                      <div className="automation-media-preview-card" key={asset.id}>
                        <div className="automation-media-preview-copy">
                          <strong>{asset.title}</strong>
                          <span>
                            {getMediaKindLabel(asset.kind, asset.mimeType)} · {asset.sizeLabel}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </aside>
          </div>

          <PortalDropdown
            align="start"
            anchorRef={emojiButtonRef}
            className="inbox-portal-menu"
            onClose={() => setIsEmojiOpen(false)}
            open={isEmojiOpen}
            side="top"
          >
            <FullEmojiPicker
              onEmojiSelect={(emoji) => setForm((current) => ({ ...current, body: `${current.body}${emoji}` }))}
            />
          </PortalDropdown>

          {error ? <div className="form-error">{error}</div> : null}
        </article>
      </div>
    </section>
  );
}

function QuickReplyMediaSelector({
  assets,
  selectedIds,
  onChange,
  onAssetCreated
}: {
  assets: InboxMediaAsset[];
  selectedIds: string[];
  onChange: (assetIds: string[]) => void;
  onAssetCreated: (asset: InboxMediaAsset) => void;
}) {
  const { success, error: showError } = useToast();
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<"all" | InboxMediaAsset["kind"]>("all");
  const [isManagerOpen, setIsManagerOpen] = useState(false);
  const [isUploading, startUploadTransition] = useTransition();
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const selectedSet = new Set(selectedIds);
  const selectedAssets = mapSelectedMediaAssets(assets, selectedIds);
  const visibleSelectedAssets = selectedAssets.slice(0, 4);
  const hiddenSelectedAssetsCount = Math.max(0, selectedAssets.length - visibleSelectedAssets.length);
  const availableAssets = assets.filter((asset) => !selectedSet.has(asset.id));
  const filteredAssets = availableAssets.filter((asset) => {
    if (kindFilter !== "all" && asset.kind !== kindFilter) {
      return false;
    }

    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return true;
    }

    return [asset.title, asset.kind, asset.mimeType].join(" ").toLowerCase().includes(normalizedQuery);
  });

  const uploadAsset = () => {
    if (!selectedFile) {
      setUploadError("Choose a file to upload.");
      return;
    }

    setUploadError(null);
    startUploadTransition(async () => {
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("sourceModule", MediaAssetSource.QUICK_REPLY);

      const response = await fetch("/api/media-library", {
        method: "POST",
        body: formData
      });
      const payload = (await response.json().catch(() => null)) as
        | {
            error?: string;
            asset?: {
              id: string;
              title: string;
              publicUrl: string;
              kind: InboxMediaAsset["kind"];
              mimeType: string;
              sizeBytes: number;
            };
          }
        | null;

      if (!response.ok || !payload?.asset) {
        const message = response.status === 413 ? UPLOAD_PROXY_LIMIT_ERROR : payload?.error ?? "Unable to upload media.";
        setUploadError(message);
        showError("Upload failed", message);
        return;
      }

      const nextAsset: InboxMediaAsset = {
        id: payload.asset.id,
        title: payload.asset.title,
        publicUrl: payload.asset.publicUrl,
        kind: payload.asset.kind,
        mimeType: payload.asset.mimeType,
        sizeLabel: formatMediaAssetSize(payload.asset.sizeBytes)
      };

      onAssetCreated(nextAsset);
      onChange([...selectedIds, nextAsset.id]);
      setSelectedFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      success("Media uploaded", `${nextAsset.title} is ready to attach.`);
    });
  };

  return (
    <>
      <div className="automation-media-summary-card">
        <div className="automation-media-summary-head">
          <div className="automation-media-summary-copy">
            <strong>{selectedAssets.length ? `${selectedAssets.length} media selected` : "No media selected"}</strong>
            <span>
              {selectedAssets.length
                ? selectedAssets.length > 4
                  ? `Showing 4 of ${selectedAssets.length}. The rest stay attached.`
                  : "Attached media follows the quick reply when operators use it."
                : "Upload or choose images, audio, and video using the same lightweight flow as automation."}
            </span>
          </div>
          <div className="automation-media-summary-actions">
            <button className="inbox-search-tool" onClick={() => setIsManagerOpen(true)} type="button">
              Add media
            </button>
            {selectedAssets.length ? (
              <button className="inbox-dialog-secondary" onClick={() => onChange([])} type="button">
                Clear
              </button>
            ) : null}
          </div>
        </div>
        {selectedAssets.length ? (
          <div className="inbox-attachment-row automation-media-summary-row">
            {visibleSelectedAssets.map((asset, index) => (
              <span className="inbox-attachment-chip" key={asset.id} title={asset.title}>
                <span>{`${index + 1}. ${asset.title} · ${getMediaKindLabel(asset.kind, asset.mimeType)}`}</span>
              </span>
            ))}
            {hiddenSelectedAssetsCount ? (
              <span className="inbox-attachment-chip inbox-attachment-chip-summary">
                <span>{`+${hiddenSelectedAssetsCount} more`}</span>
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
      {isManagerOpen
        ? createPortal(
            <div
              aria-hidden={!isManagerOpen}
              className="inbox-dialog-backdrop"
              onClick={() => setIsManagerOpen(false)}
              style={{ zIndex: INBOX_LAYERS.modal }}
            >
              <div
                aria-modal="true"
                className="inbox-dialog automation-media-dialog"
                onClick={(event) => event.stopPropagation()}
                role="dialog"
                style={{ zIndex: INBOX_LAYERS.modal + 1 }}
              >
                <div className="inbox-dialog-head">
                  <div>
                    <strong>Manage quick reply media</strong>
                    <p>Upload new media or choose from the library, then reorder the attached sequence here.</p>
                  </div>
                  <button aria-label="Close media manager" className="inbox-dialog-close" onClick={() => setIsManagerOpen(false)} type="button">
                    ×
                  </button>
                </div>
                <div className="inbox-dialog-body">
                  <div className="automation-media-selector-shell automation-media-selector-shell-dialog">
                    <div className="automation-media-selected-block">
                      <div className="automation-media-block-head">
                        <strong>Selected media</strong>
                        <span>
                          {selectedAssets.length
                            ? `${selectedAssets.length} item${selectedAssets.length === 1 ? "" : "s"}`
                            : "Nothing selected yet"}
                        </span>
                      </div>
                      {selectedAssets.length ? (
                        <div className="automation-media-selected-list">
                          {selectedAssets.map((asset, index) => (
                            <div className="automation-media-selected-item" key={asset.id}>
                              <div className="automation-media-selected-order">{index + 1}</div>
                              <div className="automation-media-selector-copy">
                                <strong>{asset.title}</strong>
                                <span>{getMediaKindLabel(asset.kind, asset.mimeType)} · {asset.sizeLabel}</span>
                              </div>
                              <div className="automation-media-selected-actions">
                                <button className="automation-media-sort-button" disabled={index === 0} onClick={() => onChange(moveItem(selectedIds, index, index - 1))} type="button">
                                  Up
                                </button>
                                <button className="automation-media-sort-button" disabled={index === selectedAssets.length - 1} onClick={() => onChange(moveItem(selectedIds, index, index + 1))} type="button">
                                  Down
                                </button>
                                <button className="automation-media-remove-button" onClick={() => onChange(selectedIds.filter((value) => value !== asset.id))} type="button">
                                  Remove
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="automation-media-selector-empty">Upload or choose assets on the right to build the send sequence.</div>
                      )}
                    </div>

                    <div className="automation-media-library-block">
                      <div className="automation-media-block-head">
                        <strong>Upload or choose from library</strong>
                        <span>Upload first, then search, filter, and add to the sequence</span>
                      </div>
                      <div className="quick-replies-media-upload">
                        <input
                          accept={getMediaAssetAccept()}
                          className="inbox-hidden-file-input"
                          onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
                          ref={fileInputRef}
                          type="file"
                        />
                        <div className="quick-replies-media-upload-row">
                          <button className="button button-secondary" onClick={() => fileInputRef.current?.click()} type="button">
                            Choose file
                          </button>
                          <button className="button button-primary" disabled={isUploading || !selectedFile} onClick={uploadAsset} type="button">
                            {isUploading ? "Uploading..." : "Upload media"}
                          </button>
                        </div>
                        {selectedFile ? (
                          <div className="quick-replies-media-upload-meta">
                            <strong>{selectedFile.name}</strong>
                            <span>{formatMediaAssetSize(selectedFile.size)}</span>
                          </div>
                        ) : (
                          <div className="quick-replies-media-upload-hint">Supported: image, audio, video, PDF</div>
                        )}
                        {uploadError ? <div className="form-error">{uploadError}</div> : null}
                      </div>
                      <div className="automation-media-library-toolbar">
                        <input className="lead-record-input" onChange={(event) => setQuery(event.target.value)} placeholder="Search media..." value={query} />
                        <div className="automation-media-filter-row">
                          {(["all", "IMAGE", "AUDIO", "VIDEO"] as const).map((value) => (
                            <button className={`automation-media-filter-chip ${kindFilter === value ? "active" : ""}`} key={value} onClick={() => setKindFilter(value)} type="button">
                              {value === "all" ? "All" : getMediaKindLabel(value)}
                            </button>
                          ))}
                        </div>
                      </div>
                      {filteredAssets.length ? (
                        <div className="automation-media-selector-list">
                          {filteredAssets.map((asset) => (
                            <button className="automation-media-selector-option" key={asset.id} onClick={() => onChange([...selectedIds, asset.id])} type="button">
                              <div className="automation-media-selector-copy">
                                <strong>{asset.title}</strong>
                                <span>{getMediaKindLabel(asset.kind, asset.mimeType)} · {asset.sizeLabel}</span>
                              </div>
                              <span className="automation-media-selector-state">Add</span>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div className="automation-media-selector-empty">No library media matches the current search or filter.</div>
                      )}
                    </div>
                  </div>
                </div>
                <div className="inbox-dialog-actions">
                  <div className="inbox-dialog-actions-right">
                    <button className="inbox-dialog-primary" onClick={() => setIsManagerOpen(false)} type="button">
                      Done
                    </button>
                  </div>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
}

function mapSelectedMediaAssets(assets: InboxMediaAsset[], selectedIds: string[]) {
  const assetMap = new Map(assets.map((asset) => [asset.id, asset]));
  return selectedIds.map((id) => assetMap.get(id)).filter((asset): asset is InboxMediaAsset => Boolean(asset));
}

function moveItem<T>(items: T[], fromIndex: number, toIndex: number) {
  const next = [...items];
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
}

function countReplyLines(body: string) {
  const normalized = body.trim();
  return normalized ? normalized.split(/\r?\n/).length : 0;
}
