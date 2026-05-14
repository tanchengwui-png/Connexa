"use client";

import { useEffect, useState } from "react";
import type { PublicPackageKey } from "@/lib/public-packages";

type VisiblePackage = {
  key: PublicPackageKey;
  name: string;
  price: string;
  summary: string;
  featured: boolean;
  highlights: [string, string, string];
  features: string[];
};

export function PublicPackagesGrid() {
  const [packages, setPackages] = useState<VisiblePackage[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadPackages() {
      const response = await fetch("/api/public/packages", {
        cache: "no-store"
      });
      const data = (await response.json()) as { error?: string; packages?: VisiblePackage[] };

      if (!response.ok) {
        if (!cancelled) {
          setError(data.error ?? "Unable to load packages.");
        }
        return;
      }

      if (!cancelled) {
        setPackages(data.packages ?? []);
      }
    }

    loadPackages().catch((caughtError) => {
      if (!cancelled) {
        setError(caughtError instanceof Error ? caughtError.message : "Unable to load packages.");
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return <p className="form-error packages-page-feedback">{error}</p>;
  }

  if (!packages.length) {
    return <p className="table-subtle packages-page-feedback">Loading packages...</p>;
  }

  return (
    <div className="connexa-pricing-grid packages-page-grid">
      {packages.map((plan) => (
        <article className={`connexa-pricing-card packages-page-card${plan.featured ? " featured" : ""}`} key={plan.key}>
          <div className="packages-page-card-top">
            <div className="connexa-pricing-head">
              <strong>{plan.name}</strong>
              {plan.featured ? <span>Recommended</span> : null}
            </div>

            <div className="connexa-pricing-price">{plan.price}</div>
            <p className="packages-page-summary">{plan.summary}</p>
            <p className="packages-page-best-for">
              <span>Best for</span>
              {plan.highlights[0]}
            </p>
          </div>

          <div className="connexa-pricing-features packages-page-features">
            {plan.features.map((feature) => (
              <div className="connexa-pricing-feature" key={feature}>
                <span />
                <p>{feature}</p>
              </div>
            ))}
          </div>

          <div className="packages-page-card-footer">
            <a
              className={`connexa-button packages-page-button${plan.featured ? " packages-page-button-featured" : ""}`}
              href={`/checkout?plan=${plan.key}`}
            >
              {`Choose ${plan.name}`}
            </a>
          </div>
        </article>
      ))}
    </div>
  );
}
