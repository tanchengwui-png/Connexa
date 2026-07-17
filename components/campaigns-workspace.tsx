"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AttachmentPreview } from "@/components/attachment-preview";
import { FullEmojiPicker } from "@/components/full-emoji-picker";
import {
  AttachmentIcon,
  EmojiIcon,
  SearchIcon,
  SendIcon,
  TemplateIcon
} from "@/components/inbox/icons";
import { PortalDropdown } from "@/components/inbox/portal-dropdown";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/toast-provider";
import {
  formatMalaysiaDateTimeLocalInput,
  MALAYSIA_TIME_ZONE,
  parseMalaysiaDateTimeLocalInput
} from "@/lib/malaysia-time";
import { getMediaKindLabel } from "@/lib/media-library-shared";

const RECENT_CONTACT_ACTIVITY_WINDOW_MS = 1000 * 60 * 60 * 24 * 3;

type CampaignContact = {
  id: string;
  displayName: string;
  phone: string;
  photoUrl?: string | null;
  ownerId: string | null;
  ownerName: string | null;
  tags: string[];
  isHotLead: boolean;
  lastInteractionAt: string;
  lastMessagePreview: string;
};

type CampaignQuickReply = {
  id: string;
  title: string;
  shortcut: string;
  category: string;
  body: string;
  mediaAssetIds: string[];
};

type CampaignMediaAsset = {
  id: string;
  title: string;
  publicUrl: string;
  kind: "IMAGE" | "AUDIO" | "VIDEO" | "DOCUMENT";
  mimeType: string;
  sizeLabel: string;
};

type CampaignDraft = {
  id: string;
  name: string;
  selectedContactIds: string[];
  messageBody: string;
  scheduleAt: string;
  selectedAttachmentIds: string[];
  updatedAt: string;
  createdAt: string;
  createdByName: string | null;
};

type CampaignRun = {
  id: string;
  name: string;
  messageBody: string;
  scheduleAt: string;
  selectedAttachmentIds: string[];
  recipientCount: number;
  queuedJobCount: number;
  excludedCount: number;
  pendingJobCount: number;
  processingJobCount: number;
  sentJobCount: number;
  failedJobCount: number;
  canceledJobCount: number;
  createdAt: string;
  createdByName: string | null;
};

type EligibilityStatus = "eligible" | "caution" | "excluded";

type EligibilityEntry = {
  contact: CampaignContact;
  status: EligibilityStatus;
  reasons: string[];
};

type CampaignsWorkspaceProps = {
  agents: Array<{
    id: string;
    name: string;
    role: string;
  }>;
  contacts: CampaignContact[];
  initialDrafts: CampaignDraft[];
  initialRuns: CampaignRun[];
  mediaAssets: CampaignMediaAsset[];
  quickReplies: CampaignQuickReply[];
  initialDraft?: CampaignDraft | null;
  mode?: "create" | "edit" | "workspace";
  redirectOnSaveTo?: string | null;
  showHistory?: boolean;
};

