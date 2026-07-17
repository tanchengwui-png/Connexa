import { redirect } from "next/navigation";
import { ConnexaLogo } from "@/components/connexa-logo";
import { VerifyEmailPanel } from "@/components/verify-email-panel";
import { getAgentEntryPath } from "@/lib/auth/entry-path";
import { getCurrentAgent } from "@/lib/auth/current-user";
import { clearSession, createSession } from "@/lib/auth/session";
import { verifyEmailToken } from "@/lib/auth/verification";

type VerifyEmailPageProps = {
  searchParams?: Promise<{
    token?: string;
  }>;
};

export default async function VerifyEmailPage({ searchParams }: VerifyEmailPageProps) {
  const params = searchParams ? await searchParams : undefined;
  const agent = await getCurrentAgent();

  let verified = Boolean(agent?.emailVerifiedAt);
  let tokenError: string | null = null;
  let email = agent?.email ?? "your inbox owner email";
  let continueHref = agent ? await getAgentEntryPath(agent) : "/login";
  let continueLabel = continueHref === "/onboarding" ? "Continue to onboarding" : "Go to inbox";

  if (params?.token) {
    try {
      const verifiedAgent = await verifyEmailToken(params.token);
      await clearSession();
      await createSession({
        agentId: verifiedAgent.id,
        workspaceId: verifiedAgent.workspaceId,
        remember: false
      });
      verified = true;
      email = verifiedAgent.email;
      continueHref = await getAgentEntryPath({
        id: verifiedAgent.id,
        workspaceId: verifiedAgent.workspaceId,
        emailVerifiedAt: new Date(),
        role: verifiedAgent.role
      });
      continueLabel = continueHref === "/onboarding" ? "Continue to onboarding" : "Go to inbox";
    } catch (error) {
      tokenError = error instanceof Error ? error.message : "Unable to verify email.";
    }
  }

  if (!agent && !params?.token) {
    redirect("/login");
  }

  if (verified && agent?.emailVerifiedAt && !params?.token) {
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
          verificationAttempted={Boolean(params?.token)}
          tokenError={tokenError}
          verified={verified}
        />
      </section>
    </main>
  );
}
