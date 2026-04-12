"use client";

import { InboxFilterTabs } from "@/components/inbox/inbox-filter-tabs";
import { SearchIcon } from "@/components/inbox/icons";
import type { InboxFilterKey } from "@/components/inbox/types";

type QueueToolbarProps = {
  counts: Record<InboxFilterKey, number>;
  searchValue: string;
  value: InboxFilterKey;
  onChange: (value: InboxFilterKey) => void;
  onSearchValueChange: (value: string) => void;
};

export function QueueToolbar({
  counts,
  onChange,
  onSearchValueChange,
  searchValue,
  value
}: QueueToolbarProps) {
  return (
    <div className="queue-toolbar">
      <div className="queue-toolbar-tabs">
        <InboxFilterTabs counts={counts} onChange={onChange} value={value} />
      </div>

      <div className="queue-toolbar-search-row">
        <label className="inbox-search-field" htmlFor="inbox-search">
          <SearchIcon className="inbox-search-svg" />
          <input
            className="inbox-search-input"
            id="inbox-search"
            onChange={(event) => onSearchValueChange(event.target.value)}
            placeholder="Search name, phone, or message"
            type="text"
            value={searchValue}
          />
        </label>
      </div>
    </div>
  );
}
