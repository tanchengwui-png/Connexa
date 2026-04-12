"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AttachmentIcon,
  ButtonsIcon,
  EmojiIcon,
  ListIcon,
  NoteIcon,
  SendIcon,
  TemplateIcon
} from "@/components/inbox/icons";
import { PortalDropdown } from "@/components/inbox/portal-dropdown";
import type { InboxQuickReply } from "@/components/inbox/types";

type ReplyComposerProps = {
  error: string | null;
  attachmentName: string | null;
  interactiveButtons: string[];
  interactiveListButtonText: string;
  interactiveListOptions: string[];
  isButtonsEnabled: boolean;
  isInternalNote: boolean;
  isListEnabled: boolean;
  isPending: boolean;
  messageBody: string;
  canSendPublicReply: boolean;
  whatsappMode: "live" | "mock" | "webjs";
  onAttachmentChange: (file: File | null) => void;
  onInteractiveButtonsChange: (buttons: string[]) => void;
  onInteractiveListButtonTextChange: (value: string) => void;
  onInteractiveListOptionsChange: (buttons: string[]) => void;
  onInsertEmoji: (emoji: string) => void;
  onInsertQuickReply: (body: string) => void;
  onToggleButtons: () => void;
  onToggleList: () => void;
  onMessageBodyChange: (value: string) => void;
  onSendMessage: () => void;
  onToggleInternalNote: () => void;
  quickReplies: InboxQuickReply[];
};

const emojiGroups = {
  smileys: {
    icon: "\u{1F642}",
    label: "Smileys",
    items: [
      "\u{1F600}",
      "\u{1F603}",
      "\u{1F604}",
      "\u{1F601}",
      "\u{1F606}",
      "\u{1F605}",
      "\u{1F602}",
      "\u{1F923}",
      "\u{1F60A}",
      "\u{1F60D}",
      "\u{1F618}",
      "\u{1F917}",
      "\u{1F60E}",
      "\u{1F970}",
      "\u{1F914}",
      "\u{1F972}"
    ]
  },
  gestures: {
    icon: "\u{1F44B}",
    label: "Gestures",
    items: [
      "\u{1F44D}",
      "\u{1F44E}",
      "\u{1F44F}",
      "\u{1F64C}",
      "\u{1F64F}",
      "\u{1F91D}",
      "\u{270C}\u{FE0F}",
      "\u{1F91E}",
      "\u{1F90C}",
      "\u{1F44C}",
      "\u{1F91F}",
      "\u{1F4AA}"
    ]
  },
  hearts: {
    icon: "\u{2764}\u{FE0F}",
    label: "Hearts",
    items: [
      "\u{2764}\u{FE0F}",
      "\u{1FA77}",
      "\u{1F9E1}",
      "\u{1F49B}",
      "\u{1F49A}",
      "\u{1F499}",
      "\u{1F49C}",
      "\u{1F90D}",
      "\u{1F497}",
      "\u{1F49E}",
      "\u{1F495}",
      "\u{1F496}"
    ]
  },
  symbols: {
    icon: "\u{2705}",
    label: "Symbols",
    items: [
      "\u{2705}",
      "\u{2714}\u{FE0F}",
      "\u{26A0}\u{FE0F}",
      "\u{2757}",
      "\u{2753}",
      "\u{2728}",
      "\u{1F389}",
      "\u{1F4AF}",
      "\u{1F525}",
      "\u{1F680}",
      "\u{1F4CC}",
      "\u{1F4A1}"
    ]
  },
  nature: {
    icon: "\u{1F31F}",
    label: "Nature",
    items: [
      "\u{1F31E}",
      "\u{1F31D}",
      "\u{1F31F}",
      "\u{2B50}",
      "\u{2601}\u{FE0F}",
      "\u{26C5}",
      "\u{1F308}",
      "\u{1F33A}",
      "\u{1F338}",
      "\u{1F33B}",
      "\u{1F340}",
      "\u{1F98B}"
    ]
  }
} as const;

type EmojiGroupKey = keyof typeof emojiGroups;

