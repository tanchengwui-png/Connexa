"use client";

import { useEffect, useRef, useState } from "react";
import { ActiveConversationHeader } from "@/components/inbox/active-conversation-header";
import { IncomingMessageBubble } from "@/components/inbox/incoming-message-bubble";
import { ReplyComposer } from "@/components/inbox/reply-composer";
import { SystemEventCard } from "@/components/inbox/system-event-card";
import { TimelineDivider } from "@/components/inbox/timeline-divider";
import type {
  InboxAgent,
  InboxCurrentAgent,
  InboxMediaAsset,
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
  isInternalNote: boolean;
  isPending: boolean;
  mediaAssets: InboxMediaAsset[];
  messageBody: string;
  mentionCandidates: InboxMentionCandidate[];
  selectedMentions: InboxSelectedMention[];
  onAddTag: (tag?: string) => void;
  onAttachmentChange: (attachmentIds: string[]) => void;
  onDeleteMessage: (messageId: string) => void;
  onInsertQuickReply: (quickReply: InboxQuickReply) => void;
  onMessageBodyChange: (value: string) => void;
  onSelectedMentionsChange: (mentions: InboxSelectedMention[]) => void;
  replyingToMessage: {
    id: string;
    sender: string;
    body: string | null;
    attachmentName: string | null;
  } | null;
  onReplyToMessage: (messageId: string) => void;
  onScheduleMessage: (value: string) => void;
  onSendMessage: () => void;
  onSnoozeConversation: () => void;
  onTakeOverConversation: () => void;
  onToggleInternalNote: () => void;
  onUpdateConversation: (updates: {
    status?: "OPEN" | "PENDING" | "CLOSED";
    assigneeId?: string | null;
    teammateIds?: string[];
    snoozedUntil?: string | null;
  }) => void;
  quickReplies: InboxQuickReply[];
  requiresTakeOverForPublicReply: boolean;
  selectedAttachmentIds: string[];
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
      isScheduledEvent?: boolean;
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
      occurredAtIso?: string;
    };

