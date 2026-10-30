"use client";

import { useEffect, useRef, useState } from "react";
import { ActiveConversationHeader } from "@/components/inbox/active-conversation-header";
import { IncomingMessageBubble } from "@/components/inbox/incoming-message-bubble";
import { ReplyComposer } from "@/components/inbox/reply-composer";
import { SystemEventCard } from "@/components/inbox/system-event-card";
import { TimelineDivider } from "@/components/inbox/timeline-divider";
import { getStableInboxMessageKey, normalizeInboxMessage, normalizeInboxSelectedConversation } from "@/lib/inbox-message-normalization";
import type {
  InboxAgent,
  InboxComposerAttachment,
  InboxCurrentAgent,
  InboxMediaAsset,
  InboxMessage,
  InboxMentionCandidate,
  InboxQuickReply,
  InboxSelectedMention,
  InboxSelectedConversation
} from "@/components/inbox/types";

type ThreadPanelProps = {
  agents: InboxAgent[];
  canSendPublicReply: boolean;
  canTakeOverConversation: boolean;
  currentAgent: InboxCurrentAgent;
  error: string | null;
  hasHydrated?: boolean;
  isMuteSupported: boolean;
  isInternalNote: boolean;
  isPending: boolean;
  isPersonalChannel: boolean;
  mediaAssets: InboxMediaAsset[];
  messageBody: string;
  mentionCandidates: InboxMentionCandidate[];
  selectedMentions: InboxSelectedMention[];
  onAddTag: (tag?: string) => void;
  onAttachmentChange: (attachments: InboxComposerAttachment[]) => void;
  onMediaAssetsChange: (assets: InboxMediaAsset[]) => void;
  onDeleteMessage: (messageId: string) => void;
  onInsertQuickReply: (quickReply: InboxQuickReply) => void;
  onInternalNoteChange: (isInternalNote: boolean) => void;
  onMessageBodyChange: (value: string) => void;
  onLoadOlderMessages: () => Promise<void>;
  onRecordedVoiceNoteChange: (file: File | null) => void;
  onSetMute: (duration: "8h" | "1w" | "always" | null) => void;
  onSelectedMentionsChange: (mentions: InboxSelectedMention[]) => void;
  replyingToMessage: {
    id: string;
    sender: string;
    body: string | null;
    attachmentName: string | null;
  } | null;
  recordedVoiceNote: File | null;
  onReplyToMessage: (messageId: string) => void;
  onScheduleMessage: (value: string) => void;
  onSendMessage: () => void;
  onSnoozeConversation: () => void;
  onTakeOverConversation: () => void;
  onUpdateConversation: (updates: {
    status?: "OPEN" | "PENDING" | "CLOSED";
    assigneeId?: string | null;
    teammateIds?: string[];
    snoozedUntil?: string | null;
    snoozeReason?: string | null;
  }) => void;
  quickReplies: InboxQuickReply[];
  requiresTakeOverForPublicReply: boolean;
  selectedAttachments: InboxComposerAttachment[];
  selectedConversation: InboxSelectedConversation;
  whatsappMode: "live" | "mock" | "webjs";
};

type TimelineItem =
  | { id: string; type: "separator"; label: string }
  | {
      attachmentMimeType: string | null;
      attachmentName: string | null;
      attachmentUrl: string | null;
      canDelete: boolean;
      deletedAt: string | null;
      id: string;
      isConnexaOutbound: boolean;
      showSender: boolean;
      isScheduledEvent?: boolean;
      deliveryStatus: InboxMessage["deliveryStatus"];
      replyToMessage: {
        sender: string | null;
        body: string | null;
        attachmentName: string | null;
      } | null;
      reactions: Array<{
        id: string;
        emoji: string;
        sender: string;
        sentAtIso: string;
      }>;
      type: "message";
      direction: "inbound" | "outbound";
      body: string;
      sender: string;
      sentAt: string;
    }
  | {
      id: string;
      type: "event";
      label: string;
      meta: string;
      href?: string | null;
      occurredAtIso?: string;
    };

