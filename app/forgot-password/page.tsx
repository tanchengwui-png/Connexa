import { redirect } from "next/navigation";
import { ConnexaLogo } from "@/components/connexa-logo";
import { ForgotPasswordForm } from "@/components/forgot-password-form";
import { getAgentEntryPath } from "@/lib/auth/entry-path";
import { getCurrentAgent } from "@/lib/auth/current-user";

export default async function ForgotPasswordPage() {
  const agent = await getCurrentAgent();

  if (agent) {
    redirect(await getAgentEntryPath(agent));
  }

  return (
    <main className="connexa-dark-shell connexa-public-shell auth-centered-shell forgot-password-shell">
      <section className="auth-center-column forgot-password-column">
        <ConnexaLogo centered />

        <section className="auth-panel auth-form-panel auth-form-card connexa-public-card connexa-public-form-card forgot-password-card">
          <div className="auth-form-header">
            <span className="badge auth-badge">Password reset</span>
            <h2>Forgot your password?</h2>
            <p className="muted">
              Enter your email and we&apos;ll help you recover access to your workspace.
            </p>
          </div>

          <ForgotPasswordForm />
        </section>
      </section>
    </main>
  );
}
