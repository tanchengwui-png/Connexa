"use client";

import { QueueWorkbench } from "@/components/inbox/queue-workbench";
import type { InboxConversation, InboxFilterKey } from "@/components/inbox/types";

type QueuePanelProps = {
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

export function InboxQueuePanel({
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
}: QueuePanelProps) {
  return (
    <article className="inbox-column inbox-list-panel">
      <QueueWorkbench
        activeConversationId={activeConversationId}
        conversations={conversations}
        filter={filter}
        filterCounts={filterCounts}
        isLoading={isLoading}
        isRoutingPending={isRoutingPending}
        onFilterChange={onFilterChange}
        onOpenConversation={onOpenConversation}
        pendingConversationId={pendingConversationId}
        searchValue={searchValue}
        onSearchValueChange={onSearchValueChange}
      />
    </article>
  );
}
