"use client";

import React from "react";
import { useRef, useState, useTransition } from "react";
import { useConfirmation } from "@/components/confirmation-provider";
import { PortalDropdown } from "@/components/inbox/portal-dropdown";
import { useToast } from "@/components/toast-provider";

type UserRow = {
  id: string;
  name: string;
  email: string;
  packageName: string;
  packageStatus: string;
  packageExpiryLabel: string;
  status: string;
  emailVerified: boolean;
  emailVerifiedLabel: string;
  lastLoginLabel: string;
  passwordLastUpdatedLabel: string;
  createdAtLabel: string;
};

type UserDetails = {
  id: string;
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
  name: string;
  email: string;
  role: string;
  status: string;
  packageName: string;
  packageStatus: string;
  packageExpiryLabel: string;
  lastLoginLabel: string;
  passwordLastUpdatedLabel: string;
  createdAtLabel: string;
  updatedAtLabel: string;
  emailVerifiedLabel: string;
  inviteAcceptedLabel: string;
  emailVerified: boolean;
};

type UserLog = {
  id: string;
  eventType: string;
  eventLabel: string;
  createdAtLabel: string;
  metadata: Array<{ key: string; value: string }>;
};

type ResetAvailability = {
  enabled: boolean;
  helperText: string | null;
};

type PlatformUserSecurityManagerProps = {
  users: UserRow[];
  resetAvailability: ResetAvailability;
};

type PlatformSecurityRowActionsProps = {
  isPending: boolean;
  onOpenDetails: (userId: string) => void | Promise<void>;
  onOpenLogs: (user: UserRow) => void | Promise<void>;
  onResendVerification: (user: UserRow) => void | Promise<void>;
  onSendReset: (user: UserRow) => void | Promise<void>;
  resetAvailability: ResetAvailability;
  user: UserRow;
};

function PlatformSecurityRowActions({
  isPending,
  onOpenDetails,
  onOpenLogs,
  onResendVerification,
  onSendReset,
  resetAvailability,
  user
}: PlatformSecurityRowActionsProps) {
  const actionMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  function runMenuAction(action: () => void | Promise<void>) {
    setIsMenuOpen(false);
    void action();
  }

  return (
    <div className="platform-security-actions">
      <div className="platform-security-actions-inline">
        <button className="inbox-dialog-secondary" disabled={isPending} onClick={() => void onOpenDetails(user.id)} type="button">
          View Details
        </button>
        <button
          className="inbox-dialog-primary"
          disabled={isPending || !resetAvailability.enabled}
          onClick={() => void onSendReset(user)}
          type="button"
        >
          Send Reset Password Email
        </button>
        {!user.emailVerified ? (
          <button
            className="inbox-dialog-primary"
            disabled={isPending}
            onClick={() => void onResendVerification(user)}
            type="button"
          >
            Resend Verification Email
          </button>
        ) : null}
        <button className="inbox-dialog-secondary" disabled={isPending} onClick={() => void onOpenLogs(user)} type="button">
          View Security Logs
        </button>
      </div>

      <button
        aria-expanded={isMenuOpen}
        aria-haspopup="menu"
        className="inbox-dialog-secondary platform-security-actions-trigger"
        disabled={isPending}
        onClick={() => setIsMenuOpen((current) => !current)}
        ref={actionMenuButtonRef}
        type="button"
      >
        Actions
      </button>

      <PortalDropdown
        align="end"
        anchorRef={actionMenuButtonRef}
        className="inbox-portal-menu platform-security-actions-menu"
        onClose={() => setIsMenuOpen(false)}
        open={isMenuOpen}
      >
        <div aria-label={`Security actions for ${user.name}`} className="inbox-menu-panel" role="menu">
          <button className="inbox-menu-item" disabled={isPending} onClick={() => runMenuAction(() => onOpenDetails(user.id))} role="menuitem" type="button">
            View Details
          </button>
          <button
            className="inbox-menu-item"
            disabled={isPending || !resetAvailability.enabled}
            onClick={() => runMenuAction(() => onSendReset(user))}
            role="menuitem"
            type="button"
          >
            Send Reset Password Email
          </button>
          {!user.emailVerified ? (
            <button
              className="inbox-menu-item"
              disabled={isPending}
              onClick={() => runMenuAction(() => onResendVerification(user))}
              role="menuitem"
              type="button"
            >
              Resend Verification Email
            </button>
          ) : null}
          <button className="inbox-menu-item" disabled={isPending} onClick={() => runMenuAction(() => onOpenLogs(user))} role="menuitem" type="button">
            View Security Logs
          </button>
        </div>
      </PortalDropdown>
    </div>
  );
}

