import { redirect } from "next/navigation";
import { ConnexaLogo } from "@/components/connexa-logo";
import { LoginForm } from "@/components/login-form";
import { getAgentEntryPath } from "@/lib/auth/entry-path";
import { getCurrentAgent } from "@/lib/auth/current-user";
import { resolveAgentAuthState } from "@/lib/auth/session";
import { getSessionExpiryMessage } from "@/lib/session-timeout";

export default async function LoginPage(props: {
  searchParams?: Promise<{ reason?: string | string[] }>;
}) {
  const agent = await getCurrentAgent();
  const searchParams = await props.searchParams;
  const authState = await resolveAgentAuthState({ mode: "page" });

  if (agent) {
    redirect(await getAgentEntryPath(agent));
  }

  if (authState.status === "restore_required") {
    redirect("/api/auth/session/restore?returnTo=%2Finbox");
  }

  const sessionMessage = getSessionExpiryMessage(searchParams?.reason);

  return (
    <main className="connexa-dark-shell connexa-public-shell metrica-login-shell">
      <section className="metrica-login-layout">
        <aside className="metrica-login-side">
          <ConnexaLogo priority />

          <div className="metrica-login-copy">
            <span className="metrica-kicker metrica-kicker-workspace">Workspace access</span>
            <h1>
              Run team conversations
              <br />
              with <span className="metrica-login-copy-accent">more control.</span>
            </h1>
            <p>
              Sign in to continue with live enquiries, follow-up visibility, and internal
              team context from one shared inbox.
            </p>
          </div>

          <div className="metrica-login-visual" aria-hidden="true">
            <div className="metrica-login-flow">
              <div className="metrica-login-flow-card">
                <span className="metrica-login-flow-icon whatsapp">W</span>
                <strong>Customer Message</strong>
                <p>Hi, interested in your package.</p>
              </div>

              <div className="metrica-login-flow-link" />

              <div className="metrica-login-flow-card">
                <span className="metrica-login-flow-icon bot">AI</span>
                <strong>AI Auto Reply</strong>
                <p>Thanks for reaching out. How can we help today?</p>
              </div>

              <div className="metrica-login-flow-link" />

              <div className="metrica-login-flow-card">
                <span className="metrica-login-flow-icon agent">S</span>
                <strong>Assigned to Sarah</strong>
                <p>Owner notified and online.</p>
              </div>

              <div className="metrica-login-flow-link" />

              <div className="metrica-login-flow-card">
                <span className="metrica-login-flow-icon calendar">15</span>
                <strong>Follow-up Scheduled</strong>
                <p>Tomorrow, 10:00 AM</p>
              </div>
            </div>

            <div className="metrica-login-outcome-card">
              <span className="metrica-login-outcome-badge">✓</span>
              <div>
                <strong>Customer Converted</strong>
                <p>Deal won and tracked in one place.</p>
              </div>
            </div>
          </div>
        </aside>

        <section className="metrica-login-card">
          <div className="metrica-login-card-brand">
            <ConnexaLogo centered />
          </div>

          <div className="metrica-login-card-header">
            <span className="metrica-login-card-kicker metrica-login-card-kicker-workspace">Welcome back</span>
            <h2>Let&apos;s Get Started</h2>
            <p>Sign in to continue to Connexa.</p>
          </div>

          <LoginForm sessionMessage={sessionMessage} />

          <div className="metrica-login-footer">
            <span className="muted">Don&apos;t have an account?</span>
            <a className="auth-inline-link" href="/packages">
              View available packages
            </a>
          </div>
        </section>
      </section>
    </main>
  );
}
