import { redirect } from "next/navigation";
import { ConnexaLogo } from "@/components/connexa-logo";
import { LoginForm } from "@/components/login-form";
import { getCurrentAgent } from "@/lib/auth/current-user";

export default async function LoginPage() {
  const agent = await getCurrentAgent();

  if (agent) {
    redirect(agent.emailVerifiedAt ? "/inbox" : "/verify-email");
  }

  return (
    <main className="connexa-dark-shell connexa-public-shell metrica-login-shell">
      <section className="metrica-login-layout">
        <aside className="metrica-login-side">
          <ConnexaLogo dark priority />

          <div className="metrica-login-copy">
            <span className="metrica-kicker">Workspace access</span>
            <h1>Run team conversations with more control.</h1>
            <p>
              Sign in to continue with live enquiries, follow-up visibility, and internal
              team context from one shared inbox.
            </p>
          </div>

          <div className="metrica-login-visual" aria-hidden="true">
            <div className="metrica-login-orb orb-one" />
            <div className="metrica-login-orb orb-two" />
            <div className="metrica-login-orb orb-three" />
          </div>
        </aside>

        <section className="metrica-login-card">
          <div className="metrica-login-card-brand">
            <ConnexaLogo centered dark />
          </div>

          <div className="metrica-login-card-header">
            <span className="metrica-login-card-kicker">Welcome back</span>
            <h2>Let&apos;s Get Started</h2>
            <p>Sign in to continue to Connexa.</p>
          </div>

          <LoginForm />

          <div className="metrica-login-footer">
            <span className="muted">Don&apos;t have an account?</span>
            <a className="auth-inline-link" href="/register">
              Create your workspace
            </a>
          </div>
        </section>
      </section>
    </main>
  );
}
