"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type DiscountItem = {
  id: string;
  code: string;
  percentage: number;
  amountOff: number | null;
  expiresAtIso: string | null;
  expiresOn: string;
  redeemedAtIso: string | null;
  redeemedByName: string | null;
  redeemedByEmail: string | null;
  redeemedByWorkspaceName: string | null;
  isRedeemed: boolean;
  isManuallyInactive: boolean;
  isInactive: boolean;
  isExpired: boolean;
  createdAtIso: string;
  updatedAtIso: string;
};

type PlatformDiscountsManagerProps = {
  initialDiscounts: DiscountItem[];
};

type DraftState = Record<
  string,
  {
    code: string;
    percentage: string;
    amountOff: string;
    expiresOn: string;
  }
>;

function buildDrafts(discounts: DiscountItem[]) {
  return discounts.reduce<DraftState>((accumulator, item) => {
    accumulator[item.id] = {
      code: item.code,
      percentage: item.amountOff === null ? String(item.percentage) : "",
      amountOff: item.amountOff === null ? "" : String(item.amountOff),
      expiresOn: item.expiresOn
    };
    return accumulator;
  }, {});
}

function generateDiscountCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const characters = Array.from({ length: 8 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]);
  return `SAVE-${characters.join("")}`;
}

export function PlatformDiscountsManager({ initialDiscounts }: PlatformDiscountsManagerProps) {
  const [discounts, setDiscounts] = useState(initialDiscounts);
  const [drafts, setDrafts] = useState<DraftState>(() => buildDrafts(initialDiscounts));
  const [createCode, setCreateCode] = useState("");
  const [createPercentage, setCreatePercentage] = useState("");
  const [createAmountOff, setCreateAmountOff] = useState("");
  const [createExpiresOn, setCreateExpiresOn] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activeCount = useMemo(() => discounts.filter((item) => !item.isInactive).length, [discounts]);
  const redeemedCount = useMemo(() => discounts.filter((item) => item.isRedeemed).length, [discounts]);
  const expiredCount = useMemo(() => discounts.filter((item) => item.isExpired).length, [discounts]);

  useEffect(() => {
    setCreateCode(generateDiscountCode());
  }, []);

  function hydrate(nextDiscounts: DiscountItem[]) {
    setDiscounts(nextDiscounts);
    setDrafts(buildDrafts(nextDiscounts));
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    setError(null);

    const response = await fetch("/api/platform/discounts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        code: createCode,
        percentage: parseOptionalInteger(createPercentage),
        amountOff: parseOptionalNumber(createAmountOff),
        expiresOn: createExpiresOn || null
      })
    });

    const data = (await response.json()) as { error?: string; discounts?: DiscountItem[] };
    if (!response.ok) {
      setError(data.error ?? "Unable to create discount code.");
      setPending(false);
      return;
    }

    hydrate(data.discounts ?? []);
    setMessage("Discount code created.");
    setCreateCode(generateDiscountCode());
    setCreatePercentage("");
    setCreateAmountOff("");
    setCreateExpiresOn("");
    setPending(false);
  }

  async function handleSave(id: string) {
    const draft = drafts[id];
    if (!draft) {
      return;
    }

    setPending(true);
    setMessage(null);
    setError(null);

    const response = await fetch("/api/platform/discounts", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        id,
        code: draft.code,
        percentage: parseOptionalInteger(draft.percentage),
        amountOff: parseOptionalNumber(draft.amountOff),
        expiresOn: draft.expiresOn || null
      })
    });

    const data = (await response.json()) as { error?: string; discounts?: DiscountItem[] };
    if (!response.ok) {
      setError(data.error ?? "Unable to update discount code.");
      setPending(false);
      return;
    }

    hydrate(data.discounts ?? []);
    setMessage("Discount code updated.");
    setPending(false);
  }

  async function handleDelete(id: string) {
    setPending(true);
    setMessage(null);
    setError(null);

    const response = await fetch("/api/platform/discounts", {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ id })
    });

    const data = (await response.json()) as { error?: string; discounts?: DiscountItem[] };
    if (!response.ok) {
      setError(data.error ?? "Unable to set discount code inactive.");
      setPending(false);
      return;
    }

    hydrate(data.discounts ?? []);
    setMessage("Discount code set inactive.");
    setPending(false);
  }

  async function handleActivate(id: string) {
    setPending(true);
    setMessage(null);
    setError(null);

    const response = await fetch("/api/platform/discounts", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ id })
    });

    const data = (await response.json()) as { error?: string; discounts?: DiscountItem[] };
    if (!response.ok) {
      setError(data.error ?? "Unable to activate discount code.");
      setPending(false);
      return;
    }

    hydrate(data.discounts ?? []);
    setMessage("Discount code activated.");
    setPending(false);
  }

  return (
    <section className="content-card settings-dark-panel platform-packages-form-panel">
      <div className="card-header settings-dark-panel-head">
        <div>
          <h3 className="card-title">Discount codes</h3>
          <p className="muted">
            Generate checkout discounts, set either a percentage or fixed value off, and optionally set an expiry date. Blank expiry means the code never expires.
          </p>
        </div>
      </div>

      <form className="availability-settings-form" onSubmit={handleCreate}>
        <div className="platform-settings-status-shell">
          <div className="platform-settings-status-copy">
            <strong>Discount readiness</strong>
            <p>Use the same quick-glance strip here to review which codes are still usable before editing checkout offers.</p>
          </div>

          <div className="platform-settings-status-strip">
            <article className="platform-settings-status-pill">
              <span>Active now</span>
              <strong>{discounts.length ? activeCount : 0}</strong>
              <p>Codes that are still available for checkout and not marked inactive.</p>
            </article>

            <article className="platform-settings-status-pill">
              <span>Redeemed</span>
              <strong>{discounts.length ? redeemedCount : 0}</strong>
              <p>Previously used discount codes that remain visible for audit and support checks.</p>
            </article>

            <article className="platform-settings-status-pill">
              <span>Expired</span>
              <strong>{discounts.length ? expiredCount : 0}</strong>
              <p>Codes that now need renewal, replacement, or deletion from the offer rotation.</p>
            </article>
          </div>
        </div>

        <section className="availability-settings-section platform-page-section-card">
          <div className="availability-settings-section-head">
            <strong>Create discount code</strong>
            <p className="table-subtle">{activeCount} active code{activeCount === 1 ? "" : "s"} available for checkout.</p>
          </div>

          <div className="platform-settings-field-grid compact">
            <label className="control-block">
              <span className="control-label">Discount code</span>
              <input className="control-input" onChange={(event) => setCreateCode(event.target.value.toUpperCase())} type="text" value={createCode} />
            </label>

            <label className="control-block">
              <span className="control-label">Percentage</span>
              <input
                className="control-input"
                max="99"
                min="1"
                onChange={(event) => setCreatePercentage(event.target.value)}
                step="1"
                type="number"
                value={createPercentage}
              />
            </label>

            <label className="control-block">
              <span className="control-label">Discount value</span>
              <input
                className="control-input"
                min="0.01"
                onChange={(event) => setCreateAmountOff(event.target.value)}
                placeholder="100"
                step="0.01"
                type="number"
                value={createAmountOff}
              />
            </label>

            <label className="control-block">
              <span className="control-label">Expiry date</span>
              <input
                className="control-input"
                onChange={(event) => setCreateExpiresOn(event.target.value)}
                type="date"
                value={createExpiresOn}
              />
            </label>

            <div className="platform-discount-create-actions">
              <button
                className="button"
                onClick={() => setCreateCode(generateDiscountCode())}
                type="button"
              >
                Generate code
              </button>
            </div>
          </div>

          <p className="table-subtle">Fill in either percentage or discount value. Leave the other one blank.</p>

          <div className="platform-settings-actions">
            <div className="platform-settings-feedback">
              {message ? <p className="table-subtle">{message}</p> : null}
              {error ? <p className="form-error">{error}</p> : null}
            </div>

            <div className="panel-row">
              <button className="button button-primary" disabled={pending || !createCode.trim() || !hasExactlyOneDiscountType(createPercentage, createAmountOff)} type="submit">
                {pending ? "Saving..." : "Create discount code"}
              </button>
            </div>
          </div>
        </section>

        <section className="availability-settings-section platform-page-section-card">
          <div className="availability-settings-section-head">
            <strong>Manage existing codes</strong>
            <p className="table-subtle">Save inline changes or set unused codes inactive so they can no longer be redeemed.</p>
          </div>

          <div className="platform-packages-list">
            {discounts.map((item) => (
              <article className="platform-package-row platform-discount-row" key={item.id}>
                <div className="platform-package-row-copy">
                  <div className="platform-package-row-head">
                    <strong>{item.code}</strong>
                    <span
                      className={`platform-admin-nav-pill platform-discount-status-pill ${getDiscountStatusClassName(item)}`}
                    >
                      {item.isRedeemed ? "Used" : item.isExpired ? "Expired" : item.isManuallyInactive ? "Inactive" : "Active"}
                    </span>
                  </div>
                  <p className="muted">{formatDiscountSummary(item.percentage, item.amountOff)} off checkout price</p>
                  <p className="table-subtle">
                    Expires: {item.expiresOn || "Never"} · Updated {formatAdminTimestamp(item.updatedAtIso)}
                  </p>
                  {item.isRedeemed ? (
                    <p className="table-subtle">
                      Used by {formatRedeemer(item)}{item.redeemedByWorkspaceName ? ` for ${item.redeemedByWorkspaceName}` : ""} · {formatAdminTimestamp(item.redeemedAtIso || item.updatedAtIso)}
                    </p>
                  ) : null}
                </div>

                <div className="platform-package-row-controls">
                  <label className="control-block platform-package-order-field">
                    <span className="control-label">Code</span>
                    <input
                      className="control-input"
                      disabled={pending || item.isRedeemed}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [item.id]: {
                            ...current[item.id],
                            code: event.target.value.toUpperCase()
                          }
                        }))
                      }
                      type="text"
                      value={drafts[item.id]?.code ?? item.code}
                    />
                  </label>

                  <label className="control-block platform-package-order-field">
                    <span className="control-label">Percentage</span>
                    <input
                      className="control-input"
                      disabled={pending || item.isRedeemed}
                      max="99"
                      min="1"
                      onChange={(event) =>
                        setDrafts((current) => ({
                            ...current,
                          [item.id]: {
                            ...current[item.id],
                            percentage: event.target.value
                          }
                        }))
                      }
                      step="1"
                      type="number"
                      value={drafts[item.id]?.percentage ?? String(item.percentage)}
                    />
                  </label>

                  <label className="control-block platform-package-order-field">
                    <span className="control-label">Discount value</span>
                    <input
                      className="control-input"
                      disabled={pending || item.isRedeemed}
                      min="0.01"
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [item.id]: {
                            ...current[item.id],
                            amountOff: event.target.value
                          }
                        }))
                      }
                      step="0.01"
                      type="number"
                      value={drafts[item.id]?.amountOff ?? (item.amountOff === null ? "" : String(item.amountOff))}
                    />
                  </label>

                  <label className="control-block platform-package-order-field">
                    <span className="control-label">Expiry date</span>
                    <input
                      className="control-input"
                      disabled={pending || item.isRedeemed}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [item.id]: {
                            ...current[item.id],
                            expiresOn: event.target.value
                          }
                        }))
                      }
                      type="date"
                      value={drafts[item.id]?.expiresOn ?? item.expiresOn}
                    />
                  </label>

                  <div className="platform-discount-row-actions">
                    <button
                      className="button button-primary"
                      disabled={
                        pending ||
                        item.isRedeemed ||
                        !hasExactlyOneDiscountType(
                          drafts[item.id]?.percentage ?? String(item.percentage),
                          drafts[item.id]?.amountOff ?? (item.amountOff === null ? "" : String(item.amountOff))
                        )
                      }
                      onClick={() => handleSave(item.id)}
                      type="button"
                    >
                      Save
                    </button>
                    {item.isManuallyInactive ? (
                      <button
                        className="button"
                        disabled={pending || item.isRedeemed || item.isExpired}
                        onClick={() => handleActivate(item.id)}
                        type="button"
                      >
                        Set active
                      </button>
                    ) : (
                      <button
                        className="button"
                        disabled={pending || item.isRedeemed || item.isExpired}
                        onClick={() => handleDelete(item.id)}
                        type="button"
                      >
                        Set inactive
                      </button>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>

          {!discounts.length ? <p className="table-subtle">No discount codes created yet.</p> : null}
        </section>
      </form>
    </section>
  );
}

