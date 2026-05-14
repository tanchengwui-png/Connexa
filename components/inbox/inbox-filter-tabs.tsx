import { useRef, useState } from "react";
import { PortalDropdown } from "@/components/inbox/portal-dropdown";
import type { InboxFilterKey } from "@/components/inbox/types";

type InboxFilterTabsProps = {
  counts: Record<InboxFilterKey, number>;
  value: InboxFilterKey;
  onChange: (value: InboxFilterKey) => void;
};

const PRIMARY_FILTERS: Array<{ key: InboxFilterKey; label: string }> = [
  { key: "all", label: "All" },
  { key: "mine", label: "Mine" },
  { key: "unread", label: "Unread" },
];

const OVERFLOW_FILTERS: Array<{ key: InboxFilterKey; label: string }> = [
  { key: "assigned-others", label: "Assigned to others" },
  { key: "unassigned", label: "Unowned" },
  { key: "hot", label: "Hot" }
];

export function InboxFilterTabs({ counts, value, onChange }: InboxFilterTabsProps) {
  const moreButtonRef = useRef<HTMLButtonElement | null>(null);
  const [isMoreOpen, setIsMoreOpen] = useState(false);

  return (
    <div className="inbox-filter-tabs" aria-label="Inbox filters">
      {PRIMARY_FILTERS.map((item) => (
        <button
          className={`inbox-filter-tab${value === item.key ? " active" : ""}`}
          key={item.key}
          onClick={() => onChange(item.key)}
          type="button"
        >
          <span>{item.label}</span>
        </button>
      ))}

      <button
        className={`inbox-filter-tab${OVERFLOW_FILTERS.some((item) => item.key === value) ? " active" : ""}`}
        onClick={() => setIsMoreOpen((current) => !current)}
        ref={moreButtonRef}
        type="button"
      >
        <span>More</span>
      </button>

      <PortalDropdown
        align="start"
        anchorRef={moreButtonRef}
        className="inbox-portal-menu"
        onClose={() => setIsMoreOpen(false)}
        open={isMoreOpen}
      >
        <div className="inbox-menu-panel">
          <div className="inbox-menu-panel-head">
            <strong>More filters</strong>
            <span>Less-used queue views</span>
          </div>
          {OVERFLOW_FILTERS.map((item) => (
            <button
              className={`inbox-menu-item${value === item.key ? " active" : ""}`}
              key={item.key}
              onClick={() => {
                onChange(item.key);
                setIsMoreOpen(false);
              }}
              type="button"
            >
              <span>{item.label}</span>
              <strong>{counts[item.key]}</strong>
            </button>
          ))}
        </div>
      </PortalDropdown>
    </div>
  );
}