const emojiKeywords: Record<string, string[]> = {
  "\u{1F600}": ["grinning", "smile", "happy"],
  "\u{1F603}": ["smile", "happy", "open"],
  "\u{1F604}": ["smile", "happy", "laugh"],
  "\u{1F601}": ["grin", "smile"],
  "\u{1F606}": ["laugh", "happy"],
  "\u{1F605}": ["sweat", "laugh"],
  "\u{1F602}": ["tears", "laugh"],
  "\u{1F923}": ["rofl", "laugh"],
  "\u{1F60A}": ["blush", "smile"],
  "\u{1F60D}": ["love", "heart eyes"],
  "\u{1F618}": ["kiss", "love"],
  "\u{1F917}": ["hug"],
  "\u{1F60E}": ["cool", "sunglasses"],
  "\u{1F970}": ["hearts", "love"],
  "\u{1F914}": ["thinking"],
  "\u{1F972}": ["relieved", "happy tears"],
  "\u{1F44D}": ["thumbs up", "approve", "ok"],
  "\u{1F44E}": ["thumbs down", "no"],
  "\u{1F44F}": ["clap", "applause"],
  "\u{1F64C}": ["celebrate", "raised hands"],
  "\u{1F64F}": ["pray", "thanks", "please"],
  "\u{1F91D}": ["handshake", "deal"],
  "\u{270C}\u{FE0F}": ["peace", "victory"],
  "\u{1F91E}": ["crossed fingers", "hope"],
  "\u{1F90C}": ["pinched fingers"],
  "\u{1F44C}": ["ok hand"],
  "\u{1F91F}": ["love you"],
  "\u{1F4AA}": ["strong", "muscle"],
  "\u{2764}\u{FE0F}": ["heart", "love"],
  "\u{1FA77}": ["pink heart"],
  "\u{1F9E1}": ["orange heart"],
  "\u{1F49B}": ["yellow heart"],
  "\u{1F49A}": ["green heart"],
  "\u{1F499}": ["blue heart"],
  "\u{1F49C}": ["purple heart"],
  "\u{1F90D}": ["white heart"],
  "\u{1F497}": ["growing heart"],
  "\u{1F49E}": ["revolving heart"],
  "\u{1F495}": ["two hearts"],
  "\u{1F496}": ["sparkling heart"],
  "\u{2705}": ["check", "done", "approved"],
  "\u{2714}\u{FE0F}": ["tick", "done"],
  "\u{26A0}\u{FE0F}": ["warning"],
  "\u{2757}": ["exclamation"],
  "\u{2753}": ["question"],
  "\u{2728}": ["sparkles"],
  "\u{1F389}": ["party", "celebrate"],
  "\u{1F4AF}": ["hundred", "100"],
  "\u{1F525}": ["fire", "hot"],
  "\u{1F680}": ["rocket", "launch"],
  "\u{1F4CC}": ["pin"],
  "\u{1F4A1}": ["idea", "light bulb"],
  "\u{1F31E}": ["sun"],
  "\u{1F31D}": ["moon"],
  "\u{1F31F}": ["glowing star"],
  "\u{2B50}": ["star"],
  "\u{2601}\u{FE0F}": ["cloud"],
  "\u{26C5}": ["sun cloud"],
  "\u{1F308}": ["rainbow"],
  "\u{1F33A}": ["flower"],
  "\u{1F338}": ["blossom"],
  "\u{1F33B}": ["sunflower"],
  "\u{1F340}": ["clover", "luck"],
  "\u{1F98B}": ["butterfly"]
};