export function InboxThreadPanel({
  agents,
  canSendPublicReply,
  canTakeOverConversation,
  currentAgent,
  error,
  hasHydrated = true,
  isMuteSupported,
  isInternalNote,
  isPending,
  isPersonalChannel,
  mediaAssets,
  messageBody,
  mentionCandidates,
  selectedMentions,
  onAddTag,
  onAttachmentChange,
  onMediaAssetsChange,
  onDeleteMessage,
  onInsertQuickReply,
  onInternalNoteChange,
  onMessageBodyChange,
  onLoadOlderMessages,
  onRecordedVoiceNoteChange,
  onSetMute,
  onSelectedMentionsChange,
  replyingToMessage,
  recordedVoiceNote,
  onReplyToMessage,
  onScheduleMessage,
  onSendMessage,
  onSnoozeConversation,
  onTakeOverConversation,
  onUpdateConversation,
  quickReplies,
  requiresTakeOverForPublicReply,
  selectedAttachments,
  selectedConversation,
  whatsappMode
}: ThreadPanelProps) {
  const resizeHostRef = useRef<HTMLDivElement | null>(null);
  const threadBodyRef = useRef<HTMLDivElement | null>(null);
  const [composerHeight, setComposerHeight] = useState(245);
  const [isResizing, setIsResizing] = useState(false);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);

  const loadOlderMessages = async () => {
    if (isLoadingOlder || !selectedConversation?.messagePage.hasMore) return;
    const beforeHeight = threadBodyRef.current?.scrollHeight ?? 0;
    const beforeTop = threadBodyRef.current?.scrollTop ?? 0;
    setIsLoadingOlder(true);
    try {
      await onLoadOlderMessages();
      window.requestAnimationFrame(() => {
        const threadBody = threadBodyRef.current;
        if (threadBody) threadBody.scrollTop = beforeTop + (threadBody.scrollHeight - beforeHeight);
      });
    } finally {
      setIsLoadingOlder(false);
    }
  };

  useEffect(() => {
    if (!isResizing) {
      return undefined;
    }

    const handlePointerMove = (event: MouseEvent) => {
      const host = resizeHostRef.current;
      if (!host) {
        return;
      }

      const rect = host.getBoundingClientRect();
      const nextHeight = rect.bottom - event.clientY;
      setComposerHeight(Math.max(150, Math.min(420, nextHeight)));
    };

    const stopResizing = () => {
      setIsResizing(false);
    };

    window.addEventListener("mousemove", handlePointerMove);
    window.addEventListener("mouseup", stopResizing);

    return () => {
      window.removeEventListener("mousemove", handlePointerMove);
      window.removeEventListener("mouseup", stopResizing);
    };
  }, [isResizing]);

  useEffect(() => {
    if (!hasHydrated) {
      return;
    }

    const threadBody = threadBodyRef.current;
    if (!threadBody) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      threadBody.scrollTop = threadBody.scrollHeight;
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [hasHydrated, selectedConversation?.id]);

  if (!selectedConversation) {
    return <article className="inbox-column inbox-thread-panel" />;
  }

  const normalizedConversation = normalizeInboxSelectedConversation(selectedConversation)!;
  const timeline = hasHydrated ? buildTimeline(normalizedConversation) : null;

  return (
    <article className="inbox-column inbox-thread-panel">
      <ActiveConversationHeader
        agents={agents}
        currentAgent={currentAgent}
        isMuteSupported={isMuteSupported}
        onAddTag={onAddTag}
        onSetMute={onSetMute}
        onSnoozeConversation={onSnoozeConversation}
        onTakeOverConversation={onTakeOverConversation}
        onUpdateConversation={onUpdateConversation}
        selectedConversation={normalizedConversation}
      />

      {selectedConversation.isSnoozed && selectedConversation.snoozedUntil ? (
        <div className="inbox-snooze-banner">
          <strong>{selectedConversation.snoozeReason?.trim() || "Snoozed conversation"}</strong>
          <span>
            {selectedConversation.snoozedUntil}
            {selectedConversation.snoozedBy ? ` · set by ${selectedConversation.snoozedBy.name}` : ""}
          </span>
        </div>
      ) : null}

      <div
        className={`inbox-thread-resizable${isResizing ? " resizing" : ""}`}
        ref={resizeHostRef}
        style={{ gridTemplateRows: `minmax(0, 1fr) 12px minmax(150px, ${composerHeight}px)` }}
      >
        <div className="chat-thread inbox-chat-thread whatsapp-thread-body" ref={threadBodyRef}>
          <div className="inbox-thread-content">
            {selectedConversation.messagePage.hasMore ? (
              <button
                className="button button-secondary inbox-load-older-messages"
                disabled={isLoadingOlder}
                onClick={() => void loadOlderMessages()}
                type="button"
              >
                {isLoadingOlder ? "Loading…" : "Load older messages"}
              </button>
            ) : null}
            {timeline ? (
              timeline.map((item) => {
                if (item.type === "separator") {
                  return <TimelineDivider key={item.id} label={item.label} />;
                }

                if (item.type === "event") {
                  return <SystemEventCard key={item.id} label={item.label} meta={item.meta} href={item.href} />;
                }

                return (
                  <IncomingMessageBubble
                    attachmentMimeType={item.attachmentMimeType}
                    attachmentName={item.attachmentName}
                    attachmentUrl={item.attachmentUrl}
                    body={item.body}
                    canDelete={item.canDelete}
                    direction={item.direction}
                    id={item.id}
                    isConnexaOutbound={item.isConnexaOutbound}
                    isDeleted={Boolean(item.deletedAt)}
                    key={item.id}
                    deliveryStatus={item.deliveryStatus}
                    onDelete={onDeleteMessage}
                    onReply={onReplyToMessage}
                    reactions={item.reactions}
                    replyToMessage={item.replyToMessage}
                    sender={item.sender}
                    sentAt={item.sentAt}
                    showSender={item.showSender}
                  />
                );
              })
            ) : (
              <SystemEventCard label="Loading conversation" meta="Preparing message history." />
            )}
          </div>
        </div>

        <div
          aria-label="Resize reply composer"
          className="inbox-thread-splitter"
          onMouseDown={() => setIsResizing(true)}
          role="separator"
        >
          <span />
        </div>

        <ReplyComposer
          canSendPublicReply={canSendPublicReply}
          canTakeOverConversation={canTakeOverConversation}
          error={error}
          isInternalNote={isInternalNote}
          isPending={isPending}
          isPersonalChannel={isPersonalChannel}
          mediaAssets={mediaAssets}
          messageBody={messageBody}
          mentionCandidates={mentionCandidates}
          replyingToMessage={replyingToMessage}
          recordedVoiceNote={recordedVoiceNote}
          selectedMentions={selectedMentions}
          selectedAttachments={selectedAttachments}
          whatsappMode={whatsappMode}
          onAttachmentChange={onAttachmentChange}
          onMediaAssetsChange={onMediaAssetsChange}
          onClearReply={() => onReplyToMessage("")}
          onInsertQuickReply={onInsertQuickReply}
          onInternalNoteChange={onInternalNoteChange}
          onMessageBodyChange={onMessageBodyChange}
          onRecordedVoiceNoteChange={onRecordedVoiceNoteChange}
          onSelectedMentionsChange={onSelectedMentionsChange}
          onScheduleMessage={onScheduleMessage}
          onSendMessage={onSendMessage}
          onTakeOverConversation={onTakeOverConversation}
          quickReplies={quickReplies}
          requiresTakeOverForPublicReply={requiresTakeOverForPublicReply}
          takeoverOwnerName={selectedConversation.assigneeId ? selectedConversation.assignee : null}
        />
      </div>
    </article>
  );
}

