"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FullEmojiPicker } from "@/components/full-emoji-picker";
import { ScheduleSendDialog } from "@/components/inbox/schedule-send-dialog";
import {
  AttachmentIcon,
  EmojiIcon,
  NoteIcon,
  SnoozeIcon,
  SendIcon,
  TemplateIcon
} from "@/components/inbox/icons";
import { PortalDropdown } from "@/components/inbox/portal-dropdown";
import type {
  InboxMediaAsset,
  InboxMentionCandidate,
  InboxQuickReply,
  InboxSelectedMention
} from "@/components/inbox/types";
import { getMediaKindLabel } from "@/lib/media-library-shared";

type ReplyComposerProps = {
  error: string | null;
  canTakeOverConversation: boolean;
  isInternalNote: boolean;
  isPending: boolean;
  mediaAssets: InboxMediaAsset[];
  messageBody: string;
  mentionCandidates: InboxMentionCandidate[];
  replyingToMessage: {
    id: string;
    sender: string;
    body: string | null;
    attachmentName: string | null;
  } | null;
  canSendPublicReply: boolean;
  selectedMentions: InboxSelectedMention[];
  selectedAttachmentIds: string[];
  whatsappMode: "live" | "mock" | "webjs";
  onAttachmentChange: (attachmentIds: string[]) => void;
  onClearReply: () => void;
  onInsertQuickReply: (quickReply: InboxQuickReply) => void;
  onMessageBodyChange: (value: string) => void;
  onSelectedMentionsChange: (mentions: InboxSelectedMention[]) => void;
  onSendMessage: () => void;
  onScheduleMessage: (value: string) => void;
  onTakeOverConversation: () => void;
  onToggleInternalNote: () => void;
  quickReplies: InboxQuickReply[];
  requiresTakeOverForPublicReply: boolean;
  takeoverOwnerName: string | null;
};

