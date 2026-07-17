"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { calculatePackagePricing, formatPackageAmount } from "@/lib/package-pricing";
import type { PublicPackageKey } from "@/lib/public-packages";

type PackageFormItem = {
  packageKey: PublicPackageKey;
  isVisible: boolean;
  displayOrder: number;
  priceAmount: number | null;
  yearlyDiscountPercentage: number;
  mediaLibraryStorageLimitBytes: number | null;
  maxOutboundMessages: number | null;
  maxActiveContacts: number | null;
  maxActiveAutomations: number | null;
  maxWhatsAppCampaigns: number | null;
  package: {
    name: string;
    price: string;
    summary: string;
    highlights: [string, string, string];
    currency: string | null;
    limits: {
      maxOutboundMessages: number | null;
      maxActiveContacts: number | null;
      maxActiveAutomations: number | null;
      maxWhatsAppCampaigns: number | null;
    };
  };
};

type PlatformPackagesFormProps = {
  initialPackages: PackageFormItem[];
};

type StorageLimitUnit = "MB" | "GB";

export function PlatformPackagesForm({ initialPackages }: PlatformPackagesFormProps) {
  const [packages, setPackages] = useState(initialPackages);
  const [storageLimitUnits, setStorageLimitUnits] = useState<Record<PublicPackageKey, StorageLimitUnit>>(
    () => buildStorageLimitUnits(initialPackages)
  );
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const visibleCount = useMemo(() => packages.filter((item) => item.isVisible).length, [packages]);
  const hiddenCount = useMemo(() => packages.filter((item) => !item.isVisible).length, [packages]);
  const overrideCount = useMemo(
    () =>
      packages.filter(
        (item) =>
          item.priceAmount !== null ||
          item.yearlyDiscountPercentage > 0 ||
          item.mediaLibraryStorageLimitBytes !== null ||
          item.maxOutboundMessages !== null ||
          item.maxActiveContacts !== null ||
          item.maxActiveAutomations !== null ||
          item.maxWhatsAppCampaigns !== null
      ).length,
    [packages]
  );

  useEffect(() => {
    if (initialPackages.length) {
      setPackages(initialPackages);
      setStorageLimitUnits(buildStorageLimitUnits(initialPackages));
      return;
    }

    let cancelled = false;

    async function loadPackages() {
      const response = await fetch("/api/platform/packages", {
        cache: "no-store"
      });
      const data = (await response.json()) as { error?: string; packages?: PlatformPackagesFormProps["initialPackages"] };

      if (!response.ok) {
        if (!cancelled) {
          setError(data.error ?? "Unable to load package settings.");
        }
        return;
      }

      if (!cancelled) {
        setPackages(data.packages ?? []);
        setStorageLimitUnits(buildStorageLimitUnits(data.packages ?? []));
      }
    }

    loadPackages().catch((caughtError) => {
      if (!cancelled) {
        setError(caughtError instanceof Error ? caughtError.message : "Unable to load package settings.");
      }
    });

    return () => {
      cancelled = true;
    };
  }, [initialPackages]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    setError(null);

    const nextPackages = packages.map((item) => ({
      packageKey: item.packageKey,
      isVisible: item.isVisible,
      displayOrder: item.displayOrder,
      priceAmount: item.priceAmount,
      yearlyDiscountPercentage: item.yearlyDiscountPercentage,
      mediaLibraryStorageLimitBytes: item.mediaLibraryStorageLimitBytes,
      maxOutboundMessages: item.maxOutboundMessages,
      maxActiveContacts: item.maxActiveContacts,
      maxActiveAutomations: item.maxActiveAutomations,
      maxWhatsAppCampaigns: item.maxWhatsAppCampaigns
    }));

    const response = await fetch("/api/platform/packages", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ packages: nextPackages })
    });

    const data = (await response.json()) as {
      error?: string;
      packages?: PlatformPackagesFormProps["initialPackages"];
    };

    if (!response.ok) {
      setError(data.error ?? "Unable to save package settings.");
      setPending(false);
      return;
    }

    setMessage("Package settings saved.");
    if (data.packages?.length) {
      setPackages(data.packages);
      setStorageLimitUnits(buildStorageLimitUnits(data.packages));
    }
    setPending(false);
  }

  return (
    <section className="content-card settings-dark-panel platform-packages-form-panel">
      <div className="card-header settings-dark-panel-head">
        <div>
          <h3 className="card-title">Public package visibility</h3>
          <p className="muted">
            Choose which packages appear publicly, set their order, configure price, and control package limits. A maximum of 3 packages can appear on the public packages page.
          </p>
        </div>
      </div>

      <form className="availability-settings-form" onSubmit={handleSubmit}>
        <div className="platform-settings-status-shell">
          <div className="platform-settings-status-copy">
            <strong>Package rollout summary</strong>
            <p>Keep public package choices, display order, and feature caps readable from one glance before saving.</p>
          </div>

          <div className="platform-settings-status-strip">
            <article className="platform-settings-status-pill">
              <span>Visible now</span>
              <strong>{packages.length ? `${visibleCount} of ${packages.length}` : "--"}</strong>
              <p>Only 3 visible packages can appear on the public pricing page at once.</p>
            </article>

            <article className="platform-settings-status-pill">
              <span>Hidden</span>
              <strong>{packages.length ? hiddenCount : "--"}</strong>
              <p>Hidden packages stay editable here without appearing during signup.</p>
            </article>

            <article className="platform-settings-status-pill">
              <span>Custom overrides</span>
              <strong>{packages.length ? overrideCount : "--"}</strong>
              <p>Tracks packages with custom billing or feature caps beyond code defaults.</p>
            </article>
          </div>
        </div>

        <section className="availability-settings-section platform-page-section-card">
          <div className="availability-settings-section-head">
            <strong>Package list</strong>
            <p className="table-subtle">
              Package copy mostly stays static in code. This screen controls public visibility, ordering, price, and feature caps. The public page follows this list and shows at most 3 visible packages.
            </p>
          </div>

          <div className="platform-packages-list">
            {packages.map((item) => (
              <article className="platform-package-row" key={item.packageKey}>
                {(() => {
                  const pricing = calculatePackagePricing(
                    item.priceAmount,
                    item.yearlyDiscountPercentage,
                    item.package.currency
                  );

                  return (
                    <>
                <div className="platform-package-row-copy">
                  <div className="platform-package-row-head">
                    <strong>{item.package.name}</strong>
                    <span className="table-subtle">{item.package.price}</span>
                  </div>

                  <p className="muted">{item.package.summary}</p>
                  <p className="table-subtle">{item.package.highlights.join(" • ")}</p>
                  <p className="table-subtle">
                    Defaults: {formatLimit(item.package.limits.maxOutboundMessages, "messages")} ·{" "}
                    {formatLimit(item.package.limits.maxActiveContacts, "active contacts")}
                  </p>
                  <p className="table-subtle">
                    Default Automation: {formatLimit(item.package.limits.maxActiveAutomations, "active automations")} ·{" "}
                    {formatLimit(item.package.limits.maxWhatsAppCampaigns, "WhatsApp campaigns")}
                  </p>
                  <div className="table-subtle">
                    <strong>Yearly preview</strong>
                    <p>Monthly: {formatPackageAmount(item.priceAmount, item.package.currency, "MONTHLY")}</p>
                    <p>Yearly base: {formatPackageAmount(pricing.yearly.basePriceAmount, item.package.currency, "YEARLY")}</p>
                    <p>Discount: {item.yearlyDiscountPercentage}%</p>
                    <p>Discount amount: {formatPackageAmount(pricing.yearly.discountAmount, item.package.currency, null)}</p>
                    <p>Yearly payable: {formatPackageAmount(pricing.yearly.payablePriceAmount, item.package.currency, "YEARLY")}</p>
                    <p>Savings: {formatPackageAmount(pricing.yearly.savingsAmount, item.package.currency, null)}</p>
                    <p>Effective monthly: {formatPackageAmount(pricing.yearly.effectiveMonthlyPriceAmount, item.package.currency, "MONTHLY")}</p>
                  </div>
                </div>

                <div className="platform-package-row-controls">
                  <label className="auth-checkbox platform-package-visibility-toggle">
                    <input
                      checked={item.isVisible}
                      name={`visible:${item.packageKey}`}
                      onChange={(event) => {
                        setPackages((currentPackages) =>
                          currentPackages.map((currentItem) =>
                            currentItem.packageKey === item.packageKey
                              ? { ...currentItem, isVisible: event.target.checked }
                              : currentItem
                          )
                        );
                      }}
                      type="checkbox"
                    />
                    <span>Show on public packages page</span>
                  </label>

                  <label className="control-block platform-package-order-field">
                    <span className="control-label">Display order</span>
                    <input
                      className="control-input"
                      name={`order:${item.packageKey}`}
                      min="0"
                      onChange={(event) => {
                        setPackages((currentPackages) =>
                          currentPackages.map((currentItem) =>
                            currentItem.packageKey === item.packageKey
                              ? { ...currentItem, displayOrder: Math.max(0, Math.trunc(Number(event.target.value) || 0)) }
                              : currentItem
                          )
                        );
                      }}
                      type="number"
                      value={String(item.displayOrder)}
                    />
                  </label>

                  <label className="control-block platform-package-order-field">
                    <span className="control-label">Price amount</span>
                    <input
                      className="control-input"
                      min="0"
                      name={`price:${item.packageKey}`}
                      onChange={(event) => {
                        setPackages((currentPackages) =>
                          currentPackages.map((currentItem) =>
                            currentItem.packageKey === item.packageKey
                              ? { ...currentItem, priceAmount: parseOptionalPrice(event.target.value) }
                              : currentItem
                          )
                        );
                      }}
                      placeholder="Custom billing"
                      step="0.01"
                      type="number"
                      value={item.priceAmount === null ? "" : String(item.priceAmount)}
                    />
                  </label>

                  <label className="control-block platform-package-order-field">
                    <span className="control-label">Yearly discount</span>
                    <input
                      className="control-input"
                      min="0"
                      name={`yearlyDiscount:${item.packageKey}`}
                      onChange={(event) => {
                        setPackages((currentPackages) =>
                          currentPackages.map((currentItem) =>
                            currentItem.packageKey === item.packageKey
                              ? {
                                  ...currentItem,
                                  yearlyDiscountPercentage: parseOptionalPercentage(event.target.value)
                                }
                              : currentItem
                          )
                        );
                      }}
                      placeholder="0"
                      step="0.01"
                      type="number"
                      value={String(item.yearlyDiscountPercentage)}
                    />
                  </label>

                  <label className="control-block platform-package-order-field">
                    <span className="control-label">Media Library storage limit</span>
                    <div className="platform-package-inline-field">
                      <input
                        className="control-input"
                        min="0"
                        name={`mediaStorageLimit:${item.packageKey}`}
                        onChange={(event) => {
                          const unit = storageLimitUnits[item.packageKey] ?? "MB";
                          setPackages((currentPackages) =>
                            currentPackages.map((currentItem) =>
                              currentItem.packageKey === item.packageKey
                                ? {
                                    ...currentItem,
                                    mediaLibraryStorageLimitBytes: parseStorageLimitBytes(event.target.value, unit)
                                  }
                                : currentItem
                            )
                          );
                        }}
                        placeholder="Unlimited"
                        step="0.01"
                        type="number"
                        value={
                          item.mediaLibraryStorageLimitBytes === null
                            ? ""
                            : formatStorageLimitValue(
                                item.mediaLibraryStorageLimitBytes,
                                storageLimitUnits[item.packageKey] ?? "MB"
                              )
                        }
                      />
                      <select
                        className="control-input"
                        onChange={(event) => {
                          const nextUnit = event.target.value === "GB" ? "GB" : "MB";
                          setStorageLimitUnits((current) => ({
                            ...current,
                            [item.packageKey]: nextUnit
                          }));
                        }}
                        value={storageLimitUnits[item.packageKey] ?? "MB"}
                      >
                        <option value="MB">MB</option>
                        <option value="GB">GB</option>
                      </select>
                    </div>
                    <span className="table-subtle">
                      {item.mediaLibraryStorageLimitBytes === null
                        ? "Unlimited"
                        : `${formatStorageUsageLabel(item.mediaLibraryStorageLimitBytes)} stored as bytes`}
                    </span>
                  </label>

                  <label className="control-block platform-package-order-field">
                    <span className="control-label">Max outbound messages</span>
                    <input
                      className="control-input"
                      min="0"
                      name={`messages:${item.packageKey}`}
                      onChange={(event) => {
                        setPackages((currentPackages) =>
                          currentPackages.map((currentItem) =>
                            currentItem.packageKey === item.packageKey
                              ? { ...currentItem, maxOutboundMessages: parseOptionalLimit(event.target.value) }
                              : currentItem
                          )
                        );
                      }}
                      placeholder="Unlimited"
                      type="number"
                      value={item.maxOutboundMessages === null ? "" : String(item.maxOutboundMessages)}
                    />
                  </label>

                  <label className="control-block platform-package-order-field">
                    <span className="control-label">Max active contacts</span>
                    <input
                      className="control-input"
                      min="0"
                      name={`contacts:${item.packageKey}`}
                      onChange={(event) => {
                        setPackages((currentPackages) =>
                          currentPackages.map((currentItem) =>
                            currentItem.packageKey === item.packageKey
                              ? { ...currentItem, maxActiveContacts: parseOptionalLimit(event.target.value) }
                              : currentItem
                          )
                        );
                      }}
                      placeholder="Unlimited"
                      type="number"
                      value={item.maxActiveContacts === null ? "" : String(item.maxActiveContacts)}
                    />
                  </label>

                  <label className="control-block platform-package-order-field">
                    <span className="control-label">Max active automations</span>
                    <input
                      className="control-input"
                      min="0"
                      name={`automations:${item.packageKey}`}
                      onChange={(event) => {
                        setPackages((currentPackages) =>
                          currentPackages.map((currentItem) =>
                            currentItem.packageKey === item.packageKey
                              ? { ...currentItem, maxActiveAutomations: parseOptionalLimit(event.target.value) }
                              : currentItem
                          )
                        );
                      }}
                      placeholder="Unlimited"
                      type="number"
                      value={item.maxActiveAutomations === null ? "" : String(item.maxActiveAutomations)}
                    />
                  </label>

                  <label className="control-block platform-package-order-field">
                    <span className="control-label">Max WhatsApp campaigns</span>
                    <input
                      className="control-input"
                      min="0"
                      name={`campaigns:${item.packageKey}`}
                      onChange={(event) => {
                        setPackages((currentPackages) =>
                          currentPackages.map((currentItem) =>
                            currentItem.packageKey === item.packageKey
                              ? { ...currentItem, maxWhatsAppCampaigns: parseOptionalLimit(event.target.value) }
                              : currentItem
                          )
                        );
                      }}
                      placeholder="Unlimited"
                      type="number"
                      value={item.maxWhatsAppCampaigns === null ? "" : String(item.maxWhatsAppCampaigns)}
                    />
                  </label>
                </div>
                    </>
                  );
                })()}
              </article>
            ))}
          </div>
        </section>

        {!packages.length ? <p className="table-subtle">Loading package settings...</p> : null}

        <div className="platform-settings-actions">
          <div className="platform-settings-feedback">
            {message ? <p className="table-subtle">{message}</p> : null}
            {error ? <p className="form-error">{error}</p> : null}
          </div>

          <div className="panel-row">
            <button className="button button-primary" disabled={pending || !packages.length} type="submit">
              {pending ? "Saving..." : "Save package settings"}
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}

