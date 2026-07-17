"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AttachmentPreview } from "@/components/attachment-preview";
import { useToast } from "@/components/toast-provider";
import { Button } from "@/components/ui/button";
import { FullEmojiPicker } from "@/components/full-emoji-picker";
import { ScheduleSendDialog } from "@/components/inbox/schedule-send-dialog";
import {
  AttachmentIcon,
  CloseIcon,
  EmojiIcon,
  MicrophoneIcon,
  NoteIcon,
  SnoozeIcon,
  SendIcon,
  TemplateIcon,
  UploadIcon
} from "@/components/inbox/icons";
import { PortalDropdown } from "@/components/inbox/portal-dropdown";
import type {
  InboxComposerAttachment,
  InboxMediaAsset,
  InboxMentionCandidate,
  InboxQuickReply,
  InboxSelectedMention
} from "@/components/inbox/types";
import { INBOX_UPLOAD_LIMITS_HELPER, SUPPORTED_AUDIO_EXTENSIONS, UPLOAD_PROXY_LIMIT_ERROR } from "@/lib/inbox-upload";
import {
  formatMediaAssetSize,
  getMediaAssetAccept,
  getMediaKindLabel
} from "@/lib/media-library-shared";

type ReplyComposerProps = {
  error: string | null;
  canTakeOverConversation: boolean;
  isInternalNote: boolean;
  isPending: boolean;
  isPersonalChannel: boolean;
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
  selectedAttachments: InboxComposerAttachment[];
  whatsappMode: "live" | "mock" | "webjs";
  onAttachmentChange: (attachments: InboxComposerAttachment[]) => void;
  onClearReply: () => void;
  onInsertQuickReply: (quickReply: InboxQuickReply) => void;
  onMediaAssetsChange: (assets: InboxMediaAsset[]) => void;
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

type UploadQueueItem = {
  id: string;
  fileName: string;
  fingerprints: string[];
  progress: number;
};

type UploadedInboxAsset = {
  id: string;
  title: string;
  originalName?: string;
  publicUrl: string;
  mimeType: string;
  kind: InboxMediaAsset["kind"];
  sizeBytes: number;
};

export function ReplyComposer({
  error,
  canTakeOverConversation,
  isInternalNote,
  isPending,
  isPersonalChannel,
  mediaAssets,
  messageBody,
  mentionCandidates,
  replyingToMessage,
  canSendPublicReply,
  selectedMentions,
  selectedAttachments,
  whatsappMode,
  onAttachmentChange,
  onClearReply,
  onInsertQuickReply,
  onMediaAssetsChange,
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
  const toast = useToast();
  const attachmentButtonRef = useRef<HTMLButtonElement | null>(null);
  const emojiButtonRef = useRef<HTMLButtonElement | null>(null);
  const templateButtonRef = useRef<HTMLButtonElement | null>(null);
  const instantUploadInputRef = useRef<HTMLInputElement | null>(null);
  const voiceUploadInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const voiceChunksRef = useRef<Blob[]>([]);
  const [isMediaMenuOpen, setIsMediaMenuOpen] = useState(false);
  const [isEmojiMenuOpen, setIsEmojiMenuOpen] = useState(false);
  const [isTemplateMenuOpen, setIsTemplateMenuOpen] = useState(false);
  const [isScheduleDialogOpen, setIsScheduleDialogOpen] = useState(false);
  const [isClient, setIsClient] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);
  const [isVoicePanelOpen, setIsVoicePanelOpen] = useState(false);
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [recordingDurationSeconds, setRecordingDurationSeconds] = useState(0);
  const [mediaSearch, setMediaSearch] = useState("");
  const [templateSearch, setTemplateSearch] = useState("");
  const [templateCategory, setTemplateCategory] = useState("All");
  const [activeMentionQuery, setActiveMentionQuery] = useState("");
  const [activeMentionStart, setActiveMentionStart] = useState<number | null>(null);
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);
  const [uploadQueue, setUploadQueue] = useState<UploadQueueItem[]>([]);
  const [uploadedFingerprints, setUploadedFingerprints] = useState<Record<string, string>>({});
  const [mentionMenuPosition, setMentionMenuPosition] = useState<{
    left: number;
    top: number;
    placement: "above" | "below";
  }>({
    left: 12,
    top: 12,
    placement: "above"
  });
  const [activeShortcutMatch, setActiveShortcutMatch] = useState<{
    reply: InboxQuickReply;
    start: number;
    end: number;
  } | null>(null);
  const [shortcutMenuPosition, setShortcutMenuPosition] = useState<{
    left: number;
    top: number;
    placement: "above" | "below";
  }>({
    left: 12,
    top: 12,
    placement: "above"
  });
  const isUploading = uploadQueue.length > 0;
  const isSendDisabled = isPending || isUploading || (!isInternalNote && !canSendPublicReply);
  const canMention = !isInternalNote && canSendPublicReply;
  const showTakeoverCallout = !isInternalNote && requiresTakeOverForPublicReply && canTakeOverConversation;
  const selectedMedia = selectedAttachments
    .map((attachment) => {
      const asset = mediaAssets.find((candidate) => candidate.id === attachment.assetId) ?? null;
      return asset
        ? {
            ...asset,
            sendAsVoice: attachment.sendAsVoice
          }
        : null;
    })
    .filter((asset): asset is InboxMediaAsset & { sendAsVoice: boolean } => Boolean(asset));
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
    if (!isRecordingVoice) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      setRecordingDurationSeconds((current) => current + 1);
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [isRecordingVoice]);

  useEffect(() => {
    setUploadedFingerprints((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([assetId]) =>
          selectedAttachments.some((attachment) => attachment.assetId === assetId)
        )
      )
    );
  }, [selectedAttachments]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea || activeMentionStart === null) {
      return;
    }

    const nextPosition = getTextareaCaretMenuPosition(textarea, activeMentionStart + 1);
    setMentionMenuPosition(nextPosition);
  }, [activeMentionStart, activeMentionQuery, messageBody]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea || !activeShortcutMatch) {
      return;
    }

    const nextPosition = getTextareaCaretMenuPosition(textarea, activeShortcutMatch.end);
    setShortcutMenuPosition(nextPosition);
  }, [activeShortcutMatch, messageBody]);

  useEffect(() => {
    return () => {
      stopVoiceRecordingStream();
    };
  }, []);

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

  const updateQuickReplyShortcutMatch = (value: string, caretPosition: number) => {
    const prefix = value.slice(0, caretPosition);
    const match = prefix.match(/(?:^|\s)(\/[^\s/]+)$/);
    const shortcut = match?.[1]?.toLowerCase() ?? null;

    if (!shortcut) {
      setActiveShortcutMatch(null);
      return;
    }

    const reply = quickReplies.find((item) => item.shortcut.toLowerCase() === shortcut);
    if (!reply) {
      setActiveShortcutMatch(null);
      return;
    }

    const start = prefix.lastIndexOf(match?.[1] ?? shortcut);
    if (start < 0) {
      setActiveShortcutMatch(null);
      return;
    }

    setActiveShortcutMatch({
      reply,
      start,
      end: start + reply.shortcut.length
    });
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
    const nextCaretPosition = caretPosition ?? value.length;
    updateMentionQuery(value, nextCaretPosition);
    updateQuickReplyShortcutMatch(value, nextCaretPosition);
  };

  const applyQuickReplyShortcut = () => {
    if (!activeShortcutMatch) {
      return;
    }

    const textarea = textareaRef.current;
    const { end, reply, start } = activeShortcutMatch;
    const nextValue = `${messageBody.slice(0, start)}${reply.body}${messageBody.slice(end)}`;

    onMessageBodyChange(nextValue);
    onAttachmentChange(
      reply.mediaAssetIds.map((assetId) => ({
        assetId,
        sendAsVoice: false
      }))
    );
    syncSelectedMentions(nextValue);
    setActiveShortcutMatch(null);

    queueMicrotask(() => {
      if (!textarea) {
        return;
      }

      textarea.focus();
      const nextCaret = start + reply.body.length;
      textarea.setSelectionRange(nextCaret, nextCaret);
    });
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

  const mergeAssetsIntoLibrary = (uploadedAssets: InboxMediaAsset[]) => {
    const nextAssets = [...uploadedAssets];
    for (const asset of mediaAssets) {
      if (!nextAssets.some((candidate) => candidate.id === asset.id)) {
        nextAssets.push(asset);
      }
    }
    onMediaAssetsChange(nextAssets);
  };

  const appendAttachments = (attachments: InboxComposerAttachment[]) => {
    const nextAttachments = [...selectedAttachments];
    for (const attachment of attachments) {
      if (!nextAttachments.some((candidate) => candidate.assetId === attachment.assetId)) {
        nextAttachments.push(attachment);
      }
    }
    onAttachmentChange(nextAttachments);
  };

  const removeAttachment = (assetId: string) => {
    onAttachmentChange(selectedAttachments.filter((attachment) => attachment.assetId !== assetId));
    setUploadedFingerprints((current) => {
      const next = { ...current };
      delete next[assetId];
      return next;
    });
  };

  const updateUploadProgress = (uploadId: string, progress: number) => {
    setUploadQueue((current) =>
      current.map((item) => (item.id === uploadId ? { ...item, progress } : item))
    );
  };

  const uploadFiles = async (files: File[], options?: { sendAsVoice?: boolean }) => {
    if (isInternalNote || !files.length) {
      return;
    }

    const activeFingerprints = new Set(Object.values(uploadedFingerprints));
    const pendingFingerprints = new Set(uploadQueue.flatMap((item) => item.fingerprints));
    const filesToUpload = files.filter((file) => {
      const fingerprint = buildUploadFingerprint(file);
      if (activeFingerprints.has(fingerprint) || pendingFingerprints.has(fingerprint)) {
        return false;
      }
      return true;
    });

    if (!filesToUpload.length) {
      toast.error("Duplicate upload skipped", "That file is already attached or uploading.");
      return;
    }

    const uploadId = filesToUpload.map((file) => buildUploadFingerprint(file)).join("|");
    setUploadQueue((current) => [
      ...current,
      {
        id: uploadId,
        fileName:
          filesToUpload.length === 1 ? filesToUpload[0]!.name : `${filesToUpload.length} files`,
        fingerprints: filesToUpload.map((file) => buildUploadFingerprint(file)),
        progress: 0
      }
    ]);

    try {
      const response = await uploadFilesWithProgress(filesToUpload, (progress) => {
        updateUploadProgress(uploadId, progress);
      });

      const uploadedAssets = response.assets.map(mapUploadedAssetToInboxAsset);
      mergeAssetsIntoLibrary(uploadedAssets);
      appendAttachments(
        uploadedAssets.map((asset) => ({
          assetId: asset.id,
          sendAsVoice: Boolean(options?.sendAsVoice && isPersonalChannel && asset.mimeType.startsWith("audio/"))
        }))
      );
      setUploadedFingerprints((current) => ({
        ...current,
        ...Object.fromEntries(uploadedAssets.map((asset, index) => [asset.id, buildUploadFingerprint(filesToUpload[index]!)]))
      }));
    } catch (uploadError) {
      const message =
        uploadError instanceof Error ? uploadError.message : "Unable to upload media.";
      toast.error(
        message === "File exceeds maximum upload size." ? "File exceeds maximum upload size." : "Upload failed",
        message === "File exceeds maximum upload size." ? undefined : message
      );
    } finally {
      setUploadQueue((current) => current.filter((item) => item.id !== uploadId));
    }
  };

  const handleInstantUploadSelection = (fileList: FileList | null) => {
    if (!fileList?.length) {
      return;
    }

    void uploadFiles(Array.from(fileList));
  };

  const handleVoiceUploadSelection = (fileList: FileList | null) => {
    if (!fileList?.length) {
      return;
    }

    void uploadFiles(Array.from(fileList), {
      sendAsVoice: isPersonalChannel
    });
  };

  const stopVoiceRecordingStream = () => {
    mediaRecorderRef.current = null;
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
  };

  const cancelVoiceRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.ondataavailable = null;
      mediaRecorderRef.current.onstop = null;
      mediaRecorderRef.current.stop();
    }

    voiceChunksRef.current = [];
    setIsRecordingVoice(false);
    setRecordingDurationSeconds(0);
    stopVoiceRecordingStream();
  };

  const startVoiceRecording = async () => {
    if (!isPersonalChannel) {
      voiceUploadInputRef.current?.click();
      return;
    }

    if (typeof window === "undefined" || !window.MediaRecorder || !navigator.mediaDevices?.getUserMedia) {
      toast.error("Recording unavailable", "This browser cannot record voice notes here.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/ogg;codecs=opus")
        ? "audio/ogg;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "";
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);

      voiceChunksRef.current = [];
      mediaRecorderRef.current = recorder;
      mediaStreamRef.current = stream;
      setRecordingDurationSeconds(0);
      setIsVoicePanelOpen(true);
      setIsRecordingVoice(true);

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          voiceChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        const nextMimeType = recorder.mimeType || "audio/ogg";
        const extension = nextMimeType.includes("webm") ? "webm" : "ogg";
        const blob = new Blob(voiceChunksRef.current, { type: nextMimeType });
        voiceChunksRef.current = [];
        setIsRecordingVoice(false);
        setRecordingDurationSeconds(0);
        stopVoiceRecordingStream();

        if (!blob.size) {
          return;
        }

        const file = new File([blob], `voice-note-${Date.now()}.${extension}`, {
          type: nextMimeType
        });
        void uploadFiles([file], { sendAsVoice: true });
      };

      recorder.start(250);
    } catch (recordError) {
      stopVoiceRecordingStream();
      setIsRecordingVoice(false);
      toast.error(
        "Recording failed",
        recordError instanceof Error ? recordError.message : "Unable to access the microphone."
      );
    }
  };

  const stopVoiceRecording = () => {
    if (!mediaRecorderRef.current || mediaRecorderRef.current.state === "inactive") {
      return;
    }

    mediaRecorderRef.current.stop();
  };

  return (
    <div
      className={`composer inbox-composer whatsapp-composer${isDragActive ? " inbox-composer-drag-active" : ""}`}
      onDragEnter={(event) => {
        if (isInternalNote) {
          return;
        }
        event.preventDefault();
        setIsDragActive(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setIsDragActive(false);
        }
      }}
      onDragOver={(event) => {
        if (isInternalNote) {
          return;
        }
        event.preventDefault();
      }}
      onDrop={(event) => {
        if (isInternalNote) {
          return;
        }
        event.preventDefault();
        setIsDragActive(false);
        void uploadFiles(Array.from(event.dataTransfer.files ?? []));
      }}
    >
      <div className="inbox-composer-head">
        <div className="inbox-composer-copy">
          <span className="control-label">Reply composer</span>
          <p className="inbox-composer-helper">{helperCopy}</p>
        </div>
        <Button
          aria-pressed={isInternalNote}
          className={`inbox-note-toggle${isInternalNote ? " active" : ""}`}
          onClick={onToggleInternalNote}
          selected={isInternalNote}
          variant="toggle"
        >
          <NoteIcon />
          <span>{isInternalNote ? "Internal note" : "Public reply"}</span>
        </Button>
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
          onClick={(event) => {
            const caretPosition = event.currentTarget.selectionStart ?? messageBody.length;
            updateMentionQuery(messageBody, caretPosition);
            updateQuickReplyShortcutMatch(messageBody, caretPosition);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setActiveMentionQuery("");
              setActiveMentionStart(null);
              setActiveShortcutMatch(null);
              return;
            }

            if (visibleMentionCandidates.length) {
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
            }

            if (activeShortcutMatch && (event.key === "Enter" || event.key === "Tab")) {
              event.preventDefault();
              applyQuickReplyShortcut();
            }
          }}
          placeholder={isInternalNote ? "Add an internal note for your team..." : "Write a WhatsApp reply..."}
          ref={textareaRef}
          rows={1}
          value={messageBody}
        />
      </div>

      {isClient && activeShortcutMatch
        ? createPortal(
            <div
              className={`inbox-mention-menu inbox-quick-reply-shortcut-menu inbox-mention-menu-${shortcutMenuPosition.placement}`}
              role="dialog"
              aria-label="Quick reply shortcut suggestion"
              style={{
                left: `${shortcutMenuPosition.left}px`,
                top: `${shortcutMenuPosition.top}px`
              }}
            >
              <button className="inbox-quick-reply-shortcut-option" onClick={applyQuickReplyShortcut} type="button">
                <div className="inbox-quick-reply-shortcut-copy">
                  <strong>{activeShortcutMatch.reply.title}</strong>
                  <span>{activeShortcutMatch.reply.shortcut}</span>
                </div>
                <p>{activeShortcutMatch.reply.body}</p>
              </button>
            </div>,
            document.body
          )
        : null}

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
        <div className="inbox-upload-preview-grid">
          {selectedMedia.map((asset, index) => (
            <article className="inbox-upload-preview-card" key={asset.id}>
              <button
                aria-label={`Remove ${asset.title}`}
                className="inbox-upload-preview-remove"
                onClick={() => removeAttachment(asset.id)}
                type="button"
              >
                <CloseIcon />
              </button>
              <div className="inbox-upload-preview-order">{index + 1}</div>
              <AttachmentPreview
                fileName={asset.originalName || asset.title}
                fit="cover"
                mimeType={asset.mimeType}
                openLabel="Open attachment"
                sizeLabel={asset.sizeLabel}
                url={asset.publicUrl}
              />
            </article>
          ))}
        </div>
      ) : null}

      {uploadQueue.length ? (
        <div className="inbox-upload-progress-list" role="status">
          {uploadQueue.map((item) => (
            <div className="inbox-upload-progress-item" key={item.id}>
              <div className="inbox-upload-progress-copy">
                <strong>
                  <span className="inbox-upload-spinner" aria-hidden="true" />
                  {item.fileName}
                </strong>
                <span>{Math.max(0, Math.min(100, item.progress))}% uploaded</span>
              </div>
              <div className="inbox-upload-progress-bar">
                <span style={{ width: `${Math.max(6, item.progress)}%` }} />
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {isVoicePanelOpen ? (
        <div className={`inbox-voice-panel${isRecordingVoice ? " recording" : ""}`}>
          <div className="inbox-voice-panel-copy">
            <strong>{isRecordingVoice ? "Recording voice note" : "Voice message"}</strong>
            <span>
              {isRecordingVoice
                ? formatRecordingDuration(recordingDurationSeconds)
                : isPersonalChannel
                  ? "Record directly from this panel."
                  : "Cloud channel sends audio as a regular attachment."}
            </span>
          </div>
          <div className="inbox-voice-panel-actions">
            {isPersonalChannel && !isRecordingVoice ? (
              <button className="button button-secondary" onClick={() => void startVoiceRecording()} type="button">
                <MicrophoneIcon />
                <span>Record</span>
              </button>
            ) : null}
            {isRecordingVoice ? (
              <button className="button button-secondary" onClick={stopVoiceRecording} type="button">
                <MicrophoneIcon />
                <span>Stop</span>
              </button>
            ) : null}
            {isRecordingVoice ? (
              <button className="button button-ghost" onClick={cancelVoiceRecording} type="button">
                Cancel
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="inbox-upload-helper-text">{INBOX_UPLOAD_LIMITS_HELPER}</div>

      <div className="inbox-composer-footer whatsapp-composer-footer">
        <div className="whatsapp-composer-actions whatsapp-composer-actions-left">
          <button
            aria-label="Choose attachment"
            className="whatsapp-circle-button"
            disabled={isInternalNote}
            onClick={() => {
              setIsMediaMenuOpen((current) => !current);
              setIsEmojiMenuOpen(false);
              setIsTemplateMenuOpen(false);
              setIsVoicePanelOpen(false);
            }}
            ref={attachmentButtonRef}
            type="button"
          >
            <AttachmentIcon />
          </button>
          <button
            aria-label="Upload media instantly"
            className="whatsapp-circle-button"
            disabled={isInternalNote || isUploading}
            onClick={() => instantUploadInputRef.current?.click()}
            title="Upload media instantly"
            type="button"
          >
            <UploadIcon />
          </button>
          <button
            aria-label="Open template picker"
            className="whatsapp-circle-button"
            onClick={() => {
              setIsTemplateMenuOpen((current) => !current);
              setIsEmojiMenuOpen(false);
              setIsMediaMenuOpen(false);
              setIsVoicePanelOpen(false);
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
              setIsVoicePanelOpen(false);
            }}
            ref={emojiButtonRef}
            type="button"
          >
            <EmojiIcon />
          </button>
          <button
            aria-label="Voice message"
            className={`whatsapp-circle-button${isRecordingVoice ? " recording" : ""}`}
            disabled={isInternalNote || isUploading}
            onClick={() => {
              if (isRecordingVoice) {
                stopVoiceRecording();
                return;
              }
              setIsVoicePanelOpen((current) => !current);
              setIsEmojiMenuOpen(false);
              setIsTemplateMenuOpen(false);
              setIsMediaMenuOpen(false);
            }}
            title="Voice message"
            type="button"
          >
            <MicrophoneIcon />
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
            <span className="inbox-send-button-label">{isPending ? "Sending..." : isInternalNote ? "Save note" : "Send reply"}</span>
          </button>
        </div>
      </div>

      {error ? <div className="form-error">{error}</div> : null}

      <input
        accept={getMediaAssetAccept()}
        hidden
        multiple
        onChange={(event) => {
          handleInstantUploadSelection(event.target.files);
          event.currentTarget.value = "";
        }}
        ref={instantUploadInputRef}
        type="file"
      />
      <input
        accept={SUPPORTED_AUDIO_EXTENSIONS.join(",")}
        hidden
        multiple
        onChange={(event) => {
          handleVoiceUploadSelection(event.target.files);
          event.currentTarget.value = "";
        }}
        ref={voiceUploadInputRef}
        type="file"
      />

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
                  className={`inbox-media-option${selectedAttachments.some((entry) => entry.assetId === asset.id) ? " active" : ""}`}
                  key={asset.id}
                  onClick={() => {
                    appendAttachments([
                      {
                        assetId: asset.id,
                        sendAsVoice: false
                      }
                    ]);
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

function buildUploadFingerprint(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function mapUploadedAssetToInboxAsset(asset: UploadedInboxAsset): InboxMediaAsset {
  return {
    id: asset.id,
    title: asset.title,
    originalName: asset.originalName,
    publicUrl: asset.publicUrl,
    kind: asset.kind,
    mimeType: asset.mimeType,
    sizeLabel: formatMediaAssetSize(asset.sizeBytes)
  };
}

function uploadFilesWithProgress(files: File[], onProgress: (progress: number) => void) {
  return new Promise<{ assets: UploadedInboxAsset[] }>((resolve, reject) => {
    const formData = new FormData();
    files.forEach((file) => formData.append("files", file));

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/inbox/uploads");

    xhr.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable) {
        return;
      }
      onProgress(Math.round((event.loaded / event.total) * 100));
    });

    xhr.addEventListener("load", () => {
      if (xhr.status === 413) {
        reject(new Error(UPLOAD_PROXY_LIMIT_ERROR));
        return;
      }

      try {
        const payload = JSON.parse(xhr.responseText || "{}") as { assets?: UploadedInboxAsset[]; error?: string };
        if (xhr.status >= 200 && xhr.status < 300 && payload.assets) {
          onProgress(100);
          resolve({ assets: payload.assets });
          return;
        }

        reject(new Error(payload.error || "Unable to upload media."));
      } catch {
        reject(new Error("Unable to upload media."));
      }
    });

    xhr.addEventListener("error", () => reject(new Error("Unable to upload media.")));
    xhr.send(formData);
  });
}

function formatRecordingDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
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
  mirror.style.letterSpacing = computed.letterSpacing;
  mirror.style.lineHeight = computed.lineHeight;
  mirror.style.padding = computed.padding;
  mirror.style.border = computed.border;
  mirror.style.width = `${textarea.clientWidth}px`;
  mirror.style.top = "0";
  mirror.style.left = "-9999px";
  mirror.textContent = valueBeforeCaret;
  marker.textContent = "\u200b";
  mirror.appendChild(marker);
  document.body.appendChild(mirror);

  const markerRect = marker.getBoundingClientRect();
  const availableAbove = shellRect.top;
  const placement = availableAbove > estimatedMenuHeight + verticalGap ? "above" : "below";
  const top =
    placement === "above"
      ? shellRect.top + window.scrollY + markerRect.top - mirror.getBoundingClientRect().top - estimatedMenuHeight - verticalGap
      : shellRect.top + window.scrollY + markerRect.top - mirror.getBoundingClientRect().top + 28;
  const left = Math.min(
    shellRect.left + window.scrollX + markerRect.left - mirror.getBoundingClientRect().left,
    window.scrollX + document.documentElement.clientWidth - 280
  );

  document.body.removeChild(mirror);

  return {
    left: Math.max(16, left),
    top: Math.max(16, top),
    placement
  };
}
