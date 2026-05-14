"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { INBOX_LAYERS } from "@/components/inbox/layers";
import {
  addMalaysiaDays,
  formatMalaysiaDateTimeLocalInput,
  parseMalaysiaDateTimeLocalInput
} from "@/lib/malaysia-time";

type ScheduleSendDialogProps = {
  initialValue?: string | null;
  isOpen: boolean;
  isPending: boolean;
  onClose: () => void;
  onSave: (value: string) => void;
};

const quickOptions = [
  { label: "30m", getValue: () => new Date(Date.now() + 30 * 60 * 1000) },
  { label: "2h", getValue: () => new Date(Date.now() + 2 * 60 * 60 * 1000) },
  {
    label: "Tomorrow 09:00",
    getValue: () => addMalaysiaDays(new Date(), 1, { hour: 9, minute: 0, second: 0 })
  },
  {
    label: "Tomorrow 14:00",
    getValue: () => addMalaysiaDays(new Date(), 1, { hour: 14, minute: 0, second: 0 })
  }
] as const;

export function ScheduleSendDialog({
  initialValue = null,
  isOpen,
  isPending,
  onClose,
  onSave
}: ScheduleSendDialogProps) {
  const [value, setValue] = useState("");

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setValue(
      formatMalaysiaDateTimeLocalInput(initialValue ? new Date(initialValue) : new Date(Date.now() + 60 * 60 * 1000))
    );
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

  const minValue = useMemo(() => formatMalaysiaDateTimeLocalInput(new Date(Date.now() + 5 * 60 * 1000)), []);

  if (!isOpen) {
    return null;
  }

  const submit = () => {
    if (!value) {
      return;
    }

    const nextDate = parseMalaysiaDateTimeLocalInput(value);
    if (!nextDate || Number.isNaN(nextDate.getTime())) {
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
            <strong>Schedule message</strong>
            <p>Choose when this reply should be sent to the customer.</p>
          </div>
          <button aria-label="Close schedule dialog" className="inbox-dialog-close" onClick={onClose} type="button">
            x
          </button>
        </div>

        <div className="inbox-dialog-body">
          <div className="inbox-dialog-presets">
            {quickOptions.map((option) => (
              <button
                className="inbox-dialog-preset"
                key={option.label}
                onClick={() => setValue(formatMalaysiaDateTimeLocalInput(option.getValue()))}
                type="button"
              >
                {option.label}
              </button>
            ))}
          </div>

          <label className="inbox-dialog-field">
            <span>Send at</span>
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
          <button className="inbox-dialog-secondary" disabled={isPending} onClick={onClose} type="button">
            Cancel
          </button>
          <button className="inbox-dialog-primary" disabled={isPending || !value} onClick={submit} type="button">
            {isPending ? "Scheduling..." : "Schedule send"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