export function CampaignsWorkspace({
  agents,
  contacts,
  initialDraft = null,
  initialDrafts,
  initialRuns,
  mediaAssets,
  quickReplies,
  mode = "workspace",
  redirectOnSaveTo = null,
  showHistory = true
}: CampaignsWorkspaceProps) {
  const { error: showError, success } = useToast();
  const router = useRouter();
  const attachmentButtonRef = useRef<HTMLButtonElement | null>(null);
  const emojiButtonRef = useRef<HTMLButtonElement | null>(null);
  const templateButtonRef = useRef<HTMLButtonElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const builderRef = useRef<HTMLDivElement | null>(null);
  const reviewPanelRef = useRef<HTMLElement | null>(null);
  const [campaignDrafts, setCampaignDrafts] = useState<CampaignDraft[]>(initialDrafts);
  const [campaignRuns, setCampaignRuns] = useState<CampaignRun[]>(initialRuns);
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<"builder" | "review">("builder");
  const [campaignName, setCampaignName] = useState("");
  const [searchValue, setSearchValue] = useState("");
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [tagFilter, setTagFilter] = useState("all");
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([]);
  const [messageBody, setMessageBody] = useState("");
  const [scheduleAt, setScheduleAt] = useState("");
  const [templateSearch, setTemplateSearch] = useState("");
  const [templateCategory, setTemplateCategory] = useState("All");
  const [mediaSearch, setMediaSearch] = useState("");
  const [selectedAttachmentIds, setSelectedAttachmentIds] = useState<string[]>([]);
  const [assetList, setAssetList] = useState(mediaAssets);
  const [isMediaMenuOpen, setIsMediaMenuOpen] = useState(false);
  const [isEmojiMenuOpen, setIsEmojiMenuOpen] = useState(false);
  const [isTemplateMenuOpen, setIsTemplateMenuOpen] = useState(false);
  const [isDraftsOpen, setIsDraftsOpen] = useState(false);
  const [isRunsOpen, setIsRunsOpen] = useState(false);
  const [isLaunching, setIsLaunching] = useState(false);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight, 140), 360)}px`;
  }, [messageBody]);

  useEffect(() => {
    if (activeView !== "review") {
      return;
    }

    const panel = reviewPanelRef.current;
    if (!panel) {
      return;
    }

    panel.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  }, [activeView]);

  useEffect(() => {
    if (!initialDraft) {
      return;
    }

    setActiveDraftId(initialDraft.id);
    setActiveView("builder");
    setCampaignName(initialDraft.name);
    setSelectedContactIds(
      initialDraft.selectedContactIds.filter((contactId) => contacts.some((contact) => contact.id === contactId))
    );
    setMessageBody(initialDraft.messageBody);
    setScheduleAt(formatMalaysiaDateTimeLocalInput(initialDraft.scheduleAt ? new Date(initialDraft.scheduleAt) : null));
    setSelectedAttachmentIds(
      initialDraft.selectedAttachmentIds.filter((assetId) => mediaAssets.some((asset) => asset.id === assetId))
    );
  }, [contacts, initialDraft, mediaAssets]);

  const tagOptions = useMemo(
    () =>
      Array.from(new Set(contacts.flatMap((contact) => contact.tags)))
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(right)),
    [contacts]
  );

  const visibleContacts = useMemo(() => {
    const query = searchValue.trim().toLowerCase();

    return contacts.filter((contact) => {
      if (ownerFilter !== "all" && contact.ownerId !== ownerFilter) {
        return false;
      }

      if (tagFilter !== "all" && !contact.tags.includes(tagFilter)) {
        return false;
      }

      if (!query) {
        return true;
      }

      return [
        contact.displayName,
        contact.phone,
        contact.ownerName ?? "",
        contact.tags.join(" "),
        contact.lastMessagePreview
      ]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }, [contacts, ownerFilter, searchValue, tagFilter]);

  const selectedContacts = useMemo(
    () =>
      selectedContactIds
        .map((contactId) => contacts.find((contact) => contact.id === contactId) ?? null)
        .filter(Boolean) as CampaignContact[],
    [contacts, selectedContactIds]
  );

  const selectedMedia = useMemo(
    () =>
      selectedAttachmentIds
        .map((assetId) => assetList.find((asset) => asset.id === assetId) ?? null)
        .filter(Boolean) as CampaignMediaAsset[],
    [assetList, selectedAttachmentIds]
  );

  const templateCategories = useMemo(
    () =>
      Array.from(new Set(quickReplies.map((item) => item.category))).sort((left, right) =>
        left.localeCompare(right)
      ),
    [quickReplies]
  );

  const visibleTemplates = useMemo(() => {
    const query = templateSearch.trim().toLowerCase();
    return quickReplies.filter((item) => {
      if (templateCategory !== "All" && item.category !== templateCategory) {
        return false;
      }

      if (!query) {
        return true;
      }

      return [item.title, item.shortcut, item.category, item.body]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }, [quickReplies, templateCategory, templateSearch]);

  const visibleMediaAssets = useMemo(() => {
    const query = mediaSearch.trim().toLowerCase();
    if (!query) {
      return assetList;
    }

    return assetList.filter((asset) =>
      [asset.title, asset.kind, asset.mimeType].join(" ").toLowerCase().includes(query)
    );
  }, [assetList, mediaSearch]);

  const ownerBreakdown = useMemo(() => {
    const counts = new Map<string, number>();

    for (const contact of selectedContacts) {
      const label = contact.ownerName || "Unassigned";
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }

    return Array.from(counts.entries()).sort((left, right) => right[1] - left[1]);
  }, [selectedContacts]);

  const estimatedReadyCount = useMemo(
    () => selectedContacts.filter((contact) => Boolean(contact.phone.trim())).length,
    [selectedContacts]
  );

  const eligibilityReport = useMemo(() => {
    const entries: EligibilityEntry[] = [];

    for (const contact of selectedContacts) {
      const reasons: string[] = [];
      let status: EligibilityStatus = "eligible";

      if (!contact.phone.trim()) {
        status = "excluded";
        reasons.push("Missing phone number");
      }

      const interactionTimestamp = Date.parse(contact.lastInteractionAt);
      if (Number.isFinite(interactionTimestamp)) {
        const isRecentlyActive = Date.now() - interactionTimestamp < RECENT_CONTACT_ACTIVITY_WINDOW_MS;
        if (isRecentlyActive && status !== "excluded") {
          status = "caution";
          reasons.push("Recent activity in the last 3 days");
        }
      }

      if (!contact.ownerId && status !== "excluded") {
        status = "caution";
        reasons.push("No primary owner assigned");
      }

      entries.push({
        contact,
        status,
        reasons
      });
    }

    return {
      entries,
      eligible: entries.filter((entry) => entry.status === "eligible"),
      caution: entries.filter((entry) => entry.status === "caution"),
      excluded: entries.filter((entry) => entry.status === "excluded")
    };
  }, [selectedContacts]);

  const launchableCount = eligibilityReport.eligible.length + eligibilityReport.caution.length;
  const activeRunsCount = campaignRuns.filter((run) => run.pendingJobCount > 0 || run.processingJobCount > 0).length;
  const scheduledRunsCount = campaignRuns.filter((run) => run.queuedJobCount > 0).length;

  const sampleEligibleRecipients = useMemo(
    () => eligibilityReport.entries.filter((entry) => entry.status !== "excluded").slice(0, 6),
    [eligibilityReport.entries]
  );

  const insertEmojiAtCursor = (emoji: string) => {
    const textarea = textareaRef.current;
    if (!textarea) {
      setMessageBody((current) => `${current}${emoji}`);
      return;
    }

    const start = textarea.selectionStart ?? messageBody.length;
    const end = textarea.selectionEnd ?? messageBody.length;
    const nextValue = `${messageBody.slice(0, start)}${emoji}${messageBody.slice(end)}`;
    setMessageBody(nextValue);

    queueMicrotask(() => {
      textarea.focus();
      const nextCaret = start + emoji.length;
      textarea.setSelectionRange(nextCaret, nextCaret);
    });
  };

  const toggleContactSelection = (contactId: string) => {
    setSelectedContactIds((current) =>
      current.includes(contactId) ? current.filter((value) => value !== contactId) : [...current, contactId]
    );
  };

  const selectVisibleContacts = () => {
    setSelectedContactIds((current) =>
      Array.from(new Set([...current, ...visibleContacts.map((contact) => contact.id)]))
    );
  };

  const clearVisibleContacts = () => {
    const visibleIds = new Set(visibleContacts.map((contact) => contact.id));
    setSelectedContactIds((current) => current.filter((contactId) => !visibleIds.has(contactId)));
  };

  const applyQuickReply = (reply: CampaignQuickReply) => {
    setMessageBody((current) => {
      const trimmedCurrent = current.trim();
      return trimmedCurrent ? `${trimmedCurrent}\n\n${reply.body}` : reply.body;
    });
    setSelectedAttachmentIds((current) => Array.from(new Set([...current, ...reply.mediaAssetIds])));
    setIsTemplateMenuOpen(false);
    setTemplateSearch("");
  };

  const toggleMediaSelection = (assetId: string) => {
    setSelectedAttachmentIds((current) =>
      current.includes(assetId) ? current.filter((value) => value !== assetId) : [...current, assetId]
    );
  };

  const resetCampaignBuilder = () => {
    setActiveDraftId(null);
    setActiveView("builder");
    setCampaignName("");
    setSelectedContactIds([]);
    setMessageBody("");
    setScheduleAt("");
    setSelectedAttachmentIds([]);
  };

  const startNewCampaign = () => {
    resetCampaignBuilder();
    window.requestAnimationFrame(() => {
      builderRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
    });
  };

  const saveCurrentDraft = async () => {
    if (!selectedContacts.length && !messageBody.trim() && !campaignName.trim() && !selectedAttachmentIds.length) {
      showError("Nothing to save", "Add audience, message text, or media before saving a draft.");
      return;
    }

    const payload = {
      name: campaignName.trim() || "Untitled campaign",
      messageBody,
      scheduleAt: scheduleAt ? parseMalaysiaDateTimeLocalInput(scheduleAt)?.toISOString() ?? null : null,
      selectedContactIds,
      selectedAttachmentIds
    };

    const response = await fetch(activeDraftId ? `/api/campaigns/${activeDraftId}` : "/api/campaigns", {
      method: activeDraftId ? "PATCH" : "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const result = (await response.json().catch(() => null)) as
      | {
          error?: string;
          draft?: CampaignDraft;
        }
      | null;

    if (!response.ok || !result?.draft) {
      showError("Draft not saved", result?.error ?? "Unable to save this campaign draft.");
      return;
    }

    const nextDraft = result.draft;
    setCampaignDrafts((current) =>
      [nextDraft, ...current.filter((draft) => draft.id !== nextDraft.id)].sort(
        (left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
      )
    );
    setActiveDraftId(nextDraft.id);
    success("Draft saved", `${nextDraft.name} is ready to revisit from Campaigns.`);

    if (redirectOnSaveTo) {
      router.push(redirectOnSaveTo);
      router.refresh();
    }
  };

  const loadDraft = (draft: CampaignDraft) => {
    setActiveDraftId(draft.id);
    setActiveView("builder");
    setCampaignName(draft.name);
    setSelectedContactIds(
      draft.selectedContactIds.filter((contactId) => contacts.some((contact) => contact.id === contactId))
    );
    setMessageBody(draft.messageBody);
    setScheduleAt(formatMalaysiaDateTimeLocalInput(draft.scheduleAt ? new Date(draft.scheduleAt) : null));
    setSelectedAttachmentIds(
      draft.selectedAttachmentIds.filter((assetId) => assetList.some((asset) => asset.id === assetId))
    );
  };

  const deleteDraft = async (draftId: string) => {
    const response = await fetch(`/api/campaigns/${draftId}`, {
      method: "DELETE"
    });

    const result = (await response.json().catch(() => null)) as { error?: string } | null;
    if (!response.ok) {
      showError("Draft not removed", result?.error ?? "Unable to remove this campaign draft.");
      return;
    }

    setCampaignDrafts((current) => current.filter((draft) => draft.id !== draftId));
    if (activeDraftId === draftId) {
      resetCampaignBuilder();
    }
  };

  const handleReviewCampaign = () => {
    if (!selectedContacts.length) {
      showError("No audience selected", "Choose at least one contact before reviewing launch.");
      return;
    }

    if (!messageBody.trim() && !selectedAttachmentIds.length) {
      showError("Campaign message incomplete", "Add message text or at least one media item.");
      return;
    }

    if (!launchableCount) {
      showError("No eligible recipients", "Every selected contact is blocked or missing the required phone data.");
      return;
    }

    setActiveView("review");
    success("Campaign ready for review", "Audience checks are complete. Review exclusions and launch readiness next.");
  };

  const handleLaunchCampaign = async () => {
    if (activeView !== "review") {
      handleReviewCampaign();
      return;
    }

    if (isLaunching) {
      return;
    }

    setIsLaunching(true);

    try {
      const response = await fetch("/api/campaigns/launch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          name: campaignName.trim() || "Untitled campaign",
          messageBody,
          scheduleAt: scheduleAt ? parseMalaysiaDateTimeLocalInput(scheduleAt)?.toISOString() ?? null : null,
          selectedContactIds,
          selectedAttachmentIds
        })
      });

      const result = (await response.json().catch(() => null)) as
        | {
            error?: string;
            result?: {
              runId: string;
              queuedCount: number;
              recipientCount: number;
              excludedCount: number;
              scheduledFor: string | null;
              run: CampaignRun | null;
            };
          }
        | null;

      if (!response.ok || !result?.result) {
        showError("Campaign not launched", result?.error ?? "Unable to queue this campaign.");
        return;
      }

      const { queuedCount, recipientCount, excludedCount, scheduledFor, run } = result.result;
      if (run) {
        setCampaignRuns((current) => [run, ...current.filter((entry) => entry.id !== run.id)]);
      }
      success(
        scheduledFor ? "Campaign scheduled" : "Campaign queued",
        scheduledFor
          ? `${queuedCount} outbound jobs scheduled for ${recipientCount} recipients.${excludedCount ? ` ${excludedCount} contacts were skipped.` : ""}`
          : `${queuedCount} outbound jobs queued for ${recipientCount} recipients.${excludedCount ? ` ${excludedCount} contacts were skipped.` : ""}`
      );
      resetCampaignBuilder();
    } finally {
      setIsLaunching(false);
    }
  };

  const heroTitle =
    mode === "create" ? "Create campaign" : mode === "edit" ? "Edit campaign" : "Campaigns";
  const heroDescription =
    mode === "create"
      ? "Build the audience, compose the message, and save the new campaign draft."
      : mode === "edit"
        ? "Update the saved campaign draft, then return to the campaign list."
        : "Build the audience, compose the message, and launch from one guided outbound workspace.";
  const launchStatusCopy =
    mode === "workspace"
      ? "Switch between builder and review below, then check launchability before queueing the outbound jobs."
      : "Use the same campaign builder and review flow, then save to return to the campaign list.";

  return (
    <section className="campaigns-workspace">
      <section className="auth-page-hero">
        <div className="auth-page-hero-copy">
          <span className="auth-page-kicker">Broadcast workflow</span>
          <h2>{heroTitle}</h2>
          <p>{heroDescription}</p>
          <div className="auth-page-hero-metrics">
            <span className="auth-page-hero-stat">
              <strong>{campaignDrafts.length}</strong>
              <small>drafts</small>
            </span>
            <span className="auth-page-hero-stat">
              <strong>{selectedContacts.length}</strong>
              <small>selected contacts</small>
            </span>
            <span className="auth-page-hero-stat">
              <strong>{launchableCount}</strong>
              <small>launchable</small>
            </span>
          </div>
        </div>
        <div className="auth-page-hero-side">
          <div className="auth-page-hero-actions">
            {mode === "workspace" ? (
              <button className="button button-primary" onClick={startNewCampaign} type="button">
                Create campaign
              </button>
            ) : (
              <a className="button button-secondary" href="/campaigns">
                Back to campaigns
              </a>
            )}
            <button className="button button-secondary" onClick={() => void saveCurrentDraft()} type="button">
              {mode === "edit" ? "Update campaign" : "Save draft"}
            </button>
          </div>
          <div className="auth-page-hero-panel">
            <span className="auth-page-hero-panel-label">Launch status</span>
            <strong>{activeRunsCount} active runs · {scheduledRunsCount} queued</strong>
            <p>{launchStatusCopy}</p>
          </div>
        </div>
      </section>

      <div className="campaigns-stage-header campaigns-stage-header-compact">
        <div className="campaigns-stage-copy">
          <div className="campaigns-stage-title-row">
            <div>
              <h3 className="card-title">Campaign builder</h3>
              <p className="muted">
                Build the audience, compose the message, then review and launch from one controlled flow.
              </p>
            </div>
            <div className="campaigns-stage-tabs" role="tablist" aria-label="Campaign workflow">
              <Button
                aria-selected={activeView === "builder"}
                className={`campaigns-stage-tab${activeView === "builder" ? " active" : ""}`}
                onClick={() => setActiveView("builder")}
                role="tab"
                selected={activeView === "builder"}
                variant="toggle"
              >
                Builder
              </Button>
              <Button
                aria-selected={activeView === "review"}
                className={`campaigns-stage-tab${activeView === "review" ? " active" : ""}`}
                onClick={handleReviewCampaign}
                role="tab"
                selected={activeView === "review"}
                variant="toggle"
              >
                Review
              </Button>
            </div>
          </div>
          <div className="campaigns-stage-metrics">
            <span className="campaigns-stage-pill">{campaignDrafts.length} drafts</span>
            <span className="campaigns-stage-pill">{activeRunsCount} active</span>
            <span className="campaigns-stage-pill">{scheduledRunsCount} queued</span>
            <span className="campaigns-stage-pill">{selectedContacts.length} selected</span>
            <span className="campaigns-stage-pill">{launchableCount} launchable</span>
          </div>
        </div>
        <div className="campaigns-stage-actions" />
      </div>

      {showHistory ? (
      <section className="campaigns-history-grid">
        <div className="content-card campaigns-drafts-strip">
          <button className="campaigns-history-toggle" onClick={() => setIsDraftsOpen((current) => !current)} type="button">
            <div>
              <strong>Saved drafts</strong>
              <span>{campaignDrafts.length ? `${campaignDrafts.length} saved setup${campaignDrafts.length === 1 ? "" : "s"}` : "No saved drafts yet"}</span>
            </div>
            <span>{isDraftsOpen ? "Hide" : "Show"}</span>
          </button>
          {isDraftsOpen ? (
            <div className="campaigns-drafts-list">
              {campaignDrafts.length ? (
                campaignDrafts.map((draft) => (
                  <article className={`campaigns-draft-card${activeDraftId === draft.id ? " active" : ""}`} key={draft.id}>
                    <button className="campaigns-draft-main" onClick={() => loadDraft(draft)} type="button">
                      <strong>{draft.name}</strong>
                      <span>{draft.selectedContactIds.length} recipients</span>
                      <span>{draft.selectedAttachmentIds.length ? `${draft.selectedAttachmentIds.length} media` : "Text only"}</span>
                      {draft.createdByName ? <span>{draft.createdByName}</span> : null}
                      <span>Updated {formatCampaignDraftTimestamp(draft.updatedAt)}</span>
                    </button>
                    <button
                      aria-label={`Delete ${draft.name}`}
                      className="campaigns-draft-delete"
                      onClick={() => void deleteDraft(draft.id)}
                      type="button"
                    >
                      Remove
                    </button>
                  </article>
                ))
              ) : (
                <div className="campaigns-draft-empty">
                  <strong>No drafts yet.</strong>
                  <span>Save a campaign setup to return to it later.</span>
                </div>
              )}
            </div>
          ) : null}
        </div>

        <div className="content-card campaigns-drafts-strip">
          <button className="campaigns-history-toggle" onClick={() => setIsRunsOpen((current) => !current)} type="button">
            <div>
              <strong>Recent runs</strong>
              <span>{campaignRuns.length ? `${campaignRuns.length} tracked launch${campaignRuns.length === 1 ? "" : "es"}` : "No launches yet"}</span>
            </div>
            <span>{isRunsOpen ? "Hide" : "Show"}</span>
          </button>
          {isRunsOpen ? (
            <>
              <div className="campaigns-drafts-head">
          <div>
            <p className="muted">Each launch now keeps its own run record, queue totals, and delivery progress.</p>
          </div>
          <span className="table-subtle">{campaignRuns.length} tracked</span>
        </div>
        <div className="campaigns-drafts-list">
          {campaignRuns.length ? (
            campaignRuns.map((run) => (
              <article className="campaigns-draft-card" key={run.id}>
                <div className="campaigns-draft-main">
                  <strong>{run.name}</strong>
                  <span>
                    {run.scheduleAt ? `Scheduled ${formatCampaignDraftTimestamp(run.scheduleAt)}` : `Launched ${formatCampaignDraftTimestamp(run.createdAt)}`}
                  </span>
                  <span>
                    {run.recipientCount} recipients · {run.queuedJobCount} jobs · {run.selectedAttachmentIds.length ? `${run.selectedAttachmentIds.length} media` : "Text only"}
                  </span>
                  <span>
                    {run.sentJobCount} sent · {run.pendingJobCount} scheduled · {run.processingJobCount} processing · {run.failedJobCount} failed
                    {run.canceledJobCount ? ` · ${run.canceledJobCount} canceled` : ""}
                  </span>
                  {run.excludedCount ? <span>{run.excludedCount} skipped before queueing</span> : null}
                  {run.createdByName ? <span>{run.createdByName}</span> : null}
                </div>
                <a className="campaigns-draft-delete" href={`/campaigns/${run.id}`}>
                  Details
                </a>
              </article>
            ))
          ) : (
            <div className="campaigns-draft-empty">
              <strong>No campaign runs yet.</strong>
              <span>Launch or schedule a campaign and the run will stay visible here.</span>
            </div>
          )}
              </div>
            </>
          ) : null}
        </div>
      </section>
      ) : null}

      <div className="campaigns-main-grid" ref={builderRef}>
        <section className="content-card campaigns-panel campaigns-audience-panel">
          <div className="campaigns-panel-head">
            <div className="campaigns-panel-heading">
              <div className="campaigns-panel-title-row">
                <h3 className="card-title">Audience</h3>
                <span className="campaigns-panel-step">Step 1</span>
              </div>
              <p className="muted">Search contacts, narrow the segment, and choose exactly who receives the message.</p>
            </div>
          </div>

          <div className="campaigns-audience-toolbar">
            <label className="campaigns-search-shell">
              <SearchIcon />
              <input
                className="campaigns-search-input"
                onChange={(event) => setSearchValue(event.target.value)}
                placeholder="Search contact, phone, tag, owner, or recent message"
                type="search"
                value={searchValue}
              />
            </label>
            <select className="lead-record-input app-select campaigns-filter-select" onChange={(event) => setOwnerFilter(event.target.value)} value={ownerFilter}>
              <option value="all">All owners</option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
            <select className="lead-record-input app-select campaigns-filter-select" onChange={(event) => setTagFilter(event.target.value)} value={tagFilter}>
              <option value="all">All tags</option>
              {tagOptions.map((tag) => (
                <option key={tag} value={tag}>
                  {tag}
                </option>
              ))}
            </select>
          </div>

          <div className="campaigns-audience-utility">
            <div className="campaigns-selection-strip">
              <strong>{selectedContacts.length} selected</strong>
              <div className="campaigns-selection-meta">
                <span className="campaigns-selection-pill">{visibleContacts.length} in current view</span>
                <span className="campaigns-selection-pill">{launchableCount} ready to launch</span>
                {eligibilityReport.excluded.length ? (
                  <span className="campaigns-selection-pill is-warn">{eligibilityReport.excluded.length} excluded</span>
                ) : null}
              </div>
            </div>
            <div className="campaigns-audience-actions">
              <button className="inbox-search-tool" onClick={selectVisibleContacts} type="button">
                Select visible
              </button>
              <button className="inbox-search-tool" onClick={clearVisibleContacts} type="button">
                Clear visible
              </button>
            </div>
          </div>

          <div className="campaigns-contact-list">
            {visibleContacts.length ? (
              visibleContacts.map((contact) => {
                const isSelected = selectedContactIds.includes(contact.id);
                const initials = contact.displayName
                  .split(/\s+/)
                  .slice(0, 2)
                  .map((part) => part[0]?.toUpperCase() ?? "")
                  .join("");

                return (
                  <button
                    className={`campaigns-contact-row${isSelected ? " selected" : ""}`}
                    key={contact.id}
                    onClick={() => toggleContactSelection(contact.id)}
                    type="button"
                  >
                    <span className={`campaigns-contact-check${isSelected ? " checked" : ""}`} aria-hidden="true">
                      {isSelected ? "x" : ""}
                    </span>
                    <div className="campaigns-contact-avatar">
                      {contact.photoUrl ? (
                        <img alt="" className="campaigns-contact-avatar-image" src={`/api/contacts/${contact.id}/avatar`} />
                      ) : (
                        initials || "C"
                      )}
                    </div>
                    <div className="campaigns-contact-copy">
                      <div className="campaigns-contact-head">
                        <strong>{contact.displayName}</strong>
                        {contact.isHotLead ? <span className="badge hot-badge">Hot lead</span> : null}
                      </div>
                      <div className="campaigns-contact-meta">
                        <span>{contact.phone}</span>
                        <span>{contact.ownerName || "Unassigned"}</span>
                        <span>{contact.lastInteractionAt}</span>
                      </div>
                      <p>{contact.lastMessagePreview}</p>
                      {contact.tags.length ? (
                        <div className="campaigns-contact-tags">
                          {contact.tags.slice(0, 4).map((tag) => (
                            <span className="inbox-tag-chip tone-default" key={tag}>
                              {tag}
                            </span>
                          ))}
                          {contact.tags.length > 4 ? (
                            <span className="inbox-tag-chip tone-default">+{contact.tags.length - 4}</span>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </button>
                );
              })
            ) : (
              <div className="campaigns-empty-state">
                <strong>No contacts match this filter.</strong>
                <span>Broaden the search or clear one of the audience filters.</span>
              </div>
            )}
          </div>
        </section>

        <section className="content-card campaigns-panel campaigns-composer-panel">
          <div className="campaigns-panel-head">
            <div className="campaigns-panel-heading">
              <div className="campaigns-panel-title-row">
                <h3 className="card-title">Compose</h3>
                <span className="campaigns-panel-step">Step 2</span>
              </div>
              <p className="muted">Write the campaign message, attach shared media, and shape the exact WhatsApp payload.</p>
            </div>
          </div>

          <label className="lead-record-field lead-record-field-wide">
            <span>Campaign name</span>
            <input
              className="lead-record-input"
              onChange={(event) => setCampaignName(event.target.value)}
              placeholder="April re-engagement wave"
              value={campaignName}
            />
          </label>

          <div className="campaigns-composer-shell">
            <div className="campaigns-composer-summary">
              <div className="campaigns-composer-stat">
                <span>Body</span>
                <strong>{messageBody.trim() ? `${messageBody.trim().split(/\r?\n/).length} lines` : "Empty"}</strong>
              </div>
              <div className="campaigns-composer-stat">
                <span>Media</span>
                <strong>{selectedAttachmentIds.length || "None"}</strong>
              </div>
              <div className="campaigns-composer-stat">
                <span>Recipients</span>
                <strong>{selectedContacts.length || "0"}</strong>
              </div>
            </div>

            <div className="inbox-composer-head">
              <div className="inbox-composer-copy">
                <span className="control-label">Campaign composer</span>
                <p className="inbox-composer-helper">
                  Full composer with emoji, quick replies, media library selection, and inline media upload.
                </p>
              </div>
            </div>

            <textarea
              className="composer-textarea"
              onChange={(event) => setMessageBody(event.target.value)}
              placeholder="Write the WhatsApp campaign message..."
              ref={textareaRef}
              rows={1}
              value={messageBody}
            />

            {selectedMedia.length ? (
              <div className="inbox-attachment-tray">
                <div className="inbox-attachment-tray-head">
                  <div className="inbox-attachment-tray-copy">
                    <strong>{selectedMedia.length} attachment{selectedMedia.length === 1 ? "" : "s"} selected</strong>
                    <span>Recipients will receive the same media set with this campaign.</span>
                  </div>
                  <button className="inbox-attachment-clear" onClick={() => setSelectedAttachmentIds([])} type="button">
                    Clear
                  </button>
                </div>
                <div className="inbox-attachment-row">
                  {selectedMedia.map((asset) => (
                    <div className="campaigns-attachment-preview-card" key={asset.id}>
                      <AttachmentPreview
                        className="attachment-preview-compact"
                        fileName={asset.title}
                        fit="cover"
                        mimeType={asset.mimeType}
                        openLabel="Open attachment"
                        sizeLabel={asset.sizeLabel}
                        url={asset.publicUrl}
                      />
                      <button
                        className="inbox-attachment-clear campaigns-attachment-remove"
                        onClick={() => toggleMediaSelection(asset.id)}
                        title={`Remove ${asset.title}`}
                        type="button"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="inbox-composer-footer whatsapp-composer-footer">
              <div className="whatsapp-composer-actions">
                <button
                  aria-label="Choose attachment"
                  className="whatsapp-circle-button"
                  onClick={() => {
                    setIsMediaMenuOpen((current) => !current);
                    setIsEmojiMenuOpen(false);
                    setIsTemplateMenuOpen(false);
                  }}
                  ref={attachmentButtonRef}
                  type="button"
                >
                  <AttachmentIcon />
                </button>
                <button
                  aria-label="Open template picker"
                  className="whatsapp-circle-button"
                  onClick={() => {
                    setIsTemplateMenuOpen((current) => !current);
                    setIsEmojiMenuOpen(false);
                    setIsMediaMenuOpen(false);
                  }}
                  ref={templateButtonRef}
                  type="button"
                >
                  <TemplateIcon />
                </button>
                <button
                  aria-label="Insert emoji"
                  className="whatsapp-circle-button"
                  onClick={() => {
                    setIsEmojiMenuOpen((current) => !current);
                    setIsTemplateMenuOpen(false);
                    setIsMediaMenuOpen(false);
                  }}
                  ref={emojiButtonRef}
                  type="button"
                >
                  <EmojiIcon />
                </button>
              </div>

              <div className="campaigns-composer-note">
                <span>{selectedContacts.length ? `${selectedContacts.length} recipients selected` : "Choose recipients to continue"}</span>
              </div>
            </div>

            <div className="campaigns-composer-actions">
              <button className="button button-secondary" onClick={() => void saveCurrentDraft()} type="button">
                {mode === "edit" ? "Update campaign" : "Save draft"}
              </button>
              <button className="button button-primary" onClick={handleReviewCampaign} type="button">
                <SendIcon />
                <span>Review campaign</span>
              </button>
            </div>
          </div>
        </section>

        <aside
          className={`content-card campaigns-panel campaigns-summary-panel${activeView === "review" ? " is-active" : ""}`}
          ref={reviewPanelRef}
        >
          <div className="campaigns-panel-head">
            <div className="campaigns-panel-heading">
              <div className="campaigns-panel-title-row">
                <h3 className="card-title">Review</h3>
                <span className="campaigns-panel-step">Step 3</span>
              </div>
              <p className="muted">Check launch readiness, exclusions, and the final payload before queueing the campaign.</p>
            </div>
          </div>

          <div className="campaigns-summary-stack">
            <div className="campaigns-launch-hero">
              <div className="campaigns-launch-hero-copy">
                <span className="campaigns-summary-label">Launch readiness</span>
                <strong>{campaignName.trim() || "Untitled campaign"}</strong>
                <span>
                  {launchableCount
                    ? `${launchableCount} recipients can receive this campaign now.`
                    : "Choose recipients and content to make this campaign launchable."}
                </span>
              </div>
              <div className={`campaigns-launch-indicator${launchableCount ? " is-ready" : ""}`}>
                {activeView === "review" ? "In review" : "Draft"}
              </div>
            </div>

            <div className="campaigns-review-status-grid">
              <div className="campaigns-review-status-card is-eligible">
                <span className="campaigns-summary-label">Eligible</span>
                <strong className="campaigns-review-status-value">{eligibilityReport.eligible.length}</strong>
                <span className="campaigns-review-status-note">Can be launched immediately.</span>
              </div>
              <div className="campaigns-review-status-card is-caution">
                <span className="campaigns-summary-label">Caution</span>
                <strong className="campaigns-review-status-value">{eligibilityReport.caution.length}</strong>
                <span className="campaigns-review-status-note">Usable, but worth a quick operator check.</span>
              </div>
              <div className="campaigns-review-status-card is-excluded">
                <span className="campaigns-summary-label">Excluded</span>
                <strong className="campaigns-review-status-value">{eligibilityReport.excluded.length}</strong>
                <span className="campaigns-review-status-note">Blocked until contact data is fixed.</span>
              </div>
            </div>

            <div className="campaigns-summary-card">
              <span className="campaigns-summary-label">Campaign</span>
              <strong>{campaignName.trim() || "Untitled campaign"}</strong>
              <span>
                {messageBody.trim() ? `${messageBody.trim().split(/\r?\n/).length} lines composed` : "No message body yet"}
              </span>
            </div>

            <div className="campaigns-summary-card">
              <span className="campaigns-summary-label">Schedule</span>
              <label className="lead-record-field lead-record-field-wide campaigns-schedule-field">
                <span>Optional send time</span>
                <input
                  className="lead-record-input"
                  onChange={(event) => setScheduleAt(event.target.value)}
                  type="datetime-local"
                  value={scheduleAt}
                />
              </label>
            </div>

            <div className="campaigns-summary-card">
              <span className="campaigns-summary-label">Recipients ready</span>
              <strong>{launchableCount}</strong>
              <span>
                {eligibilityReport.excluded.length
                  ? `${eligibilityReport.excluded.length} excluded before launch`
                  : `${estimatedReadyCount} contacts have usable phone numbers`}
              </span>
            </div>

            <div className="campaigns-summary-card">
              <span className="campaigns-summary-label">Owner mix</span>
              {ownerBreakdown.length ? (
                ownerBreakdown.slice(0, 4).map(([ownerName, count]) => (
                  <div className="campaigns-owner-row" key={ownerName}>
                    <span>{ownerName}</span>
                    <strong>{count}</strong>
                  </div>
                ))
              ) : (
                <span>No audience selected yet.</span>
              )}
            </div>

            <div className="campaigns-summary-card">
              <span className="campaigns-summary-label">Recipient preview</span>
              {sampleEligibleRecipients.length ? (
                <div className="campaigns-recipient-preview">
                  {sampleEligibleRecipients.map((entry) => (
                    <span className={`campaigns-recipient-chip is-${entry.status}`} key={entry.contact.id}>
                      {entry.contact.displayName}
                    </span>
                  ))}
                  {launchableCount > sampleEligibleRecipients.length ? (
                    <span className="campaigns-recipient-chip">+{launchableCount - sampleEligibleRecipients.length} more</span>
                  ) : null}
                </div>
              ) : (
                <span>No eligible contacts selected yet.</span>
              )}
            </div>

            <div className="campaigns-summary-card">
              <span className="campaigns-summary-label">Eligibility checks</span>
              {eligibilityReport.entries.length ? (
                <div className="campaigns-eligibility-list">
                  {eligibilityReport.entries.slice(0, 6).map((entry) => (
                    <div className="campaigns-eligibility-row" key={entry.contact.id}>
                      <div className="campaigns-eligibility-copy">
                        <strong>{entry.contact.displayName}</strong>
                        <span>{entry.reasons.length ? entry.reasons.join(" · ") : "No issues detected"}</span>
                      </div>
                      <span className={`campaigns-eligibility-badge is-${entry.status}`}>{entry.status}</span>
                    </div>
                  ))}
                  {eligibilityReport.entries.length > 6 ? (
                    <span className="table-subtle">+{eligibilityReport.entries.length - 6} more contacts in this review.</span>
                  ) : null}
                </div>
              ) : (
                <span>No audience selected yet.</span>
              )}
            </div>

            <div className="campaigns-preview-shell">
              <div className="campaigns-preview-head">
                <strong>Message preview</strong>
                <span>{selectedMedia.length ? `${selectedMedia.length} media attached` : "Text only"}</span>
              </div>
              <div className="campaigns-preview-bubble">
                <div className="campaigns-preview-body">
                  {renderWhatsAppFormattedText(messageBody.trim() || "Campaign preview appears here.")}
                </div>
                {selectedMedia.length ? (
                  <div className="campaigns-preview-media-list">
                    {selectedMedia.map((asset) => (
                      <AttachmentPreview
                        className="attachment-preview-compact campaigns-preview-attachment"
                        fileName={asset.title}
                        fit="cover"
                        key={asset.id}
                        mimeType={asset.mimeType}
                        openLabel="Open attachment"
                        sizeLabel={asset.sizeLabel}
                        url={asset.publicUrl}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="campaigns-review-actions">
              <button className="button button-secondary" onClick={() => setActiveView("builder")} type="button">
                Back to edit
              </button>
              <button
                className="button button-primary campaigns-launch-button"
                disabled={isLaunching}
                onClick={() => void handleLaunchCampaign()}
                type="button"
              >
                <SendIcon />
                <span>
                  {activeView === "review"
                    ? isLaunching
                      ? scheduleAt
                        ? "Scheduling..."
                        : "Queueing..."
                      : scheduleAt
                        ? "Schedule campaign"
                        : "Launch campaign"
                    : "Review campaign"}
                </span>
              </button>
            </div>
          </div>
        </aside>
      </div>

      <PortalDropdown
        align="start"
        anchorRef={attachmentButtonRef}
        className="inbox-portal-menu"
        onClose={() => setIsMediaMenuOpen(false)}
        open={isMediaMenuOpen}
        side="top"
      >
        <div className="campaigns-media-menu">
          <div className="inbox-template-menu-head">
            <strong>Media library</strong>
            <span>{assetList.length} shared assets available</span>
          </div>
          <input
            className="inbox-template-search"
            onChange={(event) => setMediaSearch(event.target.value)}
            placeholder="Search media"
            type="text"
            value={mediaSearch}
          />
          <div className="inbox-media-list">
            {visibleMediaAssets.length ? (
              visibleMediaAssets.map((asset) => {
                const isSelected = selectedAttachmentIds.includes(asset.id);
                return (
                  <button
                    className={`inbox-media-option${isSelected ? " active" : ""}`}
                    key={asset.id}
                    onClick={() => toggleMediaSelection(asset.id)}
                    type="button"
                  >
                    <div className="inbox-media-option-head">
                      <strong>{asset.title}</strong>
                      <span>{getMediaKindLabel(asset.kind, asset.mimeType)}</span>
                    </div>
                    <div className="inbox-media-option-meta">
                      <span>{asset.sizeLabel}</span>
                      <span>{asset.mimeType}</span>
                    </div>
                  </button>
                );
              })
            ) : (
              <div className="inbox-template-empty">No shared media matches your search.</div>
            )}
          </div>
        </div>
      </PortalDropdown>

      <PortalDropdown
        align="start"
        anchorRef={templateButtonRef}
        className="inbox-portal-menu"
        onClose={() => setIsTemplateMenuOpen(false)}
        open={isTemplateMenuOpen}
        side="top"
      >
        <div className="inbox-template-menu">
          <div className="inbox-template-menu-head">
            <strong>Templates</strong>
            <span>{quickReplies.length} saved replies</span>
          </div>
          <input
            className="inbox-template-search"
            onChange={(event) => setTemplateSearch(event.target.value)}
            placeholder="Search templates"
            type="text"
            value={templateSearch}
          />
          <div className="quick-replies-category-chips inbox-template-category-chips">
            {["All", ...templateCategories].map((category) => (
              <button
                className={`inbox-search-tool${templateCategory === category ? " active" : ""}`}
                key={category}
                onClick={() => setTemplateCategory(category)}
                type="button"
              >
                {category}
              </button>
            ))}
          </div>
          <div className="inbox-template-list">
            {visibleTemplates.length ? (
              visibleTemplates.map((item) => (
                <button className="inbox-template-option" key={item.id} onClick={() => applyQuickReply(item)} type="button">
                  <div className="inbox-template-option-head">
                    <strong>{item.title}</strong>
                    <div className="quick-replies-library-badges">
                      <span>{item.shortcut}</span>
                      <span>{item.category}</span>
                      {item.mediaAssetIds.length ? <span>{item.mediaAssetIds.length} media</span> : null}
                    </div>
                  </div>
                  <p>{item.body}</p>
                </button>
              ))
            ) : (
              <div className="inbox-template-empty">No templates match your search.</div>
            )}
          </div>
        </div>
      </PortalDropdown>

      <PortalDropdown
        align="start"
        anchorRef={emojiButtonRef}
        className="inbox-portal-menu"
        onClose={() => setIsEmojiMenuOpen(false)}
        open={isEmojiMenuOpen}
        side="top"
      >
        <div className="automation-emoji-picker-shell">
          <FullEmojiPicker
            onEmojiSelect={(emoji) => {
              insertEmojiAtCursor(emoji);
              setIsEmojiMenuOpen(false);
            }}
          />
        </div>
      </PortalDropdown>
    </section>
  );
}

function renderWhatsAppFormattedText(text: string) {
  const segments = text.split(/(\*[^*\n][^*\n]*\*)/g);

  return segments.map((segment, index) => {
    if (/^\*[^*\n][^*\n]*\*$/.test(segment)) {
      return <strong key={index}>{segment.slice(1, -1)}</strong>;
    }

    return segment;
  });
}

function formatCampaignDraftTimestamp(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return "recently";
  }

  return new Intl.DateTimeFormat("en-MY", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: MALAYSIA_TIME_ZONE
  }).format(new Date(timestamp));
}