export function InboxThreadPanel({
  agents,
  canSendPublicReply,
  canTakeOverConversation,
  currentAgent,
  error,
  hasHydrated = true,
  isInternalNote,
  isPending,
  mediaAssets,
  messageBody,
  mentionCandidates,
  selectedMentions,
  onAddTag,
  onAttachmentChange,
  onDeleteMessage,
  onInsertQuickReply,
  onMessageBodyChange,
  onSelectedMentionsChange,
  replyingToMessage,
  onReplyToMessage,
  onScheduleMessage,
  onSendMessage,
  onSnoozeConversation,
  onTakeOverConversation,
  onToggleInternalNote,
  onUpdateConversation,
  quickReplies,
  requiresTakeOverForPublicReply,
  selectedAttachmentIds,
  selectedConversation,
  whatsappMode
}: ThreadPanelProps) {
  const resizeHostRef = useRef<HTMLDivElement | null>(null);
  const threadBodyRef = useRef<HTMLDivElement | null>(null);
  const [composerHeight, setComposerHeight] = useState(220);
  const [isResizing, setIsResizing] = useState(false);

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
    return (
      <article className="inbox-column inbox-thread-panel">
        <div className="inbox-empty-state inbox-thread-empty">
          <div className="whatsapp-empty-state">
            <div className="whatsapp-empty-icon" aria-hidden="true" />
            <strong>No conversation selected</strong>
            <p className="muted">Choose a chat from the queue to review the full thread and reply.</p>
          </div>
        </div>
      </article>
    );
  }

  const timeline = hasHydrated ? buildTimeline(selectedConversation) : null;

  return (
    <article className="inbox-column inbox-thread-panel">
      <ActiveConversationHeader
        agents={agents}
        currentAgent={currentAgent}
        onAddTag={onAddTag}
        onSnoozeConversation={onSnoozeConversation}
        onTakeOverConversation={onTakeOverConversation}
        onUpdateConversation={onUpdateConversation}
        selectedConversation={selectedConversation}
      />

      {selectedConversation.snoozedUntil ? (
        <div className="inbox-snooze-banner">
          <strong>Snoozed reminder</strong>
          <span>{selectedConversation.snoozedUntil}</span>
        </div>
      ) : null}

      <div
        className={`inbox-thread-resizable${isResizing ? " resizing" : ""}`}
        ref={resizeHostRef}
        style={{ gridTemplateRows: `minmax(0, 1fr) 12px minmax(150px, ${composerHeight}px)` }}
      >
        <div className="chat-thread inbox-chat-thread whatsapp-thread-body" ref={threadBodyRef}>
          {timeline ? (
            timeline.map((item) => {
              if (item.type === "separator") {
                return <TimelineDivider key={item.id} label={item.label} />;
              }

              if (item.type === "event") {
                return <SystemEventCard key={item.id} label={item.label} meta={item.meta} />;
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
                  onDelete={onDeleteMessage}
                  onReply={onReplyToMessage}
                  reactions={item.reactions}
                  replyToMessage={item.replyToMessage}
                  sender={item.sender}
                  sentAt={item.sentAt}
                />
              );
            })
          ) : (
            <SystemEventCard label="Loading conversation" meta="Preparing message history." />
          )}
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
          mediaAssets={mediaAssets}
          messageBody={messageBody}
          mentionCandidates={mentionCandidates}
          replyingToMessage={replyingToMessage}
          selectedMentions={selectedMentions}
          selectedAttachmentIds={selectedAttachmentIds}
          whatsappMode={whatsappMode}
          onAttachmentChange={onAttachmentChange}
          onClearReply={() => onReplyToMessage("")}
          onInsertQuickReply={onInsertQuickReply}
          onMessageBodyChange={onMessageBodyChange}
          onSelectedMentionsChange={onSelectedMentionsChange}
          onScheduleMessage={onScheduleMessage}
          onSendMessage={onSendMessage}
          onTakeOverConversation={onTakeOverConversation}
          onToggleInternalNote={onToggleInternalNote}
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
    ...selectedConversation.messages.map((message) => ({ kind: "message" as const, sentAtIso: message.sentAtIso, message })),
    ...selectedConversation.auditEvents.map((event) => ({ kind: "audit" as const, sentAtIso: event.createdAtIso, event }))
  ].sort((left, right) => left.sentAtIso.localeCompare(right.sentAtIso));

  const items: TimelineItem[] = [];
  let lastDayLabel: string | null = null;

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
        id: `separator-${entry.kind}-${entry.kind === "message" ? entry.message.id : entry.event.id}`,
        type: "separator",
        label: dayLabel
      });
      lastDayLabel = dayLabel;
    }

    if (index === 0) {
      items.push({
        id: `event-open-${entry.kind}-${entry.kind === "message" ? entry.message.id : entry.event.id}`,
        type: "event",
        label: "Conversation opened",
        meta: `${selectedConversation.contactName} started a WhatsApp conversation`
      });
    }

    if (entry.kind === "audit") {
      items.push({
        id: `event-audit-${entry.event.id}`,
        type: "event",
        label: formatAuditEventLabel(entry.event),
        meta: formatAuditEventMeta(entry.event),
        occurredAtIso: entry.event.createdAtIso
      });
      return;
    }

    const { message } = entry;

    if (message.direction === "outbound" && message.isConnexaOutbound && !message.providerMessageId && message.outboundJobStatus) {
      items.push({
        id: `event-scheduled-${message.id}`,
        type: "event",
        label: formatPendingMessageLabel(message.outboundJobStatus),
        meta: formatPendingMessageMeta(message)
      });
      return;
    }

    items.push({
      attachmentMimeType: message.attachmentMimeType,
      attachmentName: message.attachmentName,
      attachmentUrl: message.attachmentUrl,
      canDelete: message.direction === "outbound" && message.isConnexaOutbound && Boolean(message.providerMessageId),
      deletedAt: message.deletedAt,
      id: message.id,
      isConnexaOutbound: message.isConnexaOutbound,
      reactions: message.reactions,
      replyToMessage: message.replyToMessage,
      type: "message",
      direction: message.direction,
      body: message.body,
      sender: message.sender,
      sentAt: message.sentAt
    });
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
