import { AcceptInviteForm } from "@/components/accept-invite-form";
import { ConnexaLogo } from "@/components/connexa-logo";
import { getInviteByToken } from "@/lib/auth/invites";

type InvitePageProps = {
  params: Promise<{
    token: string;
  }>;
};

export default async function InvitePage({ params }: InvitePageProps) {
  const { token } = await params;
  const invite = await getInviteByToken(token);

  return (
    <main className="auth-shell auth-centered-shell invite-shell">
      <section className="auth-center-column auth-center-column-wide">
        <ConnexaLogo centered dark priority />

        <div className="auth-top-copy auth-top-copy-balanced invite-top-copy">
          <span className="badge auth-badge">Workspace invitation</span>
          <h1>{invite ? `Join ${invite.workspace.name}` : "Invitation unavailable"}</h1>
          <p className="muted">
            {invite
              ? `${invite.invitedBy.name} invited ${invite.email} to join this workspace as ${invite.role.toLowerCase()}.`
              : "This invite is invalid, expired, or has already been used."}
          </p>
        </div>

        <section className="auth-panel auth-form-panel auth-form-card connexa-public-card connexa-public-form-card register-dark-form-card invite-accept-card">
          {invite ? (
            <>
              <div className="auth-form-header invite-accept-header">
                <span className="badge auth-badge">Accept invitation</span>
                <p className="muted">
                  Create your password once to join the workspace and continue to the inbox.
                </p>
              </div>
              <div className="invite-summary-row">
                <div className="invite-summary-item">
                  <span className="preview-label">Invited by</span>
                  <strong>{invite.invitedBy.name}</strong>
                </div>
                <div className="invite-summary-item">
                  <span className="preview-label">Role</span>
                  <strong>{invite.role}</strong>
                </div>
              </div>
              <AcceptInviteForm token={token} />
            </>
          ) : (
            <div className="auth-support-note invite-empty-state">
              <strong>Invite link unavailable</strong>
              <span className="muted">Ask your workspace admin to send a new invitation.</span>
              <a className="button button-secondary auth-submit" href="/">
                Back to homepage
              </a>
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
