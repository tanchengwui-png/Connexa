import { ConversationList } from "@/components/inbox/conversation-list";
import { InboxQueueHeader } from "@/components/inbox/queue-header";
import { QueueToolbar } from "@/components/inbox/queue-toolbar";
import type { InboxConversation, InboxFilterKey } from "@/components/inbox/types";

type QueueWorkbenchProps = {
  activeConversationId: string | null;
  conversations: InboxConversation[];
  filter: InboxFilterKey;
  filterCounts: Record<InboxFilterKey, number>;
  isLoading?: boolean;
  isRoutingPending: boolean;
  onFilterChange: (value: InboxFilterKey) => void;
  onOpenConversation: (conversationId: string) => void;
  pendingConversationId: string | null;
  searchValue: string;
  onSearchValueChange: (value: string) => void;
};

export function QueueWorkbench({
  activeConversationId,
  conversations,
  filter,
  filterCounts,
  isLoading = false,
  isRoutingPending,
  onFilterChange,
  onOpenConversation,
  pendingConversationId,
  searchValue,
  onSearchValueChange
}: QueueWorkbenchProps) {
  const hasSearchQuery = Boolean(searchValue.trim());

  return (
    <div className="queue-panel-shell">
      <div className="queue-panel-header">
        <InboxQueueHeader
          helperText="Recent conversations"
          title="Inbox queue"
          visibleCount={conversations.length}
        />
      </div>

      <QueueToolbar
        counts={filterCounts}
        onChange={onFilterChange}
        onSearchValueChange={onSearchValueChange}
        searchValue={searchValue}
        value={filter}
      />

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
