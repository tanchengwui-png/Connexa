"use client";

import { useEffect, useRef, useState } from "react";
import { ActiveConversationHeader } from "@/components/inbox/active-conversation-header";
import { IncomingMessageBubble } from "@/components/inbox/incoming-message-bubble";
import { ReplyComposer } from "@/components/inbox/reply-composer";
import { SystemEventCard } from "@/components/inbox/system-event-card";
import { TimelineDivider } from "@/components/inbox/timeline-divider";
import type { InboxAgent, InboxQuickReply, InboxSelectedConversation } from "@/components/inbox/types";

type ThreadPanelProps = {
  agents: InboxAgent[];
  attachmentName: string | null;
  canSendPublicReply: boolean;
  error: string | null;
  hasHydrated?: boolean;
  interactiveButtons: string[];
  interactiveListButtonText: string;
  interactiveListOptions: string[];
  isButtonsEnabled: boolean;
  isInternalNote: boolean;
  isListEnabled: boolean;
  isPending: boolean;
  messageBody: string;
  onAddTag: (tag?: string) => void;
  onAttachmentChange: (file: File | null) => void;
  onInteractiveButtonsChange: (buttons: string[]) => void;
  onInteractiveListButtonTextChange: (value: string) => void;
  onInteractiveListOptionsChange: (buttons: string[]) => void;
  onInsertEmoji: (emoji: string) => void;
  onInsertQuickReply: (body: string) => void;
  onMessageBodyChange: (value: string) => void;
  onSendMessage: () => void;
  onSnooze: () => void;
  onToggleButtons: () => void;
  onToggleList: () => void;
  onToggleInternalNote: () => void;
  onUpdateConversation: (updates: {
    status?: "OPEN" | "PENDING" | "CLOSED";
    assigneeId?: string | null;
  }) => void;
  quickReplies: InboxQuickReply[];
  selectedConversation: InboxSelectedConversation;
  whatsappMode: "live" | "mock" | "webjs";
};

type TimelineItem =
  | { id: string; type: "separator"; label: string }
  | {
      attachmentMimeType: string | null;
      attachmentName: string | null;
      attachmentUrl: string | null;
      id: string;
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
    };

export function InboxThreadPanel({
  agents,
  attachmentName,
  canSendPublicReply,
  error,
  hasHydrated = true,
  interactiveButtons,
  interactiveListButtonText,
  interactiveListOptions,
  isButtonsEnabled,
  isInternalNote,
  isListEnabled,
  isPending,
  messageBody,
  onAddTag,
  onAttachmentChange,
  onInteractiveButtonsChange,
  onInteractiveListButtonTextChange,
  onInteractiveListOptionsChange,
  onInsertEmoji,
  onInsertQuickReply,
  onMessageBodyChange,
  onSendMessage,
  onSnooze,
  onToggleButtons,
  onToggleList,
  onToggleInternalNote,
  onUpdateConversation,
  quickReplies,
  selectedConversation,
  whatsappMode
}: ThreadPanelProps) {
  const resizeHostRef = useRef<HTMLDivElement | null>(null);
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
        onAddTag={onAddTag}
        onSnooze={onSnooze}
        onUpdateConversation={onUpdateConversation}
        selectedConversation={selectedConversation}
      />

      <div
        className={`inbox-thread-resizable${isResizing ? " resizing" : ""}`}
        ref={resizeHostRef}
        style={{ gridTemplateRows: `minmax(0, 1fr) 12px minmax(150px, ${composerHeight}px)` }}
      >
        <div className="chat-thread inbox-chat-thread whatsapp-thread-body">
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
                  direction={item.direction}
                  key={item.id}
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
          attachmentName={attachmentName}
          canSendPublicReply={canSendPublicReply}
          error={error}
          interactiveButtons={interactiveButtons}
          interactiveListButtonText={interactiveListButtonText}
          interactiveListOptions={interactiveListOptions}
          isButtonsEnabled={isButtonsEnabled}
          isInternalNote={isInternalNote}
          isListEnabled={isListEnabled}
          isPending={isPending}
          messageBody={messageBody}
          whatsappMode={whatsappMode}
          onAttachmentChange={onAttachmentChange}
          onInteractiveButtonsChange={onInteractiveButtonsChange}
          onInteractiveListButtonTextChange={onInteractiveListButtonTextChange}
          onInteractiveListOptionsChange={onInteractiveListOptionsChange}
          onInsertEmoji={onInsertEmoji}
          onInsertQuickReply={onInsertQuickReply}
          onMessageBodyChange={onMessageBodyChange}
          onSendMessage={onSendMessage}
          onToggleButtons={onToggleButtons}
          onToggleList={onToggleList}
          onToggleInternalNote={onToggleInternalNote}
          quickReplies={quickReplies}
        />
      </div>
    </article>
  );
}

function buildTimeline(selectedConversation: NonNullable<InboxSelectedConversation>): TimelineItem[] {
  const items: TimelineItem[] = [];
  let lastDayLabel: string | null = null;

  if (!selectedConversation.messages.length) {
    items.push({
      id: "event-empty",
      type: "event",
      label: "No messages yet",
      meta: "The conversation is open and ready for the first operator reply."
    });

    return items;
  }

  selectedConversation.messages.forEach((message, index) => {
    const dayLabel = getDayLabel(message.sentAtIso ?? message.sentAt);

    if (dayLabel !== lastDayLabel) {
      items.push({
        id: `separator-${message.id}`,
        type: "separator",
        label: dayLabel
      });
      lastDayLabel = dayLabel;
    }

    if (index === 0) {
      items.push({
        id: `event-open-${message.id}`,
        type: "event",
        label: "Conversation opened",
        meta: `${selectedConversation.contactName} started a WhatsApp conversation`
      });
    }

    items.push({
      attachmentMimeType: message.attachmentMimeType,
      attachmentName: message.attachmentName,
      attachmentUrl: message.attachmentUrl,
      id: message.id,
      type: "message",
      direction: message.direction,
      body: message.body,
      sender: message.sender,
      sentAt: message.sentAt
    });
  });

  return items;
}

function getDayLabel(isoValue?: string | null) {
  if (!isoValue || isoValue.length < 10) {
    return "Unknown date";
  }

  return isoValue.slice(0, 10);
}
