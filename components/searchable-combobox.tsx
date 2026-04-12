"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { PortalDropdown } from "@/components/inbox/portal-dropdown";

type SearchableComboboxProps = {
  disabled?: boolean;
  emptyText: string;
  onCommit?: (value: string) => string;
  onValueChange: (value: string) => void;
  options: string[];
  placeholder?: string;
  value: string;
};

export function SearchableCombobox({
  disabled = false,
  emptyText,
  onCommit,
  onValueChange,
  options,
  placeholder,
  value
}: SearchableComboboxProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState(value);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  const filteredOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    if (!normalizedQuery) {
      return options;
    }

    return options.filter((option) => option.toLowerCase().includes(normalizedQuery));
  }, [options, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  const commitValue = () => {
    const nextValue = onCommit ? onCommit(query) : query.trim();
    setQuery(nextValue);
    onValueChange(nextValue);
    setIsOpen(false);
    return nextValue;
  };

  const selectOption = (option: string) => {
    setQuery(option);
    onValueChange(option);
    setIsOpen(false);
  };

  const activeOptionId = filteredOptions[activeIndex]
    ? `${inputId}-option-${activeIndex}`
    : undefined;

  return (
    <>
      <input
        aria-activedescendant={isOpen ? activeOptionId : undefined}
        aria-autocomplete="list"
        aria-controls={`${inputId}-listbox`}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        className="lead-record-input searchable-combobox-input"
        disabled={disabled}
        onBlur={() => {
          window.setTimeout(() => {
            commitValue();
          }, 0);
        }}
        onChange={(event) => {
          const nextValue = event.target.value;
          setQuery(nextValue);
          onValueChange(nextValue);
          setIsOpen(true);
        }}
        onFocus={() => {
          if (!disabled) {
            setIsOpen(true);
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setIsOpen(true);
            setActiveIndex((current) => Math.min(current + 1, Math.max(filteredOptions.length - 1, 0)));
            return;
          }

          if (event.key === "ArrowUp") {
            event.preventDefault();
            setIsOpen(true);
            setActiveIndex((current) => Math.max(current - 1, 0));
            return;
          }

          if (event.key === "Enter") {
            event.preventDefault();
            if (isOpen && filteredOptions[activeIndex]) {
              selectOption(filteredOptions[activeIndex]);
              return;
            }

            commitValue();
            return;
          }

          if (event.key === "Escape") {
            setIsOpen(false);
          }
        }}
        placeholder={placeholder}
        ref={inputRef}
        role="combobox"
        type="text"
        value={query}
      />

      <PortalDropdown
        align="start"
        anchorRef={inputRef}
        className="searchable-combobox-portal"
        matchTriggerWidth
        onClose={() => {
          commitValue();
        }}
        open={isOpen && !disabled}
      >
        <div className="searchable-combobox-menu" id={`${inputId}-listbox`} role="listbox">
          {filteredOptions.length ? (
            filteredOptions.map((option, index) => (
              <button
                aria-selected={index === activeIndex}
                className={`searchable-combobox-option${index === activeIndex ? " active" : ""}`}
                id={`${inputId}-option-${index}`}
                key={option}
                onMouseDown={(event) => {
                  event.preventDefault();
                  selectOption(option);
                }}
                type="button"
              >
                {option}
              </button>
            ))
          ) : (
            <div className="searchable-combobox-empty">{emptyText}</div>
          )}
        </div>
      </PortalDropdown>
    </>
  );
}
