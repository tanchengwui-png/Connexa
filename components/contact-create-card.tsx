"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

const DEFAULT_COUNTRY_CODE = "60";
const COMMON_COUNTRY_CODES = [
  { code: "65", label: "Singapore (+65)" },
  { code: "66", label: "Thailand (+66)" },
  { code: "62", label: "Indonesia (+62)" },
  { code: "63", label: "Philippines (+63)" },
  { code: "1", label: "United States / Canada (+1)" },
  { code: "44", label: "United Kingdom (+44)" },
  { code: "61", label: "Australia (+61)" },
  { code: "971", label: "UAE (+971)" }
];

const EMPTY_FORM = {
  displayName: "",
  email: "",
  tags: "",
  phoneNumber: ""
};

type ContactCreateCardProps = {
  agents: Array<{
    id: string;
    name: string;
    role: string;
  }>;
};

export function ContactCreateCard({ agents }: ContactCreateCardProps) {
  const router = useRouter();
  const [form, setForm] = useState(EMPTY_FORM);
  const [isInternational, setIsInternational] = useState(false);
  const [countryCode, setCountryCode] = useState(DEFAULT_COUNTRY_CODE);
  const [ownerId, setOwnerId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const resetForm = () => {
    setForm(EMPTY_FORM);
    setIsInternational(false);
    setCountryCode(DEFAULT_COUNTRY_CODE);
    setOwnerId("");
    setError(null);
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!form.displayName.trim()) {
      setError("Contact name is required.");
      return;
    }

    if (!form.phoneNumber.trim()) {
      setError("Phone number is required.");
      return;
    }

    if (!(countryCode || DEFAULT_COUNTRY_CODE).trim()) {
      setError("Country code is required.");
      return;
    }

    setError(null);
    startTransition(async () => {
      const response = await fetch("/api/contacts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          displayName: form.displayName,
          email: form.email,
          tags: form.tags,
          ownerId,
          countryCode,
          phoneNumber: form.phoneNumber
        })
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(payload?.error ?? "Unable to create contact.");
        return;
      }

      resetForm();
      router.refresh();
    });
  };

  return (
    <section className="content-card contacts-create-card">
      <div className="card-header">
        <div>
          <h3 className="card-title">Add contact</h3>
          <p className="muted">Create contacts manually before a conversation starts. Phone numbers stay unique per workspace.</p>
        </div>
      </div>

      <form className="contact-create-grid" onSubmit={handleSubmit}>
        <label className="lead-record-field">
          <span>Contact name</span>
          <input
            className="lead-record-input"
            value={form.displayName}
            onChange={(event) => setForm((current) => ({ ...current, displayName: event.target.value }))}
          />
        </label>

        <label className="lead-record-field">
          <span>Email</span>
          <input
            className="lead-record-input"
            inputMode="email"
            placeholder="Optional"
            value={form.email}
            onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
          />
        </label>

        <label className="lead-record-field">
          <span>Assigned to</span>
          <select
            className="lead-record-input app-select"
            value={ownerId}
            onChange={(event) => setOwnerId(event.target.value)}
          >
            <option value="">Unassigned</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name} ({agent.role})
              </option>
            ))}
          </select>
        </label>

        <label className="lead-record-field">
          <span>Phone number</span>
          <div className="contact-phone-input-shell">
            <div className="contact-phone-prefix-cluster">
              {isInternational ? (
                <>
                  <span className="contact-phone-prefix-plus">+</span>
                  <input
                    className="contact-country-code-input"
                    inputMode="numeric"
                    list="contact-country-codes"
                    placeholder="Code"
                    value={countryCode}
                    onChange={(event) => setCountryCode(event.target.value.replace(/[^\d]/g, ""))}
                  />
                  <datalist id="contact-country-codes">
                    <option value={DEFAULT_COUNTRY_CODE}>Malaysia (+60)</option>
                    {COMMON_COUNTRY_CODES.map((option) => (
                      <option key={option.code} value={option.code}>
                        {option.label}
                      </option>
                    ))}
                  </datalist>
                </>
              ) : (
                <button
                  className="contact-country-code-pill"
                  onClick={() => {
                    setIsInternational(true);
                    setCountryCode(DEFAULT_COUNTRY_CODE);
                  }}
                  type="button"
                >
                  +60
                </button>
              )}
            </div>
            <input
              className="lead-record-input contact-phone-input"
              inputMode="tel"
              placeholder={isInternational ? "123456789" : "12 345 6789"}
              value={form.phoneNumber}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  phoneNumber: event.target.value.replace(/[^\d\s\-()]/g, "")
                }))
              }
            />
          </div>
          <small className="muted">
            {isInternational ? (
              <>
                Enter the number without the leading country code.{" "}
                <button
                  className="contact-inline-link"
                  onClick={() => {
                    setIsInternational(false);
                    setCountryCode(DEFAULT_COUNTRY_CODE);
                  }}
                  type="button"
                >
                  Switch back to Malaysia (+60)
                </button>
              </>
            ) : (
              "Malaysia (+60) is used by default. Tap +60 to use another country code."
            )}
          </small>
        </label>

        <label className="lead-record-field lead-record-field-wide">
          <span>Tags</span>
          <input
            className="lead-record-input"
            placeholder="Comma separated, for example buyer, vip"
            value={form.tags}
            onChange={(event) => setForm((current) => ({ ...current, tags: event.target.value }))}
          />
        </label>

        {error ? <div className="form-error contact-create-error">{error}</div> : null}

        <div className="contact-create-actions">
          <button className="button button-primary" disabled={isPending} type="submit">
            {isPending ? "Creating contact..." : "Create contact"}
          </button>
        </div>
      </form>
    </section>
  );
}