export function ReplyComposer({
  error,
  canTakeOverConversation,
  isInternalNote,
  isPending,
  mediaAssets,
  messageBody,
  mentionCandidates,
  replyingToMessage,
  canSendPublicReply,
  selectedMentions,
  selectedAttachmentIds,
  whatsappMode,
  onAttachmentChange,
  onClearReply,
  onInsertQuickReply,
  onMessageBodyChange,
  onSelectedMentionsChange,
  onSendMessage,
  onScheduleMessage,
  onTakeOverConversation,
  onToggleInternalNote,
  quickReplies,
  requiresTakeOverForPublicReply,
  takeoverOwnerName
}: ReplyComposerProps) {
  const attachmentButtonRef = useRef<HTMLButtonElement | null>(null);
  const emojiButtonRef = useRef<HTMLButtonElement | null>(null);
  const templateButtonRef = useRef<HTMLButtonElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [isMediaMenuOpen, setIsMediaMenuOpen] = useState(false);
  const [isEmojiMenuOpen, setIsEmojiMenuOpen] = useState(false);
  const [isTemplateMenuOpen, setIsTemplateMenuOpen] = useState(false);
  const [isScheduleDialogOpen, setIsScheduleDialogOpen] = useState(false);
  const [isClient, setIsClient] = useState(false);
  const [mediaSearch, setMediaSearch] = useState("");
  const [templateSearch, setTemplateSearch] = useState("");
  const [templateCategory, setTemplateCategory] = useState("All");
  const [activeMentionQuery, setActiveMentionQuery] = useState("");
  const [activeMentionStart, setActiveMentionStart] = useState<number | null>(null);
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);
  const [mentionMenuPosition, setMentionMenuPosition] = useState<{
    left: number;
    top: number;
    placement: "above" | "below";
  }>({
    left: 12,
    top: 12,
    placement: "above"
  });
  const isSendDisabled = isPending || (!isInternalNote && !canSendPublicReply);
  const canMention = !isInternalNote && canSendPublicReply;
  const showTakeoverCallout = !isInternalNote && requiresTakeOverForPublicReply && canTakeOverConversation;
  const selectedMedia = selectedAttachmentIds
    .map((id) => mediaAssets.find((asset) => asset.id === id) ?? null)
    .filter((asset): asset is InboxMediaAsset => Boolean(asset));
  const visibleSelectedMedia = selectedMedia.slice(0, 4);
  const hiddenSelectedMediaCount = Math.max(0, selectedMedia.length - visibleSelectedMedia.length);
  const helperCopy = isInternalNote
    ? "Internal note only. This stays inside your workspace and is not sent to WhatsApp."
    : showTakeoverCallout
      ? `Public reply is locked while this conversation is owned by ${takeoverOwnerName ?? "another teammate"}. Take over to reply.`
    : canSendPublicReply && whatsappMode === "mock"
      ? "Mock reply. This is simulated locally for testing and does not send a real WhatsApp message."
      : canSendPublicReply
      ? "Public reply. This sends a real WhatsApp message to the customer."
      : "Public reply is disabled until the WhatsApp channel is configured and ready.";

  const templateCategories = useMemo(
    () => Array.from(new Set(quickReplies.map((item) => item.category))).sort((left, right) => left.localeCompare(right)),
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

      return [item.title, item.shortcut, item.category, item.body].join(" ").toLowerCase().includes(query);
    });
  }, [quickReplies, templateCategory, templateSearch]);

  const visibleMediaAssets = useMemo(() => {
    const query = mediaSearch.trim().toLowerCase();
    if (!query) {
      return mediaAssets;
    }

    return mediaAssets.filter((asset) =>
      [asset.title, asset.kind, asset.mimeType].join(" ").toLowerCase().includes(query)
    );
  }, [mediaAssets, mediaSearch]);

  useEffect(() => {
    setIsClient(true);
  }, []);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    textarea.style.height = "0px";
    const nextHeight = Math.min(Math.max(textarea.scrollHeight, 88), 220);
    textarea.style.height = `${nextHeight}px`;
  }, [messageBody]);

  useEffect(() => {
    setActiveMentionIndex(0);
  }, [activeMentionQuery]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea || activeMentionStart === null) {
      return;
    }

    const nextPosition = getTextareaCaretMenuPosition(textarea, activeMentionStart + 1);
    setMentionMenuPosition(nextPosition);
  }, [activeMentionStart, activeMentionQuery, messageBody]);

  const visibleMentionCandidates = useMemo(() => {
    if (!canMention || !mentionCandidates.length) {
      return [] as InboxMentionCandidate[];
    }

    const query = activeMentionQuery.trim().toLowerCase();
    return mentionCandidates
      .filter((candidate) => {
        if (!query) {
          return true;
        }

        return [candidate.label, candidate.phone ?? "", candidate.name ?? "", candidate.pushname ?? "", candidate.token]
          .join(" ")
          .toLowerCase()
          .includes(query);
      })
      .slice(0, 8);
  }, [activeMentionQuery, canMention, mentionCandidates]);

  const syncSelectedMentions = (nextBody: string) => {
    onSelectedMentionsChange(
      selectedMentions.filter((mention) => nextBody.includes(`@${mention.label}`))
    );
  };

  const updateMentionQuery = (value: string, caretPosition: number) => {
    if (!canMention) {
      setActiveMentionQuery("");
      setActiveMentionStart(null);
      return;
    }

    const prefix = value.slice(0, caretPosition);
    const match = prefix.match(/(?:^|\s)@([^\s@]*)$/);

    if (!match || match.index === undefined) {
      setActiveMentionQuery("");
      setActiveMentionStart(null);
      return;
    }

    const atIndex = prefix.lastIndexOf("@");
    setActiveMentionQuery(match[1] ?? "");
    setActiveMentionStart(atIndex);
  };

  const insertEmojiAtCursor = (emoji: string) => {
    const textarea = textareaRef.current;
    if (!textarea) {
      onMessageBodyChange(`${messageBody}${emoji}`);
      return;
    }

    const start = textarea.selectionStart ?? messageBody.length;
    const end = textarea.selectionEnd ?? messageBody.length;
    const nextValue = `${messageBody.slice(0, start)}${emoji}${messageBody.slice(end)}`;

    onMessageBodyChange(nextValue);

    queueMicrotask(() => {
      textarea.focus();
      const nextCaret = start + emoji.length;
      textarea.setSelectionRange(nextCaret, nextCaret);
    });
  };

  const handleBodyChange = (value: string, caretPosition?: number | null) => {
    onMessageBodyChange(value);
    syncSelectedMentions(value);
    updateMentionQuery(value, caretPosition ?? value.length);
  };

  const handleMentionSelect = (candidate: InboxMentionCandidate) => {
    const textarea = textareaRef.current;
    const caretPosition = textarea?.selectionStart ?? messageBody.length;
    const mentionStart = activeMentionStart ?? messageBody.lastIndexOf("@", caretPosition);
    const mentionEnd = caretPosition;

    if (mentionStart < 0) {
      return;
    }

    const insertion = `@${candidate.label} `;
    const nextValue = `${messageBody.slice(0, mentionStart)}${insertion}${messageBody.slice(mentionEnd)}`;

    onMessageBodyChange(nextValue);
    onSelectedMentionsChange(
      Array.from(
        new Map(
          [
            ...selectedMentions.filter((mention) => nextValue.includes(`@${mention.label}`)),
            {
              id: candidate.id,
              label: candidate.label,
              token: candidate.token
            }
          ].map((mention) => [mention.id, mention])
        ).values()
      )
    );
    setActiveMentionQuery("");
    setActiveMentionStart(null);

    queueMicrotask(() => {
      if (!textarea) {
        return;
      }

      textarea.focus();
      const nextCaret = mentionStart + insertion.length;
      textarea.setSelectionRange(nextCaret, nextCaret);
    });
  };

  return (
    <div className="composer inbox-composer whatsapp-composer">
      <div className="inbox-composer-head">
        <div className="inbox-composer-copy">
          <span className="control-label">Reply composer</span>
          <p className="inbox-composer-helper">{helperCopy}</p>
        </div>
        <button className={`inbox-note-toggle${isInternalNote ? " active" : ""}`} onClick={onToggleInternalNote} type="button">
          <NoteIcon />
          <span>{isInternalNote ? "Internal note" : "Public reply"}</span>
        </button>
      </div>

      {showTakeoverCallout ? (
        <div className="inbox-snooze-banner">
          <strong>Take over required</strong>
          <span>{takeoverOwnerName ? `${takeoverOwnerName} is the current owner.` : "Another teammate is the current owner."}</span>
          <button className="button button-secondary" onClick={onTakeOverConversation} type="button">
            Take over conversation
          </button>
        </div>
      ) : null}

      {replyingToMessage ? (
        <div className="inbox-reply-context">
          <div className="inbox-reply-context-copy">
            <span>Replying to {replyingToMessage.sender}</span>
            <strong>{replyingToMessage.body?.trim() || replyingToMessage.attachmentName || "Attachment"}</strong>
          </div>
          <button className="inbox-attachment-clear" onClick={onClearReply} type="button">
            Clear
          </button>
        </div>
      ) : null}

      <div className="inbox-composer-input-shell">
        <textarea
          className={`composer-textarea${isInternalNote ? " note-mode" : ""}`}
          id="reply-body"
          onChange={(event) => handleBodyChange(event.target.value, event.target.selectionStart)}
          onClick={(event) => updateMentionQuery(messageBody, event.currentTarget.selectionStart ?? messageBody.length)}
          onKeyDown={(event) => {
            if (!visibleMentionCandidates.length) {
              return;
            }

            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActiveMentionIndex((current) => (current + 1) % visibleMentionCandidates.length);
              return;
            }

            if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveMentionIndex((current) => (current - 1 + visibleMentionCandidates.length) % visibleMentionCandidates.length);
              return;
            }

            if (event.key === "Enter" && activeMentionStart !== null) {
              event.preventDefault();
              handleMentionSelect(visibleMentionCandidates[activeMentionIndex] ?? visibleMentionCandidates[0]);
              return;
            }

            if (event.key === "Escape") {
              setActiveMentionQuery("");
              setActiveMentionStart(null);
            }
          }}
          placeholder={isInternalNote ? "Add an internal note for your team..." : "Write a WhatsApp reply..."}
          ref={textareaRef}
          rows={1}
          value={messageBody}
        />
      </div>

      {isClient && activeMentionStart !== null && visibleMentionCandidates.length
        ? createPortal(
            <div
              className={`inbox-mention-menu inbox-mention-menu-${mentionMenuPosition.placement}`}
              role="listbox"
              aria-label="Mention suggestions"
              style={{
                left: `${mentionMenuPosition.left}px`,
                top: `${mentionMenuPosition.top}px`
              }}
            >
              {visibleMentionCandidates.map((candidate, index) => (
                <button
                  className={`inbox-mention-option${index === activeMentionIndex ? " active" : ""}`}
                  key={candidate.id}
                  onClick={() => handleMentionSelect(candidate)}
                  type="button"
                >
                  <strong>{candidate.label}</strong>
                  <span>{candidate.phone ?? candidate.token}</span>
                </button>
              ))}
            </div>,
            document.body
          )
        : null}

      {selectedMedia.length ? (
        <div className="inbox-attachment-tray">
          <div className="inbox-attachment-tray-head">
            <div className="inbox-attachment-tray-copy">
              <strong>{selectedMedia.length} attachment{selectedMedia.length === 1 ? "" : "s"} selected</strong>
              <span>
                {selectedMedia.length > 4
                  ? `Showing 4 of ${selectedMedia.length}. The rest stay attached.`
                  : "Attachments stay separate from the send controls."}
              </span>
            </div>
            <button className="inbox-attachment-clear" onClick={() => onAttachmentChange([])} type="button">
              Clear
            </button>
          </div>
          <div className="inbox-attachment-row">
            {visibleSelectedMedia.map((asset, index) => (
              <span className="inbox-attachment-chip" key={asset.id} title={asset.title}>
                <AttachmentIcon />
                <span>{`${index + 1}. ${asset.title} · ${getMediaKindLabel(asset.kind, asset.mimeType)}`}</span>
              </span>
            ))}
            {hiddenSelectedMediaCount ? (
              <span className="inbox-attachment-chip inbox-attachment-chip-summary">
                <AttachmentIcon />
                <span>{`+${hiddenSelectedMediaCount} more`}</span>
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="inbox-composer-footer whatsapp-composer-footer">
        <div className="whatsapp-composer-actions">
          <button
            aria-label="Choose attachment"
            className="whatsapp-circle-button"
            disabled={isInternalNote}
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

        <div className="inbox-send-actions">
          {!isInternalNote ? (
            <button
              className="button button-secondary inbox-send-button"
              disabled={isSendDisabled}
              onClick={() => setIsScheduleDialogOpen(true)}
              type="button"
            >
              <SnoozeIcon />
              <span>Schedule</span>
            </button>
          ) : null}

          <button
            className="button button-primary inbox-send-button"
            disabled={isSendDisabled}
            onClick={onSendMessage}
            type="button"
          >
            <SendIcon />
            <span>{isPending ? "Sending..." : isInternalNote ? "Save note" : "Send reply"}</span>
          </button>
        </div>
      </div>

      {error ? <div className="form-error">{error}</div> : null}

      <PortalDropdown
        align="start"
        anchorRef={attachmentButtonRef}
        className="inbox-portal-menu"
        onClose={() => setIsMediaMenuOpen(false)}
        open={isMediaMenuOpen}
        side="top"
      >
        <div className="inbox-media-menu">
          <div className="inbox-template-menu-head">
            <strong>Media library</strong>
            <span>{mediaAssets.length} shared assets</span>
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
              visibleMediaAssets.map((asset) => (
                <button
                  className={`inbox-media-option${selectedAttachmentIds.includes(asset.id) ? " active" : ""}`}
                  key={asset.id}
                  onClick={() => {
                    onAttachmentChange([...selectedAttachmentIds, asset.id]);
                    setIsMediaMenuOpen(false);
                    setMediaSearch("");
                  }}
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
              ))
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
                <button
                  className="inbox-template-option"
                  key={item.id}
                  onClick={() => {
                    onInsertQuickReply(item);
                    setIsTemplateMenuOpen(false);
                    setTemplateSearch("");
                  }}
                  type="button"
                >
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

      <ScheduleSendDialog
        isOpen={isScheduleDialogOpen}
        isPending={isPending}
        onClose={() => setIsScheduleDialogOpen(false)}
        onSave={(value) => {
          setIsScheduleDialogOpen(false);
          onScheduleMessage(value);
        }}
      />
    </div>
  );
}

function getTextareaCaretMenuPosition(
  textarea: HTMLTextAreaElement,
  caretIndex: number
): { left: number; top: number; placement: "above" | "below" } {
  const computed = window.getComputedStyle(textarea);
  const mirror = document.createElement("div");
  const marker = document.createElement("span");
  const shellRect = textarea.getBoundingClientRect();
  const valueBeforeCaret = textarea.value.slice(0, caretIndex);
  const estimatedMenuHeight = 236;
  const verticalGap = 12;

  mirror.style.position = "absolute";
  mirror.style.visibility = "hidden";
  mirror.style.pointerEvents = "none";
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.wordBreak = "break-word";
  mirror.style.overflowWrap = "break-word";
  mirror.style.boxSizing = "border-box";
  mirror.style.font = computed.font;
  mirror.style.fontFamily = computed.fontFamily;
  mirror.style.fontSize = computed.fontSize;
  mirror.style.fontWeight = computed.fontWeight;
  mirror.style.fontStyle = computed.fontStyle;
  mirror.style.letterSpacing = computed.letterSpacing;
  mirror.style.lineHeight = computed.lineHeight;
  mirror.style.padding = computed.padding;
  mirror.style.border = computed.border;
  mirror.style.width = `${textarea.clientWidth}px`;
  mirror.style.maxWidth = `${textarea.clientWidth}px`;
  mirror.style.left = `${shellRect.left + window.scrollX}px`;
  mirror.style.top = `${shellRect.top + window.scrollY}px`;

  mirror.textContent = valueBeforeCaret;
  marker.textContent = "\u200b";
  mirror.appendChild(marker);
  document.body.appendChild(mirror);

  const markerRect = marker.getBoundingClientRect();
  const textareaRect = textarea.getBoundingClientRect();
  const viewportPadding = 12;
  const menuWidth = Math.min(320, window.innerWidth - viewportPadding * 2);
  const left = Math.min(
    Math.max(viewportPadding, markerRect.left),
    window.innerWidth - menuWidth - viewportPadding
  );
  const caretTop = markerRect.top;
  const caretBottom = markerRect.bottom;
  const spaceAbove = caretTop - viewportPadding;
  const spaceBelow = window.innerHeight - caretBottom - viewportPadding;
  const shouldPlaceBelow = spaceAbove < estimatedMenuHeight && spaceBelow > spaceAbove;
  const top = shouldPlaceBelow ? caretBottom : caretTop;

  document.body.removeChild(mirror);

  return {
    left,
    top,
    placement: shouldPlaceBelow ? "below" : "above"
  };
}
