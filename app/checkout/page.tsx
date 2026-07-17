import { redirect } from "next/navigation";
import { ConnexaLogo } from "@/components/connexa-logo";
import { CheckoutForm } from "@/components/checkout-form";
import { getAgentEntryPath } from "@/lib/auth/entry-path";
import { getCurrentAgent } from "@/lib/auth/current-user";
import { getResolvedPublicPackageDefinition } from "@/lib/platform-packages";
import { normalizePackageBillingPeriod, PACKAGE_BILLING_PERIOD } from "@/lib/package-pricing";
import { isPublicPackageKey, registerTrust } from "@/lib/public-packages";

const checkoutPillFallbackAccents = [
  "checkout-pill-cyan",
  "checkout-pill-blue",
  "checkout-pill-amber",
  "checkout-pill-emerald",
  "checkout-pill-violet",
  "checkout-pill-rose"
] as const;

function getCheckoutPillAccent(label: string) {
  switch (label) {
    case "Lead follow-up ready":
      return "checkout-pill-cyan";
    case "Multi-agent workflow":
      return "checkout-pill-blue";
    case "Operational visibility":
      return "checkout-pill-amber";
    case "Secure Billplz checkout":
      return "checkout-pill-emerald";
    case "Instant activation after payment":
      return "checkout-pill-violet";
    case "Cancel anytime":
      return "checkout-pill-rose";
    default:
      return "";
  }
}

function getCheckoutPillClass(label: string, index: number) {
  const mappedAccent = getCheckoutPillAccent(label);
  if (mappedAccent) {
    return mappedAccent;
  }

  return checkoutPillFallbackAccents[index % checkoutPillFallbackAccents.length];
}

export default async function CheckoutPage({
  searchParams
}: {
  searchParams?: Promise<{ plan?: string; billingPeriod?: string }>;
}) {
  const agent = await getCurrentAgent();
  const resolvedSearchParams = await searchParams;

  if (agent) {
    redirect(await getAgentEntryPath(agent));
  }

  const selectedPlanKey = resolvedSearchParams?.plan;
  if (!isPublicPackageKey(selectedPlanKey)) {
    redirect("/packages");
  }
  let selectedBillingPeriod: "MONTHLY" | "YEARLY" = PACKAGE_BILLING_PERIOD.MONTHLY;
  try {
    selectedBillingPeriod = normalizePackageBillingPeriod(
      resolvedSearchParams?.billingPeriod ?? PACKAGE_BILLING_PERIOD.MONTHLY
    );
  } catch {
    redirect("/packages");
  }

  const selectedPackage = await getResolvedPublicPackageDefinition(selectedPlanKey);
  const selectedPrice =
    selectedBillingPeriod === PACKAGE_BILLING_PERIOD.YEARLY
      ? selectedPackage.pricing.yearly.formattedPayablePrice.replace("/yr", " one time")
      : selectedPackage.pricing.monthly.formattedPrice;

  return (
    <main className="connexa-dark-shell connexa-public-shell">
      <section className="register-dark-layout">
        <aside className="register-dark-side connexa-public-card">
          <ConnexaLogo dark priority />

          <div className="register-dark-copy">
            <span className="badge auth-badge connexa-public-badge checkout-hero-badge checkout-hero-badge-checkout">Checkout</span>
            <h1>Set up your workspace, then pay with Billplz.</h1>
            <p className="muted">
              Workspace access is only activated after the selected package payment succeeds.
            </p>
          </div>

          <div className="register-plan-card connexa-public-card register-dark-plan-card">
            <div className="register-plan-head">
              <span className="preview-label">Selected package</span>
              <strong>{selectedPackage.name}</strong>
            </div>
            <div className="connexa-pricing-price register-package-price">{selectedPrice}</div>
            <p className="muted">{selectedPackage.summary}</p>
            {selectedBillingPeriod === PACKAGE_BILLING_PERIOD.YEARLY ? (
              <>
                <p className="muted">
                  {`Charged once for one year: ${selectedPackage.pricing.yearly.formattedPayablePrice.replace("/yr", "")}.`}
                </p>
                <p className="muted">
                  {`Effective monthly comparison: ${selectedPackage.pricing.yearly.formattedEffectiveMonthlyPrice}.`}
                </p>
              </>
            ) : null}
            <div className="register-package-highlight-row">
              {selectedPackage.highlights.map((item, index) => (
                <span className={`landing-trust-pill ${getCheckoutPillClass(item, index)}`.trim()} key={item}>
                  {item}
                </span>
              ))}
            </div>
            <div className="register-trust-row">
              {registerTrust.map((item, index) => (
                <span className={`landing-trust-pill ${getCheckoutPillClass(item, index + selectedPackage.highlights.length)}`.trim()} key={item}>
                  {item}
                </span>
              ))}
            </div>
          </div>

          <p className="register-dark-note">
            We will redirect you to Billplz, confirm payment, and only then create the workspace login.
          </p>
        </aside>

        <section className="auth-panel auth-form-panel auth-form-card connexa-public-card connexa-public-form-card register-dark-form-card">
          <div className="auth-form-header">
            <span className="badge auth-badge checkout-form-badge">Owner account</span>
            <h2>{selectedPackage.cta.replace(/^Create /, "Pay for ")}</h2>
            <p className="muted">
              This becomes the first manager account after payment clears. You will enter the workspace only after checkout completion.
            </p>
          </div>

          <CheckoutForm
            selectedPlan={selectedPlanKey}
            selectedBillingPeriod={selectedBillingPeriod}
            selectedPlanLabel={selectedPackage.name}
            selectedPlanPriceAmount={
              selectedBillingPeriod === PACKAGE_BILLING_PERIOD.YEARLY
                ? selectedPackage.pricing.yearly.payablePriceAmount
                : selectedPackage.pricing.monthly.priceAmount
            }
            selectedPlanCurrency={selectedPackage.currency}
          />

          <div className="auth-support-note">
            <span className="muted">
              By continuing, you agree to receive account verification and payment emails.
            </span>
          </div>

          <div className="auth-footer">
            <a className="muted" href="/login">
              Already active? Sign in
            </a>
            <a className="muted" href="/packages">
              Change package
            </a>
            <a className="muted" href="/">
              Back to landing page
            </a>
          </div>
        </section>
      </section>
    </main>
  );
}
