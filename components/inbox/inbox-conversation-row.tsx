import { MetadataChip } from "@/components/inbox/metadata-chip";
import { StatusChip } from "@/components/inbox/status-chip";
import type { InboxConversation } from "@/components/inbox/types";

type InboxConversationRowProps = {
  avatarThemeClass: string;
  conversation: InboxConversation;
  isLoading: boolean;
  isSelected: boolean;
  onOpen: (conversationId: string) => void;
};

export function InboxConversationRow({
  avatarThemeClass,
  conversation,
  isLoading,
  isSelected,
  onOpen
}: InboxConversationRowProps) {
  const initials = conversation.contactName
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <button
      className={`inbox-list-item${isSelected ? " selected" : ""}${isLoading ? " loading" : ""}`}
      onClick={() => onOpen(conversation.id)}
      type="button"
    >
      <div className="chatbox-row">
        <div aria-hidden="true" className={`chatbox-avatar ${avatarThemeClass}`}>
          {initials}
        </div>

        <div className="chatbox-content">
          <div className="inbox-row-head">
            <div className="chatbox-title-row">
              <strong>{conversation.contactName}</strong>
            </div>
            <div className="inbox-row-meta-top">
              <span className={`timeline-time${conversation.unreadCount > 0 ? " unread-time" : ""}`}>
                {conversation.lastMessageAt}
              </span>
              {conversation.unreadCount > 0 ? <span className="inbox-unread-pill">{conversation.unreadCount}</span> : null}
            </div>
          </div>

          <div className="inbox-list-preview">{conversation.lastMessagePreview}</div>

          {conversation.snoozedUntil ? (
            <div className="inbox-list-reminder">
              <span className="inbox-list-reminder-label">Reminder</span>
              <span>{conversation.snoozedUntil}</span>
            </div>
          ) : null}

          <div className="inbox-list-item-meta inbox-row-chip-row">
            <MetadataChip tone={conversation.assigneeId ? "owner" : "unassigned"}>
              {conversation.assigneeId ? conversation.assignee : "Unassigned"}
            </MetadataChip>
            <MetadataChip tone="channel">WhatsApp</MetadataChip>
            {conversation.scheduledCount ? (
              <a className="inbox-list-scheduled-chip" href={`/scheduled-messages?conversationId=${conversation.id}`} onClick={(event) => event.stopPropagation()}>
                {conversation.scheduledCount} scheduled
              </a>
            ) : null}
            {conversation.isHotLead ? <MetadataChip tone="hot">Hot lead</MetadataChip> : null}
            <StatusChip>{conversation.status}</StatusChip>
          </div>
        </div>
      </div>
    </button>
  );
}
