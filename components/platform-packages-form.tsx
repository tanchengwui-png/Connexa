"use client";

import { FormEvent, useEffect, useState } from "react";
import type { PublicPackageKey } from "@/lib/public-packages";

type PlatformPackagesFormProps = {
  initialPackages: Array<{
    packageKey: PublicPackageKey;
    isVisible: boolean;
    displayOrder: number;
    priceAmount: number | null;
    maxOutboundMessages: number | null;
    maxActiveContacts: number | null;
    maxActiveAutomations: number | null;
    maxWhatsAppCampaigns: number | null;
    package: {
      name: string;
      price: string;
      summary: string;
      highlights: [string, string, string];
      limits: {
        maxOutboundMessages: number | null;
        maxActiveContacts: number | null;
        maxActiveAutomations: number | null;
        maxWhatsAppCampaigns: number | null;
      };
    };
  }>;
};

export function PlatformPackagesForm({ initialPackages }: PlatformPackagesFormProps) {
  const [packages, setPackages] = useState(initialPackages);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialPackages.length) {
      setPackages(initialPackages);
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

    const formData = new FormData(event.currentTarget);
    const nextPackages = packages.map((item) => ({
      packageKey: item.packageKey,
      isVisible: formData.get(`visible:${item.packageKey}`) === "on",
      displayOrder: Number(formData.get(`order:${item.packageKey}`) ?? item.displayOrder),
      priceAmount: parseOptionalPrice(formData.get(`price:${item.packageKey}`), item.priceAmount),
      maxOutboundMessages: parseOptionalLimit(formData.get(`messages:${item.packageKey}`), item.maxOutboundMessages),
      maxActiveContacts: parseOptionalLimit(formData.get(`contacts:${item.packageKey}`), item.maxActiveContacts),
      maxActiveAutomations: parseOptionalLimit(formData.get(`automations:${item.packageKey}`), item.maxActiveAutomations),
      maxWhatsAppCampaigns: parseOptionalLimit(formData.get(`campaigns:${item.packageKey}`), item.maxWhatsAppCampaigns)
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
    }
    setPending(false);
  }

  return (
    <section className="content-card settings-dark-panel platform-packages-form-panel">
      <div className="card-header settings-dark-panel-head">
        <div>
          <h3 className="card-title">Public package visibility</h3>
          <p className="muted">
            Choose which packages appear publicly, set their order, configure price, and control package limits.
          </p>
        </div>
      </div>

      <form className="availability-settings-form" onSubmit={handleSubmit}>
        <section className="availability-settings-section">
          <div className="availability-settings-section-head">
            <strong>Package list</strong>
            <p className="table-subtle">
              Package copy mostly stays static in code. This screen controls public visibility, ordering, price, and feature caps.
            </p>
          </div>

          <div className="platform-packages-list">
            {packages.map((item) => (
              <article className="platform-package-row" key={item.packageKey}>
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
                </div>

                <div className="platform-package-row-controls">
                  <label className="auth-checkbox platform-package-visibility-toggle">
                    <input defaultChecked={item.isVisible} name={`visible:${item.packageKey}`} type="checkbox" />
                    <span>Show on public packages page</span>
                  </label>

                  <label className="control-block platform-package-order-field">
                    <span className="control-label">Display order</span>
                    <input
                      className="control-input"
                      defaultValue={String(item.displayOrder)}
                      min="0"
                      name={`order:${item.packageKey}`}
                      type="number"
                    />
                  </label>

                  <label className="control-block platform-package-order-field">
                    <span className="control-label">Price amount</span>
                    <input
                      className="control-input"
                      defaultValue={item.priceAmount === null ? "" : String(item.priceAmount)}
                      min="0"
                      name={`price:${item.packageKey}`}
                      placeholder="Custom billing"
                      step="0.01"
                      type="number"
                    />
                  </label>

                  <label className="control-block platform-package-order-field">
                    <span className="control-label">Max outbound messages</span>
                    <input
                      className="control-input"
                      defaultValue={item.maxOutboundMessages === null ? "" : String(item.maxOutboundMessages)}
                      min="0"
                      name={`messages:${item.packageKey}`}
                      placeholder="Unlimited"
                      type="number"
                    />
                  </label>

                  <label className="control-block platform-package-order-field">
                    <span className="control-label">Max active contacts</span>
                    <input
                      className="control-input"
                      defaultValue={item.maxActiveContacts === null ? "" : String(item.maxActiveContacts)}
                      min="0"
                      name={`contacts:${item.packageKey}`}
                      placeholder="Unlimited"
                      type="number"
                    />
                  </label>

                  <label className="control-block platform-package-order-field">
                    <span className="control-label">Max active automations</span>
                    <input
                      className="control-input"
                      defaultValue={item.maxActiveAutomations === null ? "" : String(item.maxActiveAutomations)}
                      min="0"
                      name={`automations:${item.packageKey}`}
                      placeholder="Unlimited"
                      type="number"
                    />
                  </label>

                  <label className="control-block platform-package-order-field">
                    <span className="control-label">Max WhatsApp campaigns</span>
                    <input
                      className="control-input"
                      defaultValue={item.maxWhatsAppCampaigns === null ? "" : String(item.maxWhatsAppCampaigns)}
                      min="0"
                      name={`campaigns:${item.packageKey}`}
                      placeholder="Unlimited"
                      type="number"
                    />
                  </label>
                </div>
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

function parseOptionalLimit(value: FormDataEntryValue | null, fallback: number | null) {
  const normalized = `${value ?? ""}`.trim();

  if (!normalized) {
    return null;
  }

  const parsed = Number(normalized);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.trunc(parsed);
}

function parseOptionalPrice(value: FormDataEntryValue | null, fallback: number | null) {
  const normalized = `${value ?? ""}`.trim();

  if (!normalized) {
    return null;
  }

  const parsed = Number(normalized);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.round(parsed * 100) / 100;
}

function formatLimit(value: number | null, label: string) {
  return value === null ? `Unlimited ${label}` : `${value} ${label}`;
}
