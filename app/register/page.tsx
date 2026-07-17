import { redirect } from "next/navigation";
import { ConnexaLogo } from "@/components/connexa-logo";
import { RegisterForm } from "@/components/register-form";
import { getAgentEntryPath } from "@/lib/auth/entry-path";
import { getCurrentAgent } from "@/lib/auth/current-user";
import { getPlatformSubscriptionConfig } from "@/lib/platform-config";

export default async function RegisterPage() {
  const agent = await getCurrentAgent();

  if (agent) {
    redirect(await getAgentEntryPath(agent));
  }

  const { freeTrialDurationDays } = await getPlatformSubscriptionConfig();

  return (
    <main className="connexa-dark-shell connexa-public-shell">
      <section className="register-dark-layout">
        <aside className="register-dark-side connexa-public-card">
          <ConnexaLogo dark priority />

          <div className="register-dark-copy">
            <span className="badge auth-badge connexa-public-badge checkout-hero-badge checkout-hero-badge-trial">Free trial</span>
            <h1>Start using Connexa without a payment step.</h1>
            <p className="muted">
              Create your workspace, verify your email, then sign in. No card or Billplz checkout is required.
            </p>
          </div>

          <div className="register-plan-card connexa-public-card register-dark-plan-card">
            <div className="register-plan-head">
              <span className="preview-label">Trial package</span>
              <strong>Starter Free Trial</strong>
            </div>
            <p className="muted">{freeTrialDurationDays} days with Starter package limits.</p>
            <div className="register-package-highlight-row">
              <span className="landing-trust-pill register-trial-pill register-trial-pill-emerald">Free trial - no payment to start</span>
              <span className="landing-trust-pill register-trial-pill register-trial-pill-blue">Upgrade anytime</span>
              <span className="landing-trust-pill register-trial-pill register-trial-pill-amber">Email verification required</span>
            </div>
          </div>
        </aside>

        <section className="auth-panel auth-form-panel auth-form-card connexa-public-card connexa-public-form-card register-dark-form-card">
          <div className="auth-form-header">
            <span className="badge auth-badge checkout-form-badge">Owner account</span>
            <h2>Create your free-trial workspace</h2>
            <p className="muted">The trial starts when your email is verified.</p>
          </div>

          <RegisterForm selectedPlan="starter" selectedPlanLabel="Starter Free Trial" />

          <div className="auth-footer">
            <a className="muted" href="/login">Already registered? Sign in</a>
            <a className="muted" href="/packages">View paid packages</a>
            <a className="muted" href="/">Back to landing page</a>
          </div>
        </section>
      </section>
    </main>
  );
}
