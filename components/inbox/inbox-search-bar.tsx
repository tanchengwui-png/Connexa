"use client";

import { MoreIcon, SearchIcon } from "@/components/inbox/icons";

type InboxSearchBarProps = {
  currentOwnerLabel: string;
  searchValue: string;
  onSearchValueChange: (value: string) => void;
};

export function InboxSearchBar({
  currentOwnerLabel,
  searchValue,
  onSearchValueChange
}: InboxSearchBarProps) {
  return (
    <div className="inbox-search-bar">
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

      <div className="inbox-search-side">
        <div className="inbox-search-actions">
          <button className="inbox-search-tool" type="button">
            Filter
          </button>
          <button className="inbox-search-tool" type="button">
            Sort
          </button>
          <button aria-label="More queue actions" className="inbox-search-tool icon-only" type="button">
            <MoreIcon />
          </button>
        </div>

        <div className="inbox-search-owner">
          <span>Owner</span>
          <strong>{currentOwnerLabel}</strong>
        </div>
      </div>
    </div>
  );
}
