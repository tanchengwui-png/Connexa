"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { INBOX_LAYERS } from "@/components/inbox/layers";

type SnoozeDialogProps = {
  isOpen: boolean;
  isPending: boolean;
  initialValue: string | null;
  onClear: () => void;
  onClose: () => void;
  onSave: (value: string) => void;
};

const quickOptions = [
  { label: "30m", getValue: () => new Date(Date.now() + 30 * 60 * 1000) },
  { label: "1h", getValue: () => new Date(Date.now() + 60 * 60 * 1000) },
  { label: "2h", getValue: () => new Date(Date.now() + 2 * 60 * 60 * 1000) },
  {
    label: "Tomorrow 09:00",
    getValue: () => {
      const next = new Date();
      next.setDate(next.getDate() + 1);
      next.setHours(9, 0, 0, 0);
      return next;
    }
  },
  {
    label: "Next week 09:00",
    getValue: () => {
      const next = new Date();
      next.setDate(next.getDate() + 7);
      next.setHours(9, 0, 0, 0);
      return next;
    }
  }
] as const;

export function SnoozeDialog({
  isOpen,
  isPending,
  initialValue,
  onClear,
  onClose,
  onSave
}: SnoozeDialogProps) {
  const [value, setValue] = useState("");

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setValue(toDateTimeLocalValue(initialValue ? new Date(initialValue) : new Date(Date.now() + 60 * 60 * 1000)));
  }, [initialValue, isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  const minValue = useMemo(() => toDateTimeLocalValue(new Date()), []);

  if (!isOpen) {
    return null;
  }

  const submit = () => {
    if (!value) {
      return;
    }

    const nextDate = new Date(value);
    if (Number.isNaN(nextDate.getTime())) {
      return;
    }

    onSave(nextDate.toISOString());
  };

  return createPortal(
    <div aria-hidden={!isOpen} className="inbox-dialog-backdrop" onClick={onClose}>
      <div
        aria-modal="true"
        className="inbox-dialog"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        style={{ zIndex: INBOX_LAYERS.modal + 1 }}
      >
        <div className="inbox-dialog-head">
          <div>
            <strong>Snooze conversation</strong>
            <p>Choose when this chat should come back to the queue.</p>
          </div>
          <button aria-label="Close snooze dialog" className="inbox-dialog-close" onClick={onClose} type="button">
            x
          </button>
        </div>

        <div className="inbox-dialog-body">
          <div className="inbox-dialog-presets">
            {quickOptions.map((option) => (
              <button
                className="inbox-dialog-preset"
                key={option.label}
                onClick={() => setValue(toDateTimeLocalValue(option.getValue()))}
                type="button"
              >
                {option.label}
              </button>
            ))}
          </div>

          <label className="inbox-dialog-field">
            <span>Until</span>
            <input
              className="inbox-dialog-input"
              min={minValue}
              onChange={(event) => setValue(event.target.value)}
              type="datetime-local"
              value={value}
            />
          </label>
        </div>

        <div className="inbox-dialog-actions">
          <button className="inbox-dialog-secondary" disabled={isPending} onClick={onClear} type="button">
            Clear
          </button>
          <div className="inbox-dialog-actions-right">
            <button className="inbox-dialog-secondary" disabled={isPending} onClick={onClose} type="button">
              Cancel
            </button>
            <button className="inbox-dialog-primary" disabled={isPending || !value} onClick={submit} type="button">
              {isPending ? "Saving..." : "Save snooze"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

function toDateTimeLocalValue(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  const hours = `${date.getHours()}`.padStart(2, "0");
  const minutes = `${date.getMinutes()}`.padStart(2, "0");

  return `${year}-${month}-${day}T${hours}:${minutes}`;
}
