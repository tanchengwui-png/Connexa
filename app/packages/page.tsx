import { ConnexaLogo } from "@/components/connexa-logo";
import { PublicPackagesGrid } from "@/components/public-packages-grid";
import { registerTrust } from "@/lib/public-packages";

export default function PackagesPage() {
  return (
    <main className="connexa-dark-shell connexa-public-shell packages-page-shell">
      <section className="packages-page-header">
        <ConnexaLogo dark priority />

        <div className="packages-page-copy">
          <span className="badge auth-badge connexa-public-badge">Choose your package</span>
          <h1>Choose the package, then go to payment before workspace access.</h1>
          <p className="muted">
            Compare the packages first. When you choose one, we&apos;ll take you to checkout, collect
            the owner account details, and send you to Billplz before the login is activated.
          </p>
        </div>

        <div className="register-trust-row">
          {registerTrust.map((item) => (
            <span className="landing-trust-pill" key={item}>
              {item}
            </span>
          ))}
        </div>
      </section>

      <section className="connexa-section packages-page-section">
        <PublicPackagesGrid />
      </section>
    </main>
  );
}
