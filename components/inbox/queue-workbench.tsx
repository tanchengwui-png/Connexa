"use client";

import { ConversationList } from "@/components/inbox/conversation-list";
import { MoreIcon, SearchIcon } from "@/components/inbox/icons";
import { InboxQueueHeader } from "@/components/inbox/queue-header";
import type { InboxConversation, InboxFilterCounts, InboxFilterKey } from "@/components/inbox/types";
import { useEffect, useRef, type RefObject } from "react";

type QueueWorkbenchProps = {
  activeConversationId: string | null;
  activeFilter: InboxFilterKey;
  conversations: InboxConversation[];
  filterCounts: InboxFilterCounts;
  hasSearchQuery: boolean;
  hasMore: boolean;
  isLoadingMore: boolean;
  loadedCount: number;
  isLoading?: boolean;
  isRoutingPending: boolean;
  onOpenConversation: (conversationId: string) => void;
  onLoadMore: () => void;
  onSelectFilter: (filter: InboxFilterKey) => void;
  onSearchValueChange: (value: string) => void;
  pendingConversationId: string | null;
  searchValue: string;
  totalCount: number;
  isFilterMenuOpen: boolean;
  onToggleFilterMenu: () => void;
  toolbarFilterButtonRef: RefObject<HTMLButtonElement | null>;
};

export function QueueWorkbench({
  activeConversationId,
  activeFilter,
  conversations,
  filterCounts,
  hasSearchQuery,
  hasMore,
  isLoadingMore,
  loadedCount,
  isLoading = false,
  isRoutingPending,
  onOpenConversation,
  onLoadMore,
  onSelectFilter,
  onSearchValueChange,
  pendingConversationId,
  searchValue,
  totalCount,
  isFilterMenuOpen,
  onToggleFilterMenu,
  toolbarFilterButtonRef
}: QueueWorkbenchProps) {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const sentinel = loadMoreSentinelRef.current;
    const root = scrollContainerRef.current;
    if (!sentinel || !root || !hasMore || hasSearchQuery || isLoadingMore) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          observer.disconnect();
          onLoadMore();
        }
      },
      { root, rootMargin: "160px 0px", threshold: 0 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, hasSearchQuery, isLoadingMore, onLoadMore]);

  return (
    <div className="queue-panel-shell">
      <div className="queue-panel-header">
        <InboxQueueHeader
          helperText=""
          isFiltered={activeFilter !== "all" || hasSearchQuery}
          loadedCount={loadedCount}
          title="Chats"
          totalCount={totalCount}
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
            placeholder="Search name, number or message..."
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

      <div aria-label="Conversation filters" className="inbox-queue-quick-tabs" role="tablist">
        {([
          ["all", "All"],
          ["unread", "Unread"],
          ["groups", "Groups"],
          ["mine", "Mine"]
        ] as const).map(([key, label]) => (
          <button
            aria-selected={activeFilter === key}
            className={activeFilter === key ? "active" : ""}
            key={key}
            onClick={() => onSelectFilter(key)}
            role="tab"
            type="button"
          >
            <span>{label}</span>
            {key === "unread" && filterCounts.unread > 0 ? <strong>{filterCounts.unread}</strong> : null}
          </button>
        ))}
      </div>

      {/* Queue list is the only scroll container in the left column. */}
      <div className="queue-panel-scroll" ref={scrollContainerRef}>
        <ConversationList
          activeConversationId={activeConversationId}
          conversations={conversations}
          hasSearchQuery={hasSearchQuery}
          isLoading={isLoading}
          isRoutingPending={isRoutingPending}
          onOpenConversation={onOpenConversation}
          pendingConversationId={pendingConversationId}
        />
        {hasMore && !hasSearchQuery ? (
          <div className="inbox-auto-load" ref={loadMoreSentinelRef}>
            <button
              className="button button-secondary inbox-load-more"
              disabled={isLoadingMore}
              onClick={onLoadMore}
              type="button"
            >
              {isLoadingMore ? "Loading older chats…" : "Load older chats"}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
