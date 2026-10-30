"use client";

import { getCountries, getCountryCallingCode, parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/max";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { PortalDropdown } from "@/components/inbox/portal-dropdown";

type PairingResult = {
  pairingCode: string;
  generatedAt: string;
  expiresAt: string;
  maskedPhoneNumber: string;
  status: "PENDING_PHONE_LINK";
};

type PairingConnectionStatus = "AUTHENTICATED" | "CONNECTED" | "SYNCING_HISTORY" | "READY" | "AUTH_FAILED" | "ERROR" | "DISCONNECTED" | null;

type WebPhonePairingPanelProps = {
  channelId: string;
  onPairingConnected: () => void;
  onUseQrCode: () => void;
};

type CountryOption = {
  code: CountryCode;
  callingCode: string;
  name: string;
};

const fallbackCountry: CountryCode = "MY";

function countryFlag(countryCode: string) {
  return countryCode.replace(/./g, (character) => String.fromCodePoint(127397 + character.charCodeAt(0)));
}

function getCountryName(countryCode: CountryCode) {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(countryCode) ?? countryCode;
  } catch {
    return countryCode;
  }
}

function formatExpiry(expiresAt: string) {
  const milliseconds = new Date(expiresAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(milliseconds / 1000));
}

function formatPairingCode(pairingCode: string) {
  const compactCode = pairingCode.replace(/[^a-z0-9]/gi, "");
  return compactCode.length === 8 ? `${compactCode.slice(0, 4)}-${compactCode.slice(4)}` : pairingCode;
}

