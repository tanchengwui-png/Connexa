import { redirect } from "next/navigation";
import { ConnexaLogo } from "@/components/connexa-logo";
import { VerifyEmailPanel } from "@/components/verify-email-panel";
import { getAgentEntryPath } from "@/lib/auth/entry-path";
import { getCurrentAgent } from "@/lib/auth/current-user";

type VerifyEmailPageProps = {
  searchParams?: Promise<{
    token?: string;
    verification?: string;
  }>;
};

const VERIFICATION_ERRORS: Record<string, string> = {
  expired: "This verification link has expired.",
  invalid: "Invalid verification link.",
  failed: "Unable to verify email. Please request a new verification link."
};

export default async function VerifyEmailPage({ searchParams }: VerifyEmailPageProps) {
  const params = searchParams ? await searchParams : undefined;

  if (params?.token) {
    redirect(`/api/auth/verify-email?token=${encodeURIComponent(params.token)}`);
  }

  const agent = await getCurrentAgent();
  const verificationStatus = params?.verification ?? "";

  const verified = Boolean(agent?.emailVerifiedAt);
  const tokenError = VERIFICATION_ERRORS[verificationStatus] ?? null;
  const email = agent?.email ?? "your inbox owner email";
  const continueHref = agent ? await getAgentEntryPath(agent) : "/login";
  const continueLabel = continueHref === "/onboarding" ? "Continue to onboarding" : "Go to inbox";

  if (!agent && !verificationStatus) {
    redirect("/login");
  }

  if (verified && agent?.emailVerifiedAt && verificationStatus !== "success") {
    redirect(await getAgentEntryPath(agent));
  }

  return (
    <main className="connexa-dark-shell connexa-public-shell">
      <section className="register-dark-layout verify-dark-layout">
        <aside className="register-dark-side connexa-public-card">
          <ConnexaLogo dark priority />

          <div className="register-dark-copy">
            <span className="badge auth-badge connexa-public-badge verify-email-required-badge">Verification required</span>
            <h1>Confirm your email to enter Connexa</h1>
            <p className="muted">
              Email confirmation is required before your account can access the workspace.
            </p>
          </div>

          <div className="register-plan-card connexa-public-card register-dark-plan-card">
            <div className="register-plan-head">
              <span className="preview-label">Inbox owner email</span>
              <strong>{email}</strong>
            </div>
            <p className="muted">
              Open the verification email we sent and confirm the address before continuing.
            </p>
          </div>

          <p className="register-dark-note">
            This protects the workspace and ensures you receive account and security updates.
          </p>
        </aside>

        <VerifyEmailPanel
          continueHref={continueHref}
          continueLabel={continueLabel}
          email={email}
          verificationAttempted={verificationStatus === "success"}
          tokenError={tokenError}
          verified={verified}
        />
      </section>
    </main>
  );
}
