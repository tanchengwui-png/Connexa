import { ConversationActionBar } from "@/components/inbox/conversation-action-bar";
import { ContactAvatar } from "@/components/inbox/contact-avatar";
import { StatusChip } from "@/components/inbox/status-chip";
import { TagChip } from "@/components/inbox/tag-chip";
import type { InboxAgent, InboxCurrentAgent, InboxSelectedConversation } from "@/components/inbox/types";

type ActiveConversationHeaderProps = {
  agents: InboxAgent[];
  currentAgent: InboxCurrentAgent;
  isMuteSupported: boolean;
  onAddTag: (tag?: string) => void;
  onSetMute: (duration: "8h" | "1w" | "always" | null) => void;
  onSnoozeConversation: () => void;
  onTakeOverConversation: () => void;
  onUpdateConversation: (updates: {
    status?: "OPEN" | "PENDING" | "CLOSED";
    assigneeId?: string | null;
    teammateIds?: string[];
    snoozedUntil?: string | null;
    snoozeReason?: string | null;
  }) => void;
  selectedConversation: NonNullable<InboxSelectedConversation>;
};

export function ActiveConversationHeader({
  agents,
  currentAgent,
  isMuteSupported,
  onAddTag,
  onSetMute,
  onSnoozeConversation,
  onTakeOverConversation,
  onUpdateConversation,
  selectedConversation
}: ActiveConversationHeaderProps) {
  return (
    <div className="inbox-thread-top">
      <div className="inbox-thread-primary">
        <ContactAvatar
          className="whatsapp-thread-avatar"
          fallback={selectedConversation.contactName.slice(0, 1).toUpperCase()}
          profilePicUrl={selectedConversation.profilePicUrl}
        />
          <div className="inbox-thread-primary-copy">
            <div className="inbox-thread-name-row">
              <h3 className="card-title">{selectedConversation.contactName}</h3>
              <StatusChip>{selectedConversation.status}</StatusChip>
            </div>
            <div className="inbox-thread-subline">
              {selectedConversation.channelLabel ? (
                <span className="inbox-thread-channel-label">
                  Replying from: <strong>{selectedConversation.channelLabel}</strong>
                </span>
              ) : null}
              {selectedConversation.isGroup ? null : <span>{selectedConversation.phone}</span>}
              {selectedConversation.scheduledCount ? (
                <a className="inbox-scheduled-link" href={`/scheduled-messages?conversationId=${selectedConversation.id}`}>
                  {selectedConversation.scheduledCount} scheduled
                  {selectedConversation.nextScheduledAt ? ` · next ${selectedConversation.nextScheduledAt}` : ""}
                </a>
              ) : null}
              {selectedConversation.tags.length ? <span>{selectedConversation.tags.length} labels</span> : null}
            </div>
            {selectedConversation.isPinned || selectedConversation.isArchived || selectedConversation.isMuted ? (
              <div className="inbox-thread-chip-row">
                {selectedConversation.isPinned ? <TagChip tone="default">Pinned</TagChip> : null}
                {selectedConversation.isArchived ? <TagChip tone="status">Archived</TagChip> : null}
                {selectedConversation.isMuted ? (
                  <TagChip tone="status">
                    {selectedConversation.muteExpiration ? `Muted until ${selectedConversation.muteExpiration}` : "Muted"}
                  </TagChip>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

      <ConversationActionBar
        agents={agents}
        currentAgent={currentAgent}
        isMuteSupported={isMuteSupported}
        onAddTag={onAddTag}
        onSetMute={onSetMute}
        onSnoozeConversation={onSnoozeConversation}
        onTakeOverConversation={onTakeOverConversation}
        onUpdateConversation={onUpdateConversation}
        selectedConversation={selectedConversation}
      />
    </div>
  );
}