export function WebPhonePairingPanel({ channelId, onPairingConnected, onUseQrCode }: WebPhonePairingPanelProps) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const listboxId = useId();
  const [countryCode, setCountryCode] = useState<CountryCode>(fallbackCountry);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [isCountriesOpen, setIsCountriesOpen] = useState(false);
  const [countrySearch, setCountrySearch] = useState("");
  const [activeCountryIndex, setActiveCountryIndex] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pairing, setPairing] = useState<PairingResult | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<PairingConnectionStatus>(null);
  const [error, setError] = useState<string | null>(null);
  const [secondsRemaining, setSecondsRemaining] = useState<number | null>(null);
  const [cooldownSeconds, setCooldownSeconds] = useState<number | null>(null);
  const hasReportedPairingSuccessRef = useRef(false);

  const countries = useMemo<CountryOption[]>(
    () => getCountries().map((code) => ({ code, callingCode: `+${getCountryCallingCode(code)}`, name: getCountryName(code) })),
    []
  );
  const selectedCountry = countries.find((country) => country.code === countryCode) ?? countries.find((country) => country.code === fallbackCountry)!;
  const filteredCountries = useMemo(() => {
    const query = countrySearch.trim().replace(/^\+/, "").toLowerCase();
    if (!query) return countries;
    return countries.filter((country) =>
      [country.name, country.code, country.callingCode.replace("+", "")].some((value) => value.toLowerCase().includes(query))
    );
  }, [countries, countrySearch]);

  useEffect(() => setActiveCountryIndex(0), [countrySearch]);

  useEffect(() => {
    if (!isCountriesOpen) return;
    window.setTimeout(() => searchRef.current?.focus(), 0);
  }, [isCountriesOpen]);

  useEffect(() => {
    if (!pairing?.expiresAt || !pairing.generatedAt) {
      setSecondsRemaining(null);
      setCooldownSeconds(null);
      return;
    }
    const update = () => {
      setSecondsRemaining(formatExpiry(pairing.expiresAt));
      setCooldownSeconds(Math.max(0, 30 - Math.ceil((Date.now() - new Date(pairing.generatedAt).getTime()) / 1000)));
    };
    update();
    const interval = window.setInterval(update, 1_000);
    return () => window.clearInterval(interval);
  }, [pairing?.expiresAt, pairing?.generatedAt]);

  useEffect(() => {
    if (!pairing) {
      setConnectionStatus(null);
      return;
    }

    let isCancelled = false;
    const refreshConnectionStatus = async () => {
      const response = await fetch(`/api/settings/whatsapp?channelId=${encodeURIComponent(channelId)}`, { method: "GET" });
      if (!response.ok || isCancelled) return;

      const payload = (await response.json().catch(() => null)) as {
        status?: { runtimeStatus?: string; isSyncingHistory?: boolean };
      } | null;
      const nextStatus = payload?.status?.isSyncingHistory ? "SYNCING_HISTORY" : payload?.status?.runtimeStatus;

      if (
        nextStatus === "AUTHENTICATED" ||
        nextStatus === "CONNECTED" ||
        nextStatus === "SYNCING_HISTORY" ||
        nextStatus === "READY" ||
        nextStatus === "AUTH_FAILED" ||
        nextStatus === "ERROR" ||
        nextStatus === "DISCONNECTED"
      ) {
        setConnectionStatus(nextStatus);
      }
    };

    void refreshConnectionStatus();
    const interval = window.setInterval(() => void refreshConnectionStatus(), 3_000);
    return () => {
      isCancelled = true;
      window.clearInterval(interval);
    };
  }, [channelId, pairing]);

  function closeCountries(restoreFocus = true) {
    setIsCountriesOpen(false);
    if (restoreFocus) window.setTimeout(() => buttonRef.current?.focus(), 0);
  }

  function selectCountry(country: CountryOption) {
    setCountryCode(country.code);
    setCountrySearch("");
    closeCountries();
  }

  function handlePhoneNumberChange(value: string) {
    setPhoneNumber(value);
    if (!value.trim().startsWith("+")) return;
    const parsed = parsePhoneNumberFromString(value);
    if (parsed?.country) setCountryCode(parsed.country);
  }

  async function requestCode() {
    if (isSubmitting) return;
    setError(null);
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/settings/whatsapp/pairing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelId, countryCode, phoneNumber })
      });
      const payload = (await response.json().catch(() => null)) as { pairing?: PairingResult; error?: string } | null;
      if (!response.ok || !payload?.pairing) {
        setError(payload?.error ?? "Unable to generate a WhatsApp pairing code.");
        return;
      }
      setPairing(payload.pairing);
      setConnectionStatus(null);
    } finally {
      setIsSubmitting(false);
    }
  }

  const isExpired = secondsRemaining === 0;
  const isPairingSuccessful = ["AUTHENTICATED", "CONNECTED", "SYNCING_HISTORY", "READY"].includes(connectionStatus ?? "");

  useEffect(() => {
    if (!isPairingSuccessful || hasReportedPairingSuccessRef.current) {
      return;
    }

    hasReportedPairingSuccessRef.current = true;
    onPairingConnected();
  }, [isPairingSuccessful, onPairingConnected]);

  return (
    <section className="content-card settings-dark-panel wa-phone-pairing-panel" aria-labelledby="phone-pairing-title">
      <div className="wa-step-header">
        <div>
          <span className="wa-step-kicker">Phone pairing</span>
          <h2 id="phone-pairing-title">Link with phone number</h2>
          <p>Generate a one-time code for this personal WhatsApp Web connection.</p>
        </div>
      </div>

      <label className="control-block" htmlFor={`${listboxId}-phone`}>
        <span className="control-label">Phone number</span>
        <div className="wa-phone-input">
          <button
            aria-controls={listboxId}
            aria-expanded={isCountriesOpen}
            aria-haspopup="listbox"
            aria-label={`Country: ${selectedCountry.name}, ${selectedCountry.callingCode}`}
            className="wa-phone-country-trigger"
            onClick={() => setIsCountriesOpen((current) => !current)}
            ref={buttonRef}
            type="button"
          >
            <span aria-hidden="true">{countryFlag(selectedCountry.code)}</span>
            <span>{selectedCountry.callingCode}</span>
            <span aria-hidden="true">⌄</span>
          </button>
          <input
            autoComplete="tel-national"
            id={`${listboxId}-phone`}
            inputMode="tel"
            onChange={(event) => handlePhoneNumberChange(event.target.value)}
            placeholder="Phone number"
            type="tel"
            value={phoneNumber}
          />
        </div>
      </label>

      <PortalDropdown
        align="start"
        anchorRef={buttonRef}
        className="wa-phone-country-dropdown"
        onClose={() => closeCountries(false)}
        open={isCountriesOpen}
      >
        <div className="wa-phone-country-menu" id={listboxId} role="dialog" aria-label="Choose country">
          <input
            aria-controls={`${listboxId}-options`}
            aria-label="Search country or code"
            className="control-input wa-phone-country-search"
            onChange={(event) => setCountrySearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                closeCountries();
              } else if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveCountryIndex((current) => Math.min(current + 1, filteredCountries.length - 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveCountryIndex((current) => Math.max(current - 1, 0));
              } else if (event.key === "Enter" && filteredCountries[activeCountryIndex]) {
                event.preventDefault();
                selectCountry(filteredCountries[activeCountryIndex]);
              }
            }}
            placeholder="Search country or code"
            ref={searchRef}
            role="combobox"
            value={countrySearch}
          />
          <div id={`${listboxId}-options`} role="listbox" aria-label="Countries">
            {filteredCountries.map((country, index) => (
              <button
                aria-selected={country.code === countryCode}
                className={`wa-phone-country-option${index === activeCountryIndex ? " active" : ""}`}
                key={country.code}
                onMouseDown={(event) => {
                  event.preventDefault();
                  selectCountry(country);
                }}
                role="option"
                type="button"
              >
                <span aria-hidden="true">{countryFlag(country.code)}</span>
                <span>{country.name}</span>
                <span>{country.callingCode}</span>
              </button>
            ))}
          </div>
        </div>
      </PortalDropdown>

      {error ? <p className="form-error" role="alert">{error}</p> : null}

      {pairing ? (
        <>
          <div className="wa-phone-pairing-code" role="status">
            <span className="wa-step-kicker">Pairing code</span>
            <strong>{formatPairingCode(pairing.pairingCode)}</strong>
            <p>For {pairing.maskedPhoneNumber}. {isExpired ? "This code has expired." : `Expires in ${secondsRemaining ?? 0} seconds.`}</p>
            <p>On your phone, open WhatsApp → Linked devices → Link a device → Link with phone number instead, then enter this code.</p>
          </div>

        </>
      ) : null}

      <div className="wa-step-actions">
        <button className="button button-primary" disabled={isSubmitting || (Boolean(pairing) && (cooldownSeconds ?? 0) > 0)} onClick={requestCode} type="button">
          {isSubmitting ? "Generating…" : pairing && (cooldownSeconds ?? 0) > 0 ? `Generate new code (${cooldownSeconds}s)` : pairing ? "Generate new code" : "Generate pairing code"}
        </button>
        <button className="button button-secondary" onClick={onUseQrCode} type="button">Use QR code instead</button>
      </div>
    </section>
  );
}
