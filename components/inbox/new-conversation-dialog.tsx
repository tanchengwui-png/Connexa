"use client";

import { createPortal } from "react-dom";
import { useEffect, useMemo, useState } from "react";
import { INBOX_LAYERS } from "@/components/inbox/layers";
import type { InboxWhatsAppStatus } from "@/components/inbox/types";

type NewConversationDialogProps = {
  channels: InboxWhatsAppStatus["channels"];
  defaultChannelId: string | null;
  isOpen: boolean;
  isPending: boolean;
  initialCountryCode?: string;
  onClose: () => void;
  onSubmit: (input: {
    channelId: string;
    countryCode: string;
    phoneNumber: string;
    displayName: string;
    messageText: string;
  }) => void;
};

export function NewConversationDialog({
  channels,
  defaultChannelId,
  isOpen,
  isPending,
  initialCountryCode = "",
  onClose,
  onSubmit
}: NewConversationDialogProps) {
  const eligibleChannels = useMemo(
    () => channels.filter((channel) => channel.supportsNewNumberConversation),
    [channels]
  );
  const [channelId, setChannelId] = useState("");
  const [countryCode, setCountryCode] = useState(initialCountryCode);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [messageText, setMessageText] = useState("");

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const preferredChannelId =
      (defaultChannelId &&
      eligibleChannels.some((channel) => channel.id === defaultChannelId)
        ? defaultChannelId
        : eligibleChannels.length === 1
          ? eligibleChannels[0].id
          : "") ?? "";

    setChannelId(preferredChannelId);
    setCountryCode(initialCountryCode);
    setPhoneNumber("");
    setDisplayName("");
    setMessageText("");
  }, [defaultChannelId, eligibleChannels, initialCountryCode, isOpen]);

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

  const canSubmit = Boolean(channelId && phoneNumber.trim() && messageText.trim());

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
            <strong>New conversation</strong>
            <p>Start a WhatsApp conversation with a number that is not saved yet.</p>
          </div>
        </div>

        <div className="simulate-inbound-form">
          <label className="lead-record-field lead-record-field-wide">
            <span>WhatsApp number</span>
            <select
              className="lead-record-input"
              disabled={eligibleChannels.length <= 1}
              onChange={(event) => setChannelId(event.target.value)}
              value={channelId}
            >
              <option value="">Select a WhatsApp number</option>
              {eligibleChannels.map((channel) => (
                <option key={channel.id} value={channel.id}>
                  {channel.label}
                </option>
              ))}
            </select>
          </label>

          <label className="lead-record-field">
            <span>Country code</span>
            <input
              className="lead-record-input"
              inputMode="numeric"
              onChange={(event) => setCountryCode(event.target.value)}
              placeholder="60"
              value={countryCode}
            />
          </label>

          <label className="lead-record-field">
            <span>Phone number</span>
            <input
              className="lead-record-input"
              inputMode="tel"
              onChange={(event) => setPhoneNumber(event.target.value)}
              placeholder="123456789"
              value={phoneNumber}
            />
          </label>

          <label className="lead-record-field lead-record-field-wide">
            <span>Contact name (optional)</span>
            <input
              className="lead-record-input"
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="Customer name"
              value={displayName}
            />
          </label>

          <label className="lead-record-field lead-record-field-wide">
            <span>First message</span>
            <textarea
              className="lead-record-input lead-record-textarea"
              onChange={(event) => setMessageText(event.target.value)}
              placeholder="Hi, I’d like to follow up with you."
              value={messageText}
            />
          </label>
        </div>

        <div className="inbox-dialog-actions">
          <div className="inbox-dialog-actions-right">
            <button className="inbox-dialog-secondary" onClick={onClose} type="button">
              Cancel
            </button>
            <button
              className="inbox-dialog-primary"
              disabled={!canSubmit || isPending}
              onClick={() =>
                onSubmit({
                  channelId,
                  countryCode,
                  phoneNumber,
                  displayName,
                  messageText
                })
              }
              type="button"
            >
              {isPending ? "Sending..." : "Send first message"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
