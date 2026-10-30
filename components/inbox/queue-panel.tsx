"use client";

import { QueueWorkbench } from "@/components/inbox/queue-workbench";
import { ChevronLeftIcon } from "@/components/inbox/icons";
import type { InboxConversation, InboxFilterCounts, InboxFilterKey } from "@/components/inbox/types";
import type { RefObject } from "react";

type QueuePanelProps = {
  activeConversationId: string | null;
  activeFilter: InboxFilterKey;
  conversations: InboxConversation[];
  filterCounts: InboxFilterCounts;
  isFilterMenuOpen: boolean;
  isLoading?: boolean;
  hasMore: boolean;
  isLoadingMore: boolean;
  loadedCount: number;
  isRoutingPending: boolean;
  onToggleFilterMenu: () => void;
  onOpenConversation: (conversationId: string) => void;
  onLoadMore: () => void;
  onSelectFilter: (filter: InboxFilterKey) => void;
  onSearchValueChange: (value: string) => void;
  pendingConversationId: string | null;
  hasSearchQuery: boolean;
  onHideQueue?: () => void;
  searchValue: string;
  totalCount: number;
  toolbarFilterButtonRef: RefObject<HTMLButtonElement | null>;
};

export function InboxQueuePanel({
  activeConversationId,
  activeFilter,
  conversations,
  filterCounts,
  isFilterMenuOpen,
  isLoading = false,
  isRoutingPending,
  hasSearchQuery,
  hasMore,
  isLoadingMore,
  loadedCount,
  onHideQueue,
  onToggleFilterMenu,
  onOpenConversation,
  onLoadMore,
  onSelectFilter,
  onSearchValueChange,
  pendingConversationId,
  searchValue,
  totalCount,
  toolbarFilterButtonRef
}: QueuePanelProps) {
  return (
    <article className="inbox-column inbox-list-panel">
      {onHideQueue ? (
        <button aria-label="Hide conversation list" className="inbox-queue-collapse-button" onClick={onHideQueue} type="button">
          <ChevronLeftIcon />
        </button>
      ) : null}
      <QueueWorkbench
        activeConversationId={activeConversationId}
        activeFilter={activeFilter}
        conversations={conversations}
        filterCounts={filterCounts}
        hasSearchQuery={hasSearchQuery}
        isLoading={isLoading}
        hasMore={hasMore}
        isLoadingMore={isLoadingMore}
        loadedCount={loadedCount}
        isRoutingPending={isRoutingPending}
        onOpenConversation={onOpenConversation}
        onLoadMore={onLoadMore}
        onSelectFilter={onSelectFilter}
        onSearchValueChange={onSearchValueChange}
        pendingConversationId={pendingConversationId}
        searchValue={searchValue}
        totalCount={totalCount}
        isFilterMenuOpen={isFilterMenuOpen}
        onToggleFilterMenu={onToggleFilterMenu}
        toolbarFilterButtonRef={toolbarFilterButtonRef}
      />
    </article>
  );
}
