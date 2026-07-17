"use client";

import { InboxFilterTabs } from "@/components/inbox/inbox-filter-tabs";
import type { InboxCustomFilter, InboxFilterCounts, InboxFilterKey } from "@/components/inbox/types";

type QueueToolbarProps = {
  counts: InboxFilterCounts;
  customFilters: InboxCustomFilter[];
  value: InboxFilterKey;
  onChange: (value: InboxFilterKey) => void;
};

export function QueueToolbar({
  counts,
  customFilters,
  onChange,
  value
}: QueueToolbarProps) {
  return (
    <div className="queue-toolbar">
      <div className="queue-toolbar-tabs">
        <InboxFilterTabs
          counts={counts}
          customFilters={customFilters}
          onChange={onChange}
          value={value}
        />
      </div>
    </div>
  );
}
