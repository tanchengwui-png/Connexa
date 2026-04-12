import { ConversationActionBar } from "@/components/inbox/conversation-action-bar";
import { MetadataChip } from "@/components/inbox/metadata-chip";
import { StatusChip } from "@/components/inbox/status-chip";
import type { InboxAgent, InboxSelectedConversation } from "@/components/inbox/types";

type ActiveConversationHeaderProps = {
  agents: InboxAgent[];
  onAddTag: (tag?: string) => void;
  onSnooze: () => void;
  onUpdateConversation: (updates: {
    status?: "OPEN" | "PENDING" | "CLOSED";
    assigneeId?: string | null;
  }) => void;
  selectedConversation: NonNullable<InboxSelectedConversation>;
};

export function ActiveConversationHeader({
  agents,
  onAddTag,
  onSnooze,
  onUpdateConversation,
  selectedConversation
}: ActiveConversationHeaderProps) {
  return (
    <div className="inbox-thread-top">
      <div className="inbox-thread-primary">
        <div className="whatsapp-thread-avatar">
          {selectedConversation.photoUrl ? (
            <img
              alt=""
              className="chatbox-avatar-image"
              src={`/api/conversations/${selectedConversation.id}/avatar`}
            />
          ) : (
            selectedConversation.contactName.slice(0, 1).toUpperCase()
          )}
        </div>
          <div className="inbox-thread-primary-copy">
            <div className="inbox-thread-name-row">
              <h3 className="card-title">{selectedConversation.contactName}</h3>
              <StatusChip>{selectedConversation.status}</StatusChip>
              {selectedConversation.snoozedUntil ? <MetadataChip>{selectedConversation.snoozedUntil}</MetadataChip> : null}
            </div>
            <div className="inbox-thread-subline">
              <span>{selectedConversation.phone}</span>
              <span>Assigned to {selectedConversation.assignee}</span>
              {selectedConversation.tags.length ? <span>{selectedConversation.tags.length} labels</span> : null}
            </div>
          </div>
        </div>

      <ConversationActionBar
        agents={agents}
        onAddTag={onAddTag}
        onSnooze={onSnooze}
        onUpdateConversation={onUpdateConversation}
        selectedConversation={selectedConversation}
      />
    </div>
  );
}