export function ReplyComposer({
  attachmentName,
  error,
  interactiveButtons,
  interactiveListButtonText,
  interactiveListOptions,
  isButtonsEnabled,
  isInternalNote,
  isListEnabled,
  isPending,
  messageBody,
  canSendPublicReply,
  whatsappMode,
  onAttachmentChange,
  onInteractiveButtonsChange,
  onInteractiveListButtonTextChange,
  onInteractiveListOptionsChange,
  onInsertEmoji,
  onInsertQuickReply,
  onToggleButtons,
  onToggleList,
  onMessageBodyChange,
  onSendMessage,
  onToggleInternalNote,
  quickReplies
}: ReplyComposerProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const emojiButtonRef = useRef<HTMLButtonElement | null>(null);
  const templateButtonRef = useRef<HTMLButtonElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [isEmojiMenuOpen, setIsEmojiMenuOpen] = useState(false);
  const [isTemplateMenuOpen, setIsTemplateMenuOpen] = useState(false);
  const [emojiSearch, setEmojiSearch] = useState("");
  const [templateSearch, setTemplateSearch] = useState("");
  const [templateCategory, setTemplateCategory] = useState("All");
  const [activeEmojiGroup, setActiveEmojiGroup] = useState<EmojiGroupKey>("smileys");
  const isSendDisabled = isPending || (!isInternalNote && !canSendPublicReply);
  const activeButtons = interactiveButtons.filter((entry) => entry.trim());
  const activeListOptions = interactiveListOptions.filter((entry) => entry.trim());
  const helperCopy = isInternalNote
    ? "Internal note only. This stays inside your workspace and is not sent to WhatsApp."
    : isButtonsEnabled
      ? "Public reply with WhatsApp buttons. Customers can tap one of the reply options."
    : isListEnabled
      ? "Public reply with a WhatsApp list. Customers can open the list and tap an option."
    : canSendPublicReply && whatsappMode === "mock"
      ? "Mock reply. This is simulated locally for testing and does not send a real WhatsApp message."
      : canSendPublicReply
      ? "Public reply. This sends a real WhatsApp message to the customer."
      : "Public reply is disabled until the WhatsApp channel is configured and ready.";

  const visibleEmojis = useMemo(() => {
    const query = emojiSearch.trim().toLowerCase();
    const groups = Object.entries(emojiGroups) as Array<
      [EmojiGroupKey, (typeof emojiGroups)[EmojiGroupKey]]
    >;

    if (query) {
      return groups.flatMap(([groupKey, group]) =>
        group.items.filter((emoji) => {
          const keywords = emojiKeywords[emoji] ?? [];
          const haystack = [group.label, ...keywords].join(" ").toLowerCase();
          return haystack.includes(query);
        })
      );
    }

    return emojiGroups[activeEmojiGroup].items;
  }, [activeEmojiGroup, emojiSearch]);

  const templateCategories = useMemo(
    () => Array.from(new Set(quickReplies.map((item) => item.category))).sort((left, right) => left.localeCompare(right)),
    [quickReplies]
  );

  const pinnedTemplates = useMemo(() => quickReplies.filter((item) => item.isPinned), [quickReplies]);
  const quickStripTemplates = useMemo(
    () => (pinnedTemplates.length ? pinnedTemplates : quickReplies).slice(0, 3),
    [pinnedTemplates, quickReplies]
  );
  const hiddenPinnedCount = Math.max(0, pinnedTemplates.length - quickStripTemplates.length);

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

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    textarea.style.height = "0px";
    const nextHeight = Math.min(Math.max(textarea.scrollHeight, 88), 220);
    textarea.style.height = `${nextHeight}px`;
  }, [messageBody]);

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

      <div className="whatsapp-quick-strip">
        {quickStripTemplates.map((item) => (
          <button className="inbox-quick-reply" key={item.id} onClick={() => onInsertQuickReply(item.body)} type="button">
            <span>{item.shortcut}</span>
            <strong>{item.title}</strong>
          </button>
        ))}
        {hiddenPinnedCount > 0 ? (
          <button
            className="inbox-quick-reply inbox-quick-reply-more"
            onClick={() => {
              setIsTemplateMenuOpen(true);
              setIsEmojiMenuOpen(false);
            }}
            type="button"
          >
            <span>More</span>
            <strong>+{hiddenPinnedCount} pinned</strong>
          </button>
        ) : null}
      </div>

      <textarea
        className={`composer-textarea${isInternalNote ? " note-mode" : ""}`}
        id="reply-body"
        onChange={(event) => onMessageBodyChange(event.target.value)}
        placeholder={isInternalNote ? "Add an internal note for your team..." : "Write a WhatsApp reply..."}
        ref={textareaRef}
        rows={1}
        value={messageBody}
      />

      {attachmentName ? (
        <div className="inbox-attachment-row">
          <span className="inbox-attachment-chip" title={attachmentName}>
            <AttachmentIcon />
            <span>{attachmentName}</span>
          </span>
          <button className="inbox-attachment-clear" onClick={() => onAttachmentChange(null)} type="button">
            Remove
          </button>
        </div>
      ) : null}

      {isButtonsEnabled ? (
        <div className="inbox-buttons-panel">
          <div className="inbox-buttons-panel-head">
            <strong>Reply buttons</strong>
            <span>{activeButtons.length}/3 active</span>
          </div>
          <div className="inbox-buttons-grid inbox-buttons-grid-compact">
            {[0, 1, 2].map((index) => (
              <label className="lead-record-field" key={index}>
                <span>{`Button ${index + 1}`}</span>
                <input
                  className="lead-record-input"
                  maxLength={20}
                  onChange={(event) => {
                    const next = [...interactiveButtons];
                    next[index] = event.target.value;
                    onInteractiveButtonsChange(next);
                  }}
                  placeholder={index === 0 ? "Yes" : `Button ${index + 1}`}
                  value={interactiveButtons[index] ?? ""}
                />
              </label>
            ))}
          </div>
        </div>
      ) : null}

      {isListEnabled ? (
        <div className="inbox-buttons-panel">
          <div className="inbox-buttons-panel-head">
            <strong>Reply list</strong>
            <span>{activeListOptions.length}/10 active</span>
          </div>
          <label className="lead-record-field">
            <span>Open list button text</span>
            <input
              className="lead-record-input"
              maxLength={20}
              onChange={(event) => onInteractiveListButtonTextChange(event.target.value)}
              placeholder="Choose option"
              value={interactiveListButtonText}
            />
          </label>
          <div className="inbox-buttons-grid">
            {[0, 1, 2, 3, 4].map((index) => (
              <label className="lead-record-field" key={index}>
                <span>{`Option ${index + 1}`}</span>
                <input
                  className="lead-record-input"
                  maxLength={24}
                  onChange={(event) => {
                    const next = [...interactiveListOptions];
                    next[index] = event.target.value;
                    onInteractiveListOptionsChange(next);
                  }}
                  placeholder={index === 0 ? "Option 1" : `Option ${index + 1}`}
                  value={interactiveListOptions[index] ?? ""}
                />
              </label>
            ))}
          </div>
        </div>
      ) : null}

      <div className="inbox-composer-footer whatsapp-composer-footer">
        <div className="whatsapp-composer-actions">
          <input
            accept="image/*,application/pdf"
            className="inbox-hidden-file-input"
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              onAttachmentChange(file);
              event.target.value = "";
            }}
            ref={fileInputRef}
            type="file"
          />
          <button
            aria-label="Choose attachment"
            className="whatsapp-circle-button"
            disabled={isButtonsEnabled || isListEnabled}
            onClick={() => fileInputRef.current?.click()}
            type="button"
          >
            <AttachmentIcon />
          </button>
          <button
            aria-label="Toggle reply buttons"
            className={`whatsapp-circle-button${isButtonsEnabled ? " active" : ""}`}
            disabled={isInternalNote}
            onClick={onToggleButtons}
            type="button"
          >
            <ButtonsIcon />
          </button>
          <button
            aria-label="Toggle reply list"
            className={`whatsapp-circle-button${isListEnabled ? " active" : ""}`}
            disabled={isInternalNote}
            onClick={onToggleList}
            type="button"
          >
            <ListIcon />
          </button>
          <button
            className={`inbox-interactive-chip${isButtonsEnabled ? " active" : ""}`}
            disabled={isInternalNote}
            onClick={onToggleButtons}
            type="button"
          >
            Buttons
          </button>
          <button
            className={`inbox-interactive-chip${isListEnabled ? " active" : ""}`}
            disabled={isInternalNote}
            onClick={onToggleList}
            type="button"
          >
            List
          </button>
          <button
            aria-label="Open template picker"
            className="whatsapp-circle-button"
            onClick={() => {
              setIsTemplateMenuOpen((current) => !current);
              setIsEmojiMenuOpen(false);
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
            }}
            ref={emojiButtonRef}
            type="button"
          >
            <EmojiIcon />
          </button>
        </div>

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

      {error ? <div className="form-error">{error}</div> : null}

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
            <span>{pinnedTemplates.length} pinned · {quickReplies.length} saved replies</span>
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
                    onInsertQuickReply(item.body);
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
                      {item.isPinned ? <span>Pinned</span> : null}
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
        <div className="inbox-emoji-menu">
          <div className="inbox-emoji-search-row">
            <input
              className="inbox-emoji-search"
              onChange={(event) => setEmojiSearch(event.target.value)}
              placeholder="Search emoji"
              type="text"
              value={emojiSearch}
            />
          </div>

          <div className="inbox-emoji-group-tabs">
            {(Object.entries(emojiGroups) as Array<
              [EmojiGroupKey, (typeof emojiGroups)[EmojiGroupKey]]
            >).map(([groupKey, group]) => (
              <button
                className={`inbox-emoji-group-tab${activeEmojiGroup === groupKey && !emojiSearch ? " active" : ""}`}
                key={groupKey}
                onClick={() => {
                  setActiveEmojiGroup(groupKey);
                  setEmojiSearch("");
                }}
                title={group.label}
                type="button"
              >
                {group.icon}
              </button>
            ))}
          </div>

          <div className="inbox-emoji-grid">
            {visibleEmojis.map((emoji) => (
              <button
                className="inbox-emoji-option"
                key={emoji}
                onClick={() => {
                  onInsertEmoji(emoji);
                  setIsEmojiMenuOpen(false);
                }}
                type="button"
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      </PortalDropdown>
    </div>
  );
}