function buildTimeline(selectedConversation: NonNullable<InboxSelectedConversation>): TimelineItem[] {
  const entries = [
    ...selectedConversation.messages.map((message) => {
      const normalizedMessage = normalizeInboxMessage(message);
      return {
        kind: "message" as const,
        sentAtIso: normalizedMessage.sentAtIso,
        message: normalizedMessage,
        stableKey: getStableInboxMessageKey(normalizedMessage)
      };
    }),
    ...selectedConversation.auditEvents.map((event) => ({ kind: "audit" as const, sentAtIso: event.createdAtIso, event }))
  ].sort((left, right) => left.sentAtIso.localeCompare(right.sentAtIso));

  const items: TimelineItem[] = [];
  let lastDayLabel: string | null = null;
  let previousMessageGroup: { direction: "inbound" | "outbound"; sender: string } | null = null;

  if (!entries.length) {
    items.push({
      id: "event-empty",
      type: "event",
      label: "No messages yet",
      meta: "The conversation is open and ready for the first operator reply."
    });

    return items;
  }

  entries.forEach((entry, index) => {
    const dayLabel = getDayLabel(entry.sentAtIso);

    if (dayLabel !== lastDayLabel) {
      items.push({
        id: `separator-${entry.kind}-${entry.kind === "message" ? entry.stableKey : entry.event.id}`,
        type: "separator",
        label: dayLabel
      });
      lastDayLabel = dayLabel;
      previousMessageGroup = null;
    }

    if (index === 0) {
      items.push({
        id: `event-open-${entry.kind}-${entry.kind === "message" ? entry.stableKey : entry.event.id}`,
        type: "event",
        label: "Conversation opened",
        meta: `${selectedConversation.contactName} started a WhatsApp conversation`
      });
      previousMessageGroup = null;
    }

    if (entry.kind === "audit") {
      items.push({
        id: `event-audit-${entry.event.id}`,
        type: "event",
        label: formatAuditEventLabel(entry.event),
        meta: formatAuditEventMeta(entry.event),
        occurredAtIso: entry.event.createdAtIso
      });
      previousMessageGroup = null;
      return;
    }

    const { message } = entry;

    if (message.isSystemEvent) {
      items.push({
        id: `event-message-${message.id}`,
        type: "event",
        label: message.body,
        meta: message.sentAt,
        occurredAtIso: message.sentAtIso
      });
      previousMessageGroup = null;
      return;
    }

    if (message.direction === "outbound" && message.isConnexaOutbound && !message.providerMessageId && message.outboundJobStatus) {
      items.push({
        id: `event-scheduled-${message.id}`,
        type: "event",
        label: formatPendingMessageLabel(message.outboundJobStatus),
        meta: formatPendingMessageMeta(message),
        href: buildScheduledMessageHref(selectedConversation.id, message.outboundJobStatus, message.outboundJobAvailableAt)
      });
      previousMessageGroup = null;
      return;
    }

    const showSender =
      previousMessageGroup?.direction !== message.direction || previousMessageGroup.sender !== message.sender;

    items.push({
      attachmentMimeType: message.attachmentMimeType,
      attachmentName: message.attachmentName,
      attachmentUrl: message.attachmentUrl,
      canDelete: message.direction === "outbound" && message.isConnexaOutbound && Boolean(message.providerMessageId),
      deletedAt: message.deletedAt,
      id: message.id,
      isConnexaOutbound: message.isConnexaOutbound,
      showSender,
      deliveryStatus: message.deliveryStatus,
      reactions: message.reactions,
      replyToMessage: message.replyToMessage,
      type: "message",
      direction: message.direction,
      body: message.body,
      sender: message.sender,
      sentAt: message.sentAt
    });
    previousMessageGroup = {
      direction: message.direction,
      sender: message.sender
    };
  });

  return items;
}

