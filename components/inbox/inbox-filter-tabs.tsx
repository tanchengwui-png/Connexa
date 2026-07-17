import { useRef, useState } from "react";
import { PortalDropdown } from "@/components/inbox/portal-dropdown";
import { Button, getButtonClassName } from "@/components/ui/button";
import type {
  InboxBuiltInFilterKey,
  InboxCustomFilter,
  InboxFilterCounts,
  InboxFilterKey
} from "@/components/inbox/types";

type InboxFilterTabsProps = {
  counts: InboxFilterCounts;
  customFilters: InboxCustomFilter[];
  value: InboxFilterKey;
  onChange: (value: InboxFilterKey) => void;
};

const PRIMARY_FILTERS: Array<{ key: InboxBuiltInFilterKey; label: string }> = [
  { key: "all", label: "All" },
  { key: "mine", label: "Mine" },
  { key: "unread", label: "Unread" },
];

const OVERFLOW_FILTERS: Array<{ key: InboxBuiltInFilterKey; label: string }> = [
  { key: "snoozed", label: "Snoozed" },
  { key: "assigned-others", label: "Assigned to others" },
  { key: "unassigned", label: "Unowned" },
  { key: "hot", label: "Hot" }
];

export function InboxFilterTabs({
  counts,
  customFilters,
  value,
  onChange
}: InboxFilterTabsProps) {
  const moreButtonRef = useRef<HTMLButtonElement | null>(null);
  const [isMoreOpen, setIsMoreOpen] = useState(false);

  return (
    <div className="inbox-filter-tabs" aria-label="Inbox filters">
      {PRIMARY_FILTERS.map((item) => (
        <Button
          className={`inbox-filter-tab${value === item.key ? " active" : ""}`}
          key={item.key}
          onClick={() => onChange(item.key)}
          role="tab"
          selected={value === item.key}
          variant="toggle"
        >
          <span>{item.label}</span>
        </Button>
      ))}

      <Button
        className={`inbox-filter-tab${
          OVERFLOW_FILTERS.some((item) => item.key === value) || customFilters.some((item) => item.key === value)
            ? " active"
            : ""
        }`}
        onClick={() => setIsMoreOpen((current) => !current)}
        ref={moreButtonRef}
        selected={
          OVERFLOW_FILTERS.some((item) => item.key === value) || customFilters.some((item) => item.key === value)
        }
        variant="toggle"
      >
        <span>More</span>
      </Button>

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
              className={getButtonClassName({
                className: `inbox-menu-item${value === item.key ? " active" : ""}`,
                selected: value === item.key,
                variant: "toggle"
              })}
              key={item.key}
              onClick={() => {
                onChange(item.key);
                setIsMoreOpen(false);
              }}
              type="button"
            >
              <span>{item.label}</span>
              <strong>{counts[item.key] ?? 0}</strong>
            </button>
          ))}
          {customFilters.length ? (
            <>
              <span className="inbox-menu-section-label">Custom categories</span>
              {customFilters.map((item) => (
                <button
                  className={getButtonClassName({
                    className: `inbox-menu-item${value === item.key ? " active" : ""}`,
                    selected: value === item.key,
                    variant: "toggle"
                  })}
                  key={item.key}
                  onClick={() => {
                    onChange(item.key);
                    setIsMoreOpen(false);
                  }}
                  type="button"
                >
                  <span>{item.label}</span>
                  <strong>{counts[item.key] ?? 0}</strong>
                </button>
              ))}
            </>
          ) : null}
        </div>
      </PortalDropdown>
    </div>
  );
}
