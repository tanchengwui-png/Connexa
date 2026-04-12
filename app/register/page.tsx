import { redirect } from "next/navigation";
import { ConnexaLogo } from "@/components/connexa-logo";
import { RegisterForm } from "@/components/register-form";
import { getCurrentAgent } from "@/lib/auth/current-user";

const registerTrust = ["14-day trial", "No credit card required", "Cancel anytime"];

const packageContent = {
  starter: {
    name: "Starter",
    summary: "Best for smaller agency teams getting their first shared WhatsApp workspace live.",
    cta: "Start Starter trial"
  },
  growth: {
    name: "Growth",
    summary: "Best for active teams that need stronger handoff, assignment, and follow-up structure.",
    cta: "Start Growth trial"
  },
  enterprise: {
    name: "Enterprise",
    summary: "Best for larger operations that want rollout support and flexible team setup.",
    cta: "Start Enterprise trial"
  }
} satisfies Record<string, { name: string; summary: string; cta: string }>;

export default async function RegisterPage({
  searchParams
}: {
  searchParams?: Promise<{ plan?: string }>;
}) {
  const agent = await getCurrentAgent();
  const resolvedSearchParams = await searchParams;
  const selectedPlanKey = resolvedSearchParams?.plan && resolvedSearchParams.plan in packageContent
    ? resolvedSearchParams.plan
    : "starter";
  const selectedPackage = packageContent[selectedPlanKey as keyof typeof packageContent];

  if (agent) {
    redirect(agent.emailVerifiedAt ? "/inbox" : "/verify-email");
  }

  return (
    <main className="connexa-dark-shell connexa-public-shell">
      <section className="register-dark-layout">
        <aside className="register-dark-side connexa-public-card">
          <ConnexaLogo dark priority />

          <div className="register-dark-copy">
            <span className="badge auth-badge connexa-public-badge">Sign up</span>
            <h1>Create your Connexa workspace</h1>
            <p className="muted">
              Your selected package stays attached to this workspace while you create the
              first manager account.
            </p>
          </div>

          <div className="register-plan-card connexa-public-card register-dark-plan-card">
            <div className="register-plan-head">
              <span className="preview-label">Selected package</span>
              <strong>{selectedPackage.name}</strong>
            </div>
            <p className="muted">{selectedPackage.summary}</p>
            <div className="register-trust-row">
              {registerTrust.map((item) => (
                <span className="landing-trust-pill" key={item}>
                  {item}
                </span>
              ))}
            </div>
          </div>

          <p className="register-dark-note">
            You can adjust your commercial plan later. For now, complete the workspace
            setup and verify the account email first.
          </p>
        </aside>

        <section className="auth-panel auth-form-panel auth-form-card connexa-public-card connexa-public-form-card register-dark-form-card">
          <div className="auth-form-header">
            <span className="badge auth-badge">Admin account</span>
            <h2>{selectedPackage.cta}</h2>
            <p className="muted">
              This account becomes the first workspace manager. After signup, you will verify
              your email before entering the workspace.
            </p>
          </div>

          <RegisterForm selectedPlan={selectedPlanKey} selectedPlanLabel={selectedPackage.name} />

          <div className="auth-support-note">
            <span className="muted">
              By continuing, you agree to receive account verification and product emails.
            </span>
          </div>

          <div className="auth-footer">
            <a className="muted" href="/login">
              Already have an account? Sign in
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
