import { ConnexaLogo } from "@/components/connexa-logo";
import { ResetPasswordForm } from "@/components/reset-password-form";
import {
  getPasswordResetTokenStatus,
  maskPasswordResetEmail
} from "@/lib/auth/password-reset";

type ResetPasswordPageProps = {
  searchParams?: Promise<{
    token?: string;
  }>;
};

export default async function ResetPasswordPage({ searchParams }: ResetPasswordPageProps) {
  const params = searchParams ? await searchParams : undefined;
  const token = params?.token?.trim() ?? "";
  const tokenStatus = await getPasswordResetTokenStatus(token);

  return (
    <main className="connexa-dark-shell connexa-public-shell auth-centered-shell forgot-password-shell">
      <section className="auth-center-column forgot-password-column">
        <ConnexaLogo centered />

        <section className="auth-panel auth-form-panel auth-form-card connexa-public-card connexa-public-form-card forgot-password-card">
          <div className="auth-form-header">
            <span className="badge auth-badge">Password reset</span>
            <h2>{tokenStatus.ok ? "Set a new password" : "Reset link unavailable"}</h2>
            <p className="muted">
              {tokenStatus.ok
                ? `Choose a new password for ${maskPasswordResetEmail(tokenStatus.email)}.`
                : tokenStatus.error}
            </p>
          </div>

          {tokenStatus.ok ? (
            <ResetPasswordForm token={token} />
          ) : (
            <div className="forgot-password-form">
              <p className="form-error" role="alert">
                {tokenStatus.error}
              </p>
              <a className="button button-primary auth-submit forgot-password-submit" href="/forgot-password">
                Request a new reset link
              </a>
              <div className="forgot-password-footer">
                <a className="auth-inline-link" href="/login">
                  Back to login
                </a>
              </div>
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