export function PlatformUserSecurityManager({
  users,
  resetAvailability
}: PlatformUserSecurityManagerProps) {
  const { confirm } = useConfirmation();
  const { success, error: showError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<UserDetails | null>(null);
  const [logsState, setLogsState] = useState<{ userName: string; logs: UserLog[] } | null>(null);

  async function openDetails(userId: string) {
    setError(null);

    const response = await fetch(`/api/platform/security/users/${userId}`);
    const payload = (await response.json().catch(() => null)) as { error?: string; user?: UserDetails } | null;

    if (!response.ok || !payload?.user) {
      setError(payload?.error ?? "Unable to load user details.");
      return;
    }

    setDetails(payload.user);
  }

  async function openLogs(user: UserRow) {
    setError(null);

    const response = await fetch(`/api/platform/security/users/${user.id}/logs`);
    const payload = (await response.json().catch(() => null)) as { error?: string; logs?: UserLog[] } | null;

    if (!response.ok) {
      setError(payload?.error ?? "Unable to load security logs.");
      return;
    }

    setLogsState({
      userName: user.name,
      logs: payload?.logs ?? []
    });
  }

  async function sendReset(user: UserRow) {
    if (!resetAvailability.enabled) {
      setError(resetAvailability.helperText ?? "Password reset email is unavailable.");
      return;
    }

    const accepted = await confirm({
      title: "Send reset password email",
      description:
        "This will send a password reset email to this user. You will not be able to set or view their password.",
      confirmLabel: "Send reset email"
    });

    if (!accepted) {
      return;
    }

    setError(null);
    startTransition(async () => {
      const response = await fetch(`/api/platform/security/users/${user.id}/reset-password`, {
        method: "POST"
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;

      if (!response.ok) {
        const message = payload?.error ?? "Unable to send reset password email.";
        setError(message);
        showError("Reset email failed", message);
        return;
      }

      success("Reset email sent", `Password reset instructions were sent to ${user.email}.`);
    });
  }

  async function resendVerification(user: UserRow) {
    const accepted = await confirm({
      title: "Resend verification email",
      description:
        `This will send a new email verification link to ${user.email}. The user must verify before they can access the workspace.`,
      confirmLabel: "Send verification email"
    });

    if (!accepted) {
      return;
    }

    setError(null);
    startTransition(async () => {
      const response = await fetch(`/api/platform/security/users/${user.id}/resend-verification`, {
        method: "POST"
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;

      if (!response.ok) {
        const message = payload?.error ?? "Unable to resend verification email.";
        setError(message);
        showError("Verification email failed", message);
        return;
      }

      success("Verification email sent", `A verification link was sent to ${user.email}.`);
    });
  }

  return (
    <section className="content-card settings-dark-panel platform-packages-form-panel platform-security-panel">
      <div className="card-header settings-dark-panel-head">
        <div>
          <h3 className="card-title">User Management / Account Security</h3>
          <p className="muted">
            Review platform users, inspect safe account details, and trigger secure reset emails when reset-link delivery is configured.
          </p>
        </div>
      </div>

      {error ? <p className="form-error">{error}</p> : null}
      {!resetAvailability.enabled && resetAvailability.helperText ? (
        <p className="table-subtle">{resetAvailability.helperText}</p>
      ) : null}

      <div aria-label="User management table" className="platform-security-table-shell" tabIndex={0}>
        <table className="platform-security-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Package</th>
              <th>Package Status</th>
              <th>Package Expiry</th>
              <th>Status</th>
              <th>Last Login</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td title={user.name}>
                  <span className="platform-security-cell-truncate">{user.name}</span>
                </td>
                <td title={user.email}>
                  <span className="platform-security-cell-truncate">{user.email}</span>
                </td>
                <td>{user.packageName}</td>
                <td>{user.packageStatus}</td>
                <td>{user.packageExpiryLabel}</td>
                <td>{user.status}</td>
                <td>{user.lastLoginLabel}</td>
                <td>
                  <PlatformSecurityRowActions
                    isPending={isPending}
                    onOpenDetails={openDetails}
                    onOpenLogs={openLogs}
                    onResendVerification={resendVerification}
                    onSendReset={sendReset}
                    resetAvailability={resetAvailability}
                    user={user}
                  />
                </td>
              </tr>
            ))}
            {!users.length ? (
              <tr>
                <td className="table-subtle" colSpan={8}>
                  No users found.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {details ? (
        <div className="inbox-dialog-backdrop" onClick={() => setDetails(null)}>
          <div
            aria-modal="true"
            className="inbox-dialog confirmation-dialog platform-security-dialog"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="inbox-dialog-head">
              <div>
                <strong>{details.name}</strong>
                <p>Safe user details only. Sensitive credentials are never shown.</p>
              </div>
              <button aria-label="Close details" className="inbox-dialog-close" onClick={() => setDetails(null)} type="button">
                x
              </button>
            </div>

            <div className="inbox-dialog-body platform-security-detail-grid">
              <div>
                <span>User ID</span>
                <strong>{details.id}</strong>
              </div>
              <div>
                <span>Email</span>
                <strong>{details.email}</strong>
              </div>
              <div>
                <span>Workspace</span>
                <strong>{details.workspaceName}</strong>
              </div>
              <div>
                <span>Workspace Slug</span>
                <strong>{details.workspaceSlug}</strong>
              </div>
              <div>
                <span>Package</span>
                <strong>{details.packageName}</strong>
              </div>
              <div>
                <span>Package Status</span>
                <strong>{details.packageStatus}</strong>
              </div>
              <div>
                <span>Package Expiry</span>
                <strong>{details.packageExpiryLabel}</strong>
              </div>
              <div>
                <span>Status</span>
                <strong>{details.status}</strong>
              </div>
              <div>
                <span>Role</span>
                <strong>{details.role}</strong>
              </div>
              <div>
                <span>Last Login</span>
                <strong>{details.lastLoginLabel}</strong>
              </div>
              <div>
                <span>Password Last Updated</span>
                <strong>{details.passwordLastUpdatedLabel}</strong>
              </div>
              <div>
                <span>Email Verified</span>
                <strong>{details.emailVerifiedLabel}</strong>
              </div>
              <div>
                <span>Invite Accepted</span>
                <strong>{details.inviteAcceptedLabel}</strong>
              </div>
              <div>
                <span>Created At</span>
                <strong>{details.createdAtLabel}</strong>
              </div>
            </div>

            <div className="inbox-dialog-actions">
              <div className="inbox-dialog-actions-right">
                <button className="inbox-dialog-primary" onClick={() => setDetails(null)} type="button">
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {logsState ? (
        <div className="inbox-dialog-backdrop" onClick={() => setLogsState(null)}>
          <div
            aria-modal="true"
            className="inbox-dialog confirmation-dialog platform-security-dialog"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="inbox-dialog-head">
              <div>
                <strong>{logsState.userName} security logs</strong>
                <p>Only safe audit fields are shown here.</p>
              </div>
              <button aria-label="Close logs" className="inbox-dialog-close" onClick={() => setLogsState(null)} type="button">
                x
              </button>
            </div>

            <div className="inbox-dialog-body platform-security-log-body">
              {logsState.logs.length ? (
                <div className="platform-security-log-list">
                  {logsState.logs.map((log) => (
                    <article className="platform-security-log-item" key={log.id}>
                      <div className="platform-security-log-head">
                        <strong>{log.eventLabel}</strong>
                        <span className="table-subtle">{log.createdAtLabel}</span>
                      </div>
                      {log.metadata.length ? (
                        <div className="platform-security-log-meta">
                          {log.metadata.map((item) => (
                            <span className="table-subtle" key={`${log.id}-${item.key}`}>
                              {item.key}: {item.value}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </article>
                  ))}
                </div>
              ) : (
                <p className="table-subtle">No security logs are recorded for this user yet.</p>
              )}
            </div>

            <div className="inbox-dialog-actions">
              <div className="inbox-dialog-actions-right">
                <button className="inbox-dialog-primary" onClick={() => setLogsState(null)} type="button">
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
