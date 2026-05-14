import type { InboxConversation } from "@/components/inbox/types";

type ConversationListItemProps = {
  avatarThemeClass: string;
  conversation: InboxConversation;
  isLoading: boolean;
  isSelected: boolean;
  onOpen: (conversationId: string) => void;
};

export function ConversationListItem({
  avatarThemeClass,
  conversation,
  isLoading,
  isSelected,
  onOpen
}: ConversationListItemProps) {
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
          {conversation.photoUrl ? (
            <img
              alt=""
              className="chatbox-avatar-image"
              src={`/api/conversations/${conversation.id}/avatar`}
            />
          ) : (
            initials
          )}
        </div>

        <div className="chatbox-content">
          <div className="inbox-row-head">
            <div className="chatbox-title-row">
              <strong className="inbox-list-name" title={conversation.contactName}>
                {conversation.contactName}
              </strong>
            </div>
            <div className="inbox-row-meta-top">
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

          <div className="inbox-list-subline">
            {conversation.isGroup ? null : <span>{conversation.phone}</span>}
            <span>{conversation.assigneeId ? conversation.assignee : "Unassigned"}</span>
            {conversation.isHotLead ? <span className="inbox-list-flag">Hot lead</span> : null}
          </div>
        </div>
      </div>
    </button>
  );
}
