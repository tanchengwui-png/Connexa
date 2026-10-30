import { BillingLinkAccountSwitcher } from "@/components/billing-link-account-switcher";
import { ConnexaLogo } from "@/components/connexa-logo";
import { getSafeReturnTo } from "@/lib/auth/return-to";

export default async function BillingLinkInvalidPage({
  searchParams
}: {
  searchParams?: Promise<{ returnTo?: string | string[] }>;
}) {
  const params = await searchParams;
  const rawReturnTo = Array.isArray(params?.returnTo) ? params.returnTo[0] : params?.returnTo;
  const returnTo = getSafeReturnTo(rawReturnTo, "/account-settings/billing");

  return (
    <main className="connexa-dark-shell connexa-public-shell auth-centered-shell forgot-password-shell">
      <section className="auth-center-column forgot-password-column">
        <ConnexaLogo centered />

        <section className="auth-panel auth-form-panel auth-form-card connexa-public-card connexa-public-form-card forgot-password-card">
          <div className="auth-form-header">
            <span className="badge auth-badge">Billing and Subscription</span>
            <h2>Manage Plan link unavailable</h2>
            <p className="muted">
              This link is invalid, has expired, or belongs to a different Connexa account.
              Sign in with the email address that received the plan reminder and try again.
            </p>
          </div>

          <BillingLinkAccountSwitcher returnTo={returnTo} />
        </section>
      </section>
    </main>
  );
}
