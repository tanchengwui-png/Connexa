"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { PACKAGE_BILLING_PERIOD, type PackageBillingPeriod } from "@/lib/package-pricing";
import type { PublicPackageKey } from "@/lib/public-packages";
import { registerTrust } from "@/lib/public-packages";
import { PublicPackagesGrid } from "@/components/public-packages-grid";

export function PackagesPageContent({ currentPlanKey }: { currentPlanKey: PublicPackageKey | null }) {
  const [billingPeriod, setBillingPeriod] = useState<PackageBillingPeriod>(PACKAGE_BILLING_PERIOD.MONTHLY);

  return (
    <>
      <div className="packages-page-billing-strip" aria-label="Billing cadence">
        <div className="packages-page-billing-toggle">
          <Button
            className={`packages-page-billing-pill${billingPeriod === PACKAGE_BILLING_PERIOD.MONTHLY ? " packages-page-billing-pill-active" : ""}`}
            onClick={() => setBillingPeriod(PACKAGE_BILLING_PERIOD.MONTHLY)}
            selected={billingPeriod === PACKAGE_BILLING_PERIOD.MONTHLY}
            variant="toggle"
          >
            Monthly
          </Button>
          <Button
            className={`packages-page-billing-pill${billingPeriod === PACKAGE_BILLING_PERIOD.YEARLY ? " packages-page-billing-pill-active" : ""}`}
            onClick={() => setBillingPeriod(PACKAGE_BILLING_PERIOD.YEARLY)}
            selected={billingPeriod === PACKAGE_BILLING_PERIOD.YEARLY}
            variant="toggle"
          >
            Yearly
          </Button>
          <span className="packages-page-billing-save">Paid once, no automatic renewal</span>
        </div>
        <p className="packages-page-billing-note">
          Yearly plans are paid once and provide access for one year. They do not renew automatically.
        </p>
      </div>

      <section className="connexa-section packages-page-section">
        <PublicPackagesGrid billingPeriod={billingPeriod} currentPlanKey={currentPlanKey} />

        <div className="packages-page-trust-row">
          {registerTrust.map((item) => (
            <span className="packages-page-trust-item" key={item}>
              <span className="packages-page-trust-dot" />
              {item}
            </span>
          ))}
        </div>

        <div className="packages-page-faq-grid">
          <article className="packages-page-faq-card">
            <span className="packages-page-faq-label">FAQ</span>
            <h3>Can I switch packages later?</h3>
            <p>Yes. Start with the package that fits your current team size and upgrade when message volume or operator workload grows.</p>
          </article>
          <article className="packages-page-faq-card">
            <span className="packages-page-faq-label">Billing</span>
            <h3>When does workspace access activate?</h3>
            <p>The owner account is activated only after payment succeeds, so the selected workspace package and checkout stay aligned.</p>
          </article>
          <article className="packages-page-faq-card">
            <span className="packages-page-faq-label">Enterprise</span>
            <h3>Need a larger rollout?</h3>
            <p>Use the Enterprise option when you need custom setup, rollout support, or a broader operational fit than the standard plans.</p>
          </article>
        </div>
      </section>
    </>
  );
}
