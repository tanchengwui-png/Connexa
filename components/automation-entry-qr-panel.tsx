"use client";

import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";

type AutomationEntryQrPanelProps = {
  liveKeywordTesting: {
    connectionStatus: string;
    displayName: string | null;
    phoneNumber: string | null;
  };
  keywordRules: Array<{
    id: string;
    name: string;
    keyword: string | null;
    matchLabel: string;
  }>;
};

export function AutomationEntryQrPanel({
  liveKeywordTesting,
  keywordRules
}: AutomationEntryQrPanelProps) {
  const [selectedRuleId, setSelectedRuleId] = useState<string>(keywordRules[0]?.id ?? "");
  const [message, setMessage] = useState(deriveSuggestedKeywordMessage(keywordRules[0]?.keyword ?? null));
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null);
  const selectedRule = keywordRules.find((rule) => rule.id === selectedRuleId) ?? null;
  const liveTestPhone = normalizePhone(liveKeywordTesting.phoneNumber);
  const chatLink = useMemo(() => buildWhatsAppClickToChatUrl(liveTestPhone, message), [liveTestPhone, message]);
  const canGenerateQr = Boolean(liveTestPhone && message.trim());

  useEffect(() => {
    if (!canGenerateQr) {
      setQrCodeDataUrl(null);
      return;
    }

    let cancelled = false;

    QRCode.toDataURL(chatLink, {
      width: 320,
      margin: 1
    })
      .then((value) => {
        if (!cancelled) {
          setQrCodeDataUrl(value);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setQrCodeDataUrl(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [canGenerateQr, chatLink]);

  return (
    <article className="content-card automation-settings-card">
      <div className="card-header">
        <div>
          <h3 className="card-title">Entry QR</h3>
          <p className="muted">
            Generate a separate customer-facing WhatsApp QR that opens a chat to Connexa and lets the normal keyword rules match the message.
          </p>
        </div>
      </div>

      <section className="lead-record-panel">
        <div className="lead-record-section-head">
          <strong>Live WhatsApp entry</strong>
          <span>This module does not change rule logic. It only creates a chat entry point into the existing inbound automation flow.</span>
        </div>

        <div className="lead-record-form-grid">
          <label className="lead-record-field">
            <span>Connexa number</span>
            <input
              className="lead-record-input"
              readOnly
              value={
                liveTestPhone
                  ? `+${liveTestPhone}`
                  : liveKeywordTesting.connectionStatus === "READY"
                    ? "Connected, but no number detected"
                    : "Connect WhatsApp first"
              }
            />
          </label>
          <label className="lead-record-field">
            <span>Connection</span>
            <input
              className="lead-record-input"
              readOnly
              value={liveKeywordTesting.displayName?.trim() || liveKeywordTesting.connectionStatus}
            />
          </label>
          <label className="lead-record-field lead-record-field-wide">
            <span>Target rule</span>
            <select
              className="lead-record-input app-select"
              onChange={(event) => {
                const nextRuleId = event.target.value;
                setSelectedRuleId(nextRuleId);
                const nextRule = keywordRules.find((rule) => rule.id === nextRuleId) ?? null;
                setMessage(deriveSuggestedKeywordMessage(nextRule?.keyword ?? null));
              }}
              value={selectedRuleId}
            >
              {keywordRules.length === 0 ? <option value="">No enabled keyword rules</option> : null}
              {keywordRules.map((rule) => (
                <option key={rule.id} value={rule.id}>
                  {rule.name} · {rule.matchLabel}
                </option>
              ))}
            </select>
          </label>
          <label className="lead-record-field lead-record-field-wide">
            <span>Prefilled message</span>
            <input
              className="lead-record-input"
              onChange={(event) => setMessage(event.target.value)}
              placeholder="hello"
              value={message}
            />
          </label>
        </div>

        {!liveTestPhone ? (
          <div className="table-subtle">
            A live entry QR needs the workspace WhatsApp number. Connect the WhatsApp channel first.
          </div>
        ) : null}

        {liveTestPhone && qrCodeDataUrl ? (
          <div className="wa-qr-panel">
            <div className="wa-qr-panel-head">
              <div>
                <strong>Scan and message Connexa</strong>
                <span>
                  Scan this QR from another phone to open WhatsApp and start a chat with Connexa at +{liveTestPhone}.
                  The trigger message will already be filled in and ready to send.
                </span>
              </div>
              {selectedRule ? (
                <div className="table-subtle">
                  {selectedRule.name}
                  {selectedRule.keyword ? ` · ${selectedRule.keyword}` : ""}
                </div>
              ) : null}
            </div>
            <img alt="WhatsApp entry QR code" className="wa-qr-image" src={qrCodeDataUrl} />
            <div className="table-subtle">
              After sending the message, the existing inbound automation rules handle it exactly the same as a normal customer message.
            </div>
            <div className="composer-actions">
              <a className="button button-secondary" href={chatLink} rel="noreferrer" target="_blank">
                Open chat link
              </a>
              <a
                className="button button-secondary"
                download={`connexa-entry-qr-${selectedRule?.name?.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "rule"}.png`}
                href={qrCodeDataUrl}
              >
                Download QR
              </a>
            </div>
          </div>
        ) : null}
      </section>
    </article>
  );
}

function normalizePhone(value: string | null) {
  return value?.replace(/[^\d]/g, "") ?? "";
}

function buildWhatsAppClickToChatUrl(phone: string, message: string) {
  const params = new URLSearchParams();
  if (message.trim()) {
    params.set("text", message.trim());
  }

  return `https://wa.me/${phone}${params.toString() ? `?${params.toString()}` : ""}`;
}

function deriveSuggestedKeywordMessage(keyword: string | null) {
  const value = keyword?.trim() ?? "";

  if (!value) {
    return "";
  }

  return (
    value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)[0] ?? value
  );
}