function formatAuditEventLabel(event: NonNullable<InboxSelectedConversation>["auditEvents"][number]) {
  switch (event.type) {
    case "ASSIGNED":
      return "Conversation assigned";
    case "TAKEN_OVER":
      return "Conversation taken over";
    case "RELEASED":
      return "Conversation released";
    case "REASSIGNED":
    default:
      return "Conversation reassigned";
  }
}

function formatAuditEventMeta(event: NonNullable<InboxSelectedConversation>["auditEvents"][number]) {
  switch (event.type) {
    case "ASSIGNED":
      return event.toAssignee ? `${event.actor} assigned this conversation to ${event.toAssignee}.` : `${event.actor} assigned this conversation.`;
    case "TAKEN_OVER":
      return event.fromAssignee
        ? `${event.actor} took over this conversation from ${event.fromAssignee}.`
        : `${event.actor} took over this conversation.`;
    case "RELEASED":
      return event.fromAssignee
        ? `${event.actor} released this conversation from ${event.fromAssignee}.`
        : `${event.actor} released this conversation to the unassigned queue.`;
    case "REASSIGNED":
    default:
      return event.fromAssignee && event.toAssignee
        ? `${event.actor} reassigned this conversation from ${event.fromAssignee} to ${event.toAssignee}.`
        : `${event.actor} updated the conversation owner.`;
  }
}

function formatPendingMessageLabel(status: string | null) {
  if (status === "CANCELED") {
    return "Scheduled send canceled";
  }

  if (status === "FAILED") {
    return "Scheduled send failed";
  }

  if (status === "RUNNING") {
    return "Scheduled send processing";
  }

  return "Scheduled message queued";
}

function formatPendingMessageMeta(
  message: NonNullable<InboxSelectedConversation>["messages"][number]
) {
  const preview = message.body.trim() || (message.attachmentName ? `Attachment: ${message.attachmentName}` : "Outbound message");

  if (message.outboundJobStatus === "CANCELED") {
    return `${preview} · Canceled before sending`;
  }

  if (message.outboundJobStatus === "FAILED") {
    return message.outboundJobLastError
      ? `${preview} · Failed: ${message.outboundJobLastError}`
      : `${preview} · Delivery failed`;
  }

  if (message.outboundJobStatus === "RUNNING") {
    return `${preview} · Sending now`;
  }

  if (message.outboundJobAvailableAt) {
    return `${preview} · Scheduled for ${message.outboundJobAvailableAt}`;
  }

  return preview;
}

function getDayLabel(isoValue?: string | null) {
  if (!isoValue || isoValue.length < 10) {
    return "Unknown date";
  }

  return isoValue.slice(0, 10);
}

function buildScheduledMessageHref(
  conversationId: string,
  status: string | null,
  availableAt: string | null
) {
  if (!availableAt) {
    return null;
  }

  if (status === "CANCELED" || status === "FAILED" || status === "RUNNING" || status === "SENT") {
    return null;
  }

  return `/scheduled-messages?conversationId=${encodeURIComponent(conversationId)}`;
}
