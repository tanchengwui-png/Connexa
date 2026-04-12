import { ConversationListItem } from "@/components/inbox/conversation-list-item";
import { QueueEmptyState } from "@/components/inbox/queue-empty-state";
import type { InboxConversation } from "@/components/inbox/types";

type ConversationListProps = {
  activeConversationId: string | null;
  conversations: InboxConversation[];
  hasSearchQuery: boolean;
  isLoading?: boolean;
  isRoutingPending: boolean;
  onOpenConversation: (conversationId: string) => void;
  pendingConversationId: string | null;
};

const AVATAR_THEMES = [
  "avatar-cyan-blue",
  "avatar-emerald-teal",
  "avatar-violet-fuchsia",
  "avatar-amber-orange",
  "avatar-pink-rose"
];

export function ConversationList({
  activeConversationId,
  conversations,
  hasSearchQuery,
  isLoading = false,
  isRoutingPending,
  onOpenConversation,
  pendingConversationId
}: ConversationListProps) {
  if (isLoading) {
    return (
      <div className="inbox-conversation-list">
        {Array.from({ length: 7 }).map((_, index) => (
          <div className="inbox-list-item inbox-list-item-skeleton" key={index}>
            <div className="chatbox-row">
              <div className="chatbox-avatar inbox-skeleton-block" />
              <div className="chatbox-content">
                <div className="inbox-skeleton-line short" />
                <div className="inbox-skeleton-line medium" />
                <div className="inbox-skeleton-line tiny" />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (!conversations.length) {
    return hasSearchQuery ? (
      <QueueEmptyState
        description="No conversations matched your search. Try a name, phone number, or a broader keyword."
        title="No search results"
      />
    ) : (
      <QueueEmptyState
        description="This queue is empty right now. Switch tabs or wait for new inbound conversations."
        title="No conversations in this tab"
      />
    );
  }

  return (
    <div className="inbox-conversation-list">
      {conversations.map((conversation) => (
        <ConversationListItem
          avatarThemeClass={getAvatarThemeClass(conversation.id)}
          conversation={conversation}
          isLoading={pendingConversationId === conversation.id && isRoutingPending}
          isSelected={activeConversationId === conversation.id}
          key={conversation.id}
          onOpen={onOpenConversation}
        />
      ))}
    </div>
  );
}

function getAvatarThemeClass(value: string) {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return AVATAR_THEMES[hash % AVATAR_THEMES.length];
}
