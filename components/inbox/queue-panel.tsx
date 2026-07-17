"use client";

import { QueueWorkbench } from "@/components/inbox/queue-workbench";
import type { InboxConversation } from "@/components/inbox/types";
import type { RefObject } from "react";

type QueuePanelProps = {
  activeConversationId: string | null;
  conversations: InboxConversation[];
  unreadCount: number;
  isFilterMenuOpen: boolean;
  isLoading?: boolean;
  isRoutingPending: boolean;
  onToggleFilterMenu: () => void;
  onOpenConversation: (conversationId: string) => void;
  onSearchValueChange: (value: string) => void;
  pendingConversationId: string | null;
  hasSearchQuery: boolean;
  searchValue: string;
  toolbarFilterButtonRef: RefObject<HTMLButtonElement | null>;
};

export function InboxQueuePanel({
  activeConversationId,
  conversations,
  unreadCount,
  isFilterMenuOpen,
  isLoading = false,
  isRoutingPending,
  hasSearchQuery,
  onToggleFilterMenu,
  onOpenConversation,
  onSearchValueChange,
  pendingConversationId,
  searchValue,
  toolbarFilterButtonRef
}: QueuePanelProps) {
  return (
    <article className="inbox-column inbox-list-panel">
      <QueueWorkbench
        activeConversationId={activeConversationId}
        conversations={conversations}
        hasSearchQuery={hasSearchQuery}
        isLoading={isLoading}
        isRoutingPending={isRoutingPending}
        onOpenConversation={onOpenConversation}
        onSearchValueChange={onSearchValueChange}
        pendingConversationId={pendingConversationId}
        searchValue={searchValue}
        unreadCount={unreadCount}
        isFilterMenuOpen={isFilterMenuOpen}
        onToggleFilterMenu={onToggleFilterMenu}
        toolbarFilterButtonRef={toolbarFilterButtonRef}
      />
    </article>
  );
}
