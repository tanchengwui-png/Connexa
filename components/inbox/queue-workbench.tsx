import { ConversationList } from "@/components/inbox/conversation-list";
import { MoreIcon, SearchIcon } from "@/components/inbox/icons";
import { InboxQueueHeader } from "@/components/inbox/queue-header";
import type { InboxConversation } from "@/components/inbox/types";
import type { RefObject } from "react";

type QueueWorkbenchProps = {
  activeConversationId: string | null;
  conversations: InboxConversation[];
  hasSearchQuery: boolean;
  isLoading?: boolean;
  isRoutingPending: boolean;
  onOpenConversation: (conversationId: string) => void;
  onSearchValueChange: (value: string) => void;
  pendingConversationId: string | null;
  searchValue: string;
  unreadCount: number;
  isFilterMenuOpen: boolean;
  onToggleFilterMenu: () => void;
  toolbarFilterButtonRef: RefObject<HTMLButtonElement | null>;
};

export function QueueWorkbench({
  activeConversationId,
  conversations,
  hasSearchQuery,
  isLoading = false,
  isRoutingPending,
  onOpenConversation,
  onSearchValueChange,
  pendingConversationId,
  searchValue,
  unreadCount,
  isFilterMenuOpen,
  onToggleFilterMenu,
  toolbarFilterButtonRef
}: QueueWorkbenchProps) {
  return (
    <div className="queue-panel-shell">
      <div className="queue-panel-header">
        <InboxQueueHeader
          helperText={`${unreadCount} unread`}
          title="Chats"
          visibleCount={conversations.length}
        />
      </div>

      <div className="queue-panel-search">
        <label className="inbox-search-field" htmlFor="inbox-conversation-search">
          <SearchIcon className="inbox-search-svg" />
          <input
            aria-label="Search Contact"
            className="inbox-search-input"
            id="inbox-conversation-search"
            onChange={(event) => onSearchValueChange(event.target.value)}
            placeholder="Search Contact"
            type="text"
            value={searchValue}
          />
        </label>
        <button
          aria-expanded={isFilterMenuOpen}
          aria-label="Open inbox filters"
          className={`inbox-queue-filter-button${isFilterMenuOpen ? " active" : ""}`}
          onClick={onToggleFilterMenu}
          ref={toolbarFilterButtonRef}
          type="button"
        >
          <MoreIcon />
          <span>Inbox filters</span>
        </button>
      </div>

      {/* Queue list is the only scroll container in the left column. */}
      <div className="queue-panel-scroll">
        <ConversationList
          activeConversationId={activeConversationId}
          conversations={conversations}
          hasSearchQuery={hasSearchQuery}
          isLoading={isLoading}
          isRoutingPending={isRoutingPending}
          onOpenConversation={onOpenConversation}
          pendingConversationId={pendingConversationId}
        />
      </div>
    </div>
  );
}
