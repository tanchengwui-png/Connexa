"use client";

import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
import { INBOX_LAYERS } from "@/components/inbox/layers";
import type { InboxSelectedConversation } from "@/components/inbox/types";
import { formatMalaysiaDateTimeLocalInput, parseMalaysiaDateTimeLocalInput } from "@/lib/malaysia-time";

type SimulateInboundDialogProps = {
  isOpen: boolean;
  isPending: boolean;
  selectedConversation: InboxSelectedConversation;
  onClose: () => void;
  onSubmit: (input: {
    body: string;
    conversationId?: string | null;
    phone?: string | null;
    displayName?: string | null;
    sentAt?: string | null;
    ignoreAutomationPause?: boolean;
  }) => void;
};

export function SimulateInboundDialog({
  isOpen,
  isPending,
  selectedConversation,
  onClose,
  onSubmit
}: SimulateInboundDialogProps) {
  const [useSelectedConversation, setUseSelectedConversation] = useState(Boolean(selectedConversation));
  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [body, setBody] = useState("");
  const [sentAt, setSentAt] = useState("");
  const [ignoreAutomationPause, setIgnoreAutomationPause] = useState(true);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setUseSelectedConversation(Boolean(selectedConversation));
    setDisplayName(selectedConversation?.contactName ?? "");
    setPhone(selectedConversation?.phone ?? "");
    setBody("");
    setSentAt(getCurrentLocalDateTimeValue());
    setIgnoreAutomationPause(true);
  }, [isOpen, selectedConversation]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="inbox-dialog-backdrop" onClick={onClose} style={{ zIndex: INBOX_LAYERS.modal }}>
      <div
        aria-modal="true"
        className="inbox-dialog confirmation-dialog simulate-inbound-dialog"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        style={{ zIndex: INBOX_LAYERS.modal + 1 }}
      >
        <div className="inbox-dialog-head">
          <div>
            <strong>Simulate inbound message</strong>
            <p>Create a test customer message and run the real automation pipeline without Meta costs.</p>
          </div>
        </div>

        <div className="simulate-inbound-form">
          {selectedConversation ? (
            <label className="lead-record-field lead-record-field-wide automation-toggle-row">
              <input
                checked={useSelectedConversation}
                onChange={(event) => setUseSelectedConversation(event.target.checked)}
                type="checkbox"
              />
              <span>
                Use selected conversation
                <strong className="simulate-inbound-inline-label">
                  {selectedConversation.isGroup
                    ? selectedConversation.contactName
                    : `${selectedConversation.contactName} (${selectedConversation.phone})`}
                </strong>
              </span>
            </label>
          ) : null}

          {!useSelectedConversation ? (
            <>
              <label className="lead-record-field">
                <span>Contact name</span>
                <input
                  className="lead-record-input"
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="Test buyer"
                  value={displayName}
                />
              </label>
              <label className="lead-record-field">
                <span>Phone</span>
                <input
                  className="lead-record-input"
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder="+60123456789"
                  value={phone}
                />
              </label>
            </>
          ) : null}

          <label className="lead-record-field lead-record-field-wide">
            <span>Message time</span>
            <input
              className="lead-record-input"
              onChange={(event) => setSentAt(event.target.value)}
              type="datetime-local"
              value={sentAt}
            />
          </label>

          <label className="lead-record-field lead-record-field-wide">
            <span>Incoming message</span>
            <textarea
              className="lead-record-input lead-record-textarea"
              onChange={(event) => setBody(event.target.value)}
              placeholder="Hi, I’m looking to buy a condo in Rawang around 500k."
              value={body}
            />
          </label>

          <label className="lead-record-field lead-record-field-wide automation-toggle-row">
            <input
              checked={ignoreAutomationPause}
              onChange={(event) => setIgnoreAutomationPause(event.target.checked)}
              type="checkbox"
            />
            <span>
              Ignore automation pause
              <strong className="simulate-inbound-inline-label">
                Use this for testing even if the conversation was previously handled by an agent.
              </strong>
            </span>
          </label>
        </div>

        <div className="inbox-dialog-actions">
          <div className="inbox-dialog-actions-right">
            <button className="inbox-dialog-secondary" onClick={onClose} type="button">
              Cancel
            </button>
            <button
              className="inbox-dialog-primary"
              disabled={isPending}
              onClick={() =>
                onSubmit({
                  body,
                  conversationId: useSelectedConversation ? selectedConversation?.id ?? null : null,
                  displayName: useSelectedConversation ? null : displayName,
                  phone: useSelectedConversation ? null : phone,
                  sentAt: sentAt ? parseMalaysiaDateTimeLocalInput(sentAt)?.toISOString() ?? null : null,
                  ignoreAutomationPause
                })
              }
              type="button"
            >
              {isPending ? "Running..." : "Run simulation"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

function getCurrentLocalDateTimeValue() {
  return formatMalaysiaDateTimeLocalInput(new Date());
}