function formatAdminTimestamp(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return value.slice(0, 16).replace("T", " ");
  }

  const formatter = new Intl.DateTimeFormat("en-GB", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Singapore"
  });

  const parts = formatter.formatToParts(new Date(timestamp));
  const dateParts = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));

  return `${dateParts.year}-${dateParts.month}-${dateParts.day} ${dateParts.hour}:${dateParts.minute} GMT+8`;
}

function formatRedeemer(item: Pick<DiscountItem, "redeemedByEmail" | "redeemedByName">) {
  if (item.redeemedByName && item.redeemedByEmail) {
    return `${item.redeemedByName} (${item.redeemedByEmail})`;
  }

  return item.redeemedByName || item.redeemedByEmail || "Unknown";
}

function parseOptionalInteger(value: string) {
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isInteger(parsed) ? parsed : null;
}

function parseOptionalNumber(value: string) {
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function hasExactlyOneDiscountType(percentage: string, amountOff: string) {
  return Boolean(percentage.trim()) !== Boolean(amountOff.trim());
}

function formatDiscountSummary(percentage: number, amountOff: number | null) {
  if (amountOff !== null) {
    return `RM ${new Intl.NumberFormat("en-MY", {
      minimumFractionDigits: Number.isInteger(amountOff) ? 0 : 2,
      maximumFractionDigits: 2
    }).format(amountOff)}`;
  }

  return `${percentage}%`;
}

function getDiscountStatusClassName(item: Pick<DiscountItem, "isRedeemed" | "isExpired" | "isManuallyInactive">) {
  if (item.isRedeemed) {
    return "used";
  }

  if (item.isExpired) {
    return "expired";
  }

  if (item.isManuallyInactive) {
    return "inactive";
  }

  return "active";
}