function parseOptionalLimit(value: string) {
  const normalized = value.trim();

  if (!normalized) {
    return null;
  }

  const parsed = Number(normalized);

  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Math.trunc(parsed);
}

function parseOptionalPrice(value: string) {
  const normalized = value.trim();

  if (!normalized) {
    return null;
  }

  const parsed = Number(normalized);

  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Math.round(parsed * 100) / 100;
}

function parseOptionalPercentage(value: string) {
  const normalized = value.trim();

  if (!normalized) {
    return 0;
  }

  const parsed = Number(normalized);

  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Math.round(parsed * 100) / 100;
}

function buildStorageLimitUnits(packages: PackageFormItem[]) {
  return packages.reduce(
    (accumulator, item) => {
      accumulator[item.packageKey] = inferStorageLimitUnit(item.mediaLibraryStorageLimitBytes);
      return accumulator;
    },
    {} as Record<PublicPackageKey, StorageLimitUnit>
  );
}

function inferStorageLimitUnit(value: number | null): StorageLimitUnit {
  if (value === null) {
    return "MB";
  }

  return value >= 1024 * 1024 * 1024 && value % (1024 * 1024 * 1024) === 0 ? "GB" : "MB";
}

function formatStorageLimitValue(value: number, unit: StorageLimitUnit) {
  const divisor = unit === "GB" ? 1024 * 1024 * 1024 : 1024 * 1024;
  const normalized = value / divisor;
  return normalized % 1 === 0 ? String(normalized) : normalized.toFixed(2).replace(/\.?0+$/, "");
}

function parseStorageLimitBytes(value: string, unit: StorageLimitUnit) {
  const normalized = value.trim();

  if (!normalized) {
    return null;
  }

  const parsed = Number(normalized);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  const multiplier = unit === "GB" ? 1024 * 1024 * 1024 : 1024 * 1024;
  return Math.round(parsed * multiplier);
}

function formatStorageUsageLabel(value: number) {
  if (value >= 1024 * 1024 * 1024) {
    return `${value / (1024 * 1024 * 1024)} GB`;
  }

  return `${value / (1024 * 1024)} MB`;
}

function formatLimit(value: number | null, label: string) {
  return value === null ? `Unlimited ${label}` : `${value} ${label}`;
}
