"use client";

import { useEffect, useState } from "react";
import type { PackageBillingPeriod } from "@/lib/package-pricing";
import type { PublicPackageKey } from "@/lib/public-packages";
import { buildPackageCardView, getPlanCta, getPlanHref, type VisiblePackageCard } from "@/lib/public-package-card-view";

type VisiblePackage = VisiblePackageCard & {
  key: PublicPackageKey;
  name: string;
  price: string;
  priceAmount: number | null;
  monthlyPriceAmount: number | null;
  yearlyDiscountPercentage: number;
  currency: string | null;
  summary: string;
  featured: boolean;
  highlights: [string, string, string];
  features: string[];
  pricing: {
    monthly: {
      priceAmount: number | null;
      formattedPrice: string;
    };
    yearly: {
      discountPercentage: number;
      basePriceAmount: number | null;
      discountAmount: number | null;
      payablePriceAmount: number | null;
      savingsAmount: number | null;
      effectiveMonthlyPriceAmount: number | null;
      formattedBasePrice: string;
      formattedDiscountAmount: string;
      formattedPayablePrice: string;
      formattedSavingsAmount: string;
      formattedEffectiveMonthlyPrice: string;
    };
  };
};

export function PublicPackagesGrid({
  billingPeriod,
  currentPlanKey
}: {
  billingPeriod: PackageBillingPeriod;
  currentPlanKey: PublicPackageKey | null;
}) {
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

  return (
    <div className="connexa-pricing-grid packages-page-grid">
      {error ? <p className="form-error packages-page-feedback">{error}</p> : null}
      {!error && !packages.length ? <p className="table-subtle packages-page-feedback">Loading packages...</p> : null}
      {packages.map((plan) => {
        const cardView = buildPackageCardView(plan, billingPeriod);
        const hasFreeTrialBadge = !currentPlanKey && plan.key === "starter" && !cardView.isYearly;
        const showPrimaryRibbon = cardView.showFeaturedBadge && !hasFreeTrialBadge;

        return (
        <article
          className={`connexa-pricing-card packages-page-card${plan.featured ? " featured" : ""}${cardView.isYearly ? " packages-page-card-yearly" : ""}${hasFreeTrialBadge ? " packages-page-card-trial" : ""}`}
          key={plan.key}
        >
          {showPrimaryRibbon ? <span className="packages-page-ribbon">Most Popular</span> : null}
          {hasFreeTrialBadge ? <span className="packages-page-ribbon packages-page-ribbon-trial">Free trial available</span> : null}

          <div className="packages-page-card-top">
            <div className="connexa-pricing-head">
              <div className="packages-page-plan-title">
                <span className="packages-page-plan-label">{cardView.planLabel}</span>
                <strong>{plan.name}</strong>
              </div>
            </div>

            <div className="packages-page-price-stack">
              <div className="packages-page-price-row">
                <div className="connexa-pricing-price">{cardView.displayPrice}</div>
              </div>
              {cardView.showYearlyOriginalPrice ? (
                <span
                  className="packages-page-yearly-original-price"
                  aria-label={`Original yearly price ${cardView.yearlyOriginalPrice}`}
                >
                  <s>{cardView.yearlyOriginalPrice}</s>
                </span>
              ) : null}
              {!cardView.isYearly ? (
                <span className="packages-page-price-period">{cardView.pricePeriodLabel}</span>
              ) : null}
            </div>
            {cardView.showSummary ? <p className="packages-page-summary">{plan.summary}</p> : null}
            {cardView.showYearlySavingsBadge ? (
              <p className="packages-page-yearly-savings-badge">{cardView.yearlySavingsBadge}</p>
            ) : null}
            {cardView.isYearly && plan.pricing.yearly.payablePriceAmount !== null ? (
              <>
                <div className="packages-page-divider" />
                <div className="packages-page-yearly-info-list">
                  <div className="packages-page-yearly-info-row">
                    <YearlyInfoIcon type="payment" />
                    <div className="packages-page-yearly-info-copy">
                      <strong>One-time payment for 1 year</strong>
                      <p>Access lasts 12 months. No automatic renewal.</p>
                    </div>
                  </div>
                  <div className="packages-page-yearly-info-row">
                    <YearlyInfoIcon type="calculator" />
                    <div className="packages-page-yearly-info-copy">
                      <strong>{cardView.yearlyEffectiveMonthlyHeading}</strong>
                      <p>Savings compared to 12 months of the monthly package price.</p>
                    </div>
                  </div>
                  <div className="packages-page-yearly-info-row">
                    <YearlyInfoIcon type="card" />
                    <div className="packages-page-yearly-info-copy">
                      <strong>Payment via Credit and Debit card.</strong>
                    </div>
                  </div>
                </div>
              </>
            ) : null}
          </div>

          <a
            className={`connexa-button packages-page-button${plan.featured ? " packages-page-button-featured" : ""}${hasFreeTrialBadge ? " packages-page-button-trial" : ""}`}
            href={getPlanHref(plan.key, currentPlanKey, billingPeriod)}
          >
            {getPlanCta(plan, currentPlanKey)}
          </a>

          <div className="packages-page-meta-strip">
            {plan.highlights.map((highlight) => (
              <span className="packages-page-meta-item" key={highlight}>
                {highlight}
              </span>
            ))}
          </div>

          <div className="packages-page-divider" />

          <div className="packages-page-feature-head">
            <strong>What&apos;s included</strong>
            <span>{plan.priceAmount === null ? "Tailored scope" : "Core plan features"}</span>
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
            <p className="packages-page-footer-note">
              {plan.priceAmount === null
                ? "Enterprise setup is finalized during rollout review."
                : "Checkout creates the owner account after payment succeeds."}
            </p>
          </div>
        </article>
      )})}
    </div>
  );
}

function YearlyInfoIcon({ type }: { type: "payment" | "calculator" | "card" }) {
  if (type === "payment") {
    return (
      <span className="packages-page-yearly-info-icon" aria-hidden="true">
        <svg viewBox="0 0 20 20" focusable="false">
          <rect x="3" y="5" width="14" height="10" rx="2" />
          <path d="M3 8.25h14" />
          <path d="M6.25 11.5h2.5" />
        </svg>
      </span>
    );
  }

  if (type === "calculator") {
    return (
      <span className="packages-page-yearly-info-icon" aria-hidden="true">
        <svg viewBox="0 0 20 20" focusable="false">
          <rect x="4" y="3.5" width="12" height="13" rx="2" />
          <path d="M7 6.5h6" />
          <path d="M7 10h1.5" />
          <path d="M10 10h1.5" />
          <path d="M13 10h0.01" />
          <path d="M7 13h1.5" />
          <path d="M10 13h1.5" />
          <path d="M13 13h0.01" />
        </svg>
      </span>
    );
  }

  return (
    <span className="packages-page-yearly-info-icon" aria-hidden="true">
      <svg viewBox="0 0 20 20" focusable="false">
        <rect x="2.5" y="5" width="15" height="10" rx="2" />
        <path d="M2.5 8h15" />
        <path d="M5.5 12h4" />
      </svg>
    </span>
  );
}
