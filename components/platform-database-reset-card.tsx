"use client";

import { useState } from "react";
import { useConfirmation } from "@/components/confirmation-provider";
import { useToast } from "@/components/toast-provider";

type DatabaseResetResult = {
  target: {
    host: string | null;
    port: string | null;
    database: string | null;
  };
  seededPlatformOwner: {
    email: string;
  };
  login: {
    email: string;
    passwordHint: string;
  };
  remaining: {
    platformAdmins: number;
    platformSessions: number;
    platformConfigs: number;
    platformPackageConfigs: number;
    workspaces: number;
    agents: number;
    accounts: number;
  };
};

export function PlatformDatabaseResetCard() {
  const { confirm } = useConfirmation();
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);
  const [result, setResult] = useState<DatabaseResetResult | null>(null);

  async function handleReset() {
    const approved = await confirm({
      title: "Factory reset the database?",
      description:
        "This removes current workspace and platform state, then recreates only the seeded platform owner account.",
      confirmLabel: "Reset database",
      cancelLabel: "Keep data",
      tone: "danger"
    });

    if (!approved) {
      return;
    }

    setPending(true);
    setError(null);
    setCompleted(false);
    setResult(null);

    try {
      const response = await fetch("/api/platform/database/reset", {
        method: "POST"
      });
      const data = (await response.json()) as {
        error?: string;
        result?: DatabaseResetResult;
      };

      if (!response.ok) {
        throw new Error(data.error ?? "Unable to reset the demo database.");
      }

      setResult(data.result ?? null);
      setCompleted(true);
      toast.success(
        "Database reset complete",
        data.result?.seededPlatformOwner.email
          ? `Only ${data.result.seededPlatformOwner.email} remains.`
          : "The database was reset successfully."
      );
    } catch (caughtError) {
      const nextError = caughtError instanceof Error ? caughtError.message : "Unable to reset the database.";
      setError(nextError);
      toast.error("Database reset failed", nextError);
    } finally {
      setPending(false);
    }
  }

  const targetLabel = result
    ? `${result.target.database ?? "Unknown database"} · ${result.target.host ?? "Unknown host"}:${result.target.port ?? "?"}`
    : null;

  return (
    <section className="content-card settings-dark-panel platform-danger-panel platform-database-reset-card">
      <header className="platform-database-reset-head">
        <span className="platform-database-reset-kicker">Destructive action</span>
        <h3 className="card-title">Database reset</h3>
        <p>Remove all workspace and platform data, then recreate only the platform owner account.</p>
      </header>

      <div className="platform-database-reset-warning">
        <span aria-hidden="true" className="platform-database-reset-warning-icon">!</span>
        <div className="platform-danger-copy">
          <strong>This permanently deletes current data</strong>
          <p>
            Contacts, conversations, leads, products, automations, sessions, package settings, and SMTP configuration
            will be removed.
          </p>
          <p>Only the seeded platform owner account will remain after the reset.</p>
        </div>
      </div>

      <div className="platform-database-reset-actions">
        <div>
          <strong>Reset all platform data</strong>
          <span>You will be asked to confirm before deletion begins.</span>
        </div>
        <button className="confirmation-dialog-danger" disabled={pending} onClick={handleReset} type="button">
          {pending ? "Resetting..." : "Reset database"}
        </button>
      </div>

      {completed ? (
        <div aria-live="polite" className="platform-database-reset-result" role="status">
          <div className="platform-database-reset-result-head">
            <span aria-hidden="true">✓</span>
            <div>
              <strong>Database reset complete</strong>
              <p>The old platform data was removed and the owner account was reseeded.</p>
            </div>
          </div>

          {result ? (
            <>
              <dl className="platform-database-reset-summary">
                <div>
                  <dt>Target</dt>
                  <dd>{targetLabel}</dd>
                </div>
                <div>
                  <dt>Seeded owner</dt>
                  <dd>{result.seededPlatformOwner.email}</dd>
                </div>
                <div>
                  <dt>Workspace data</dt>
                  <dd>
                    {result.remaining.workspaces} workspaces · {result.remaining.agents} agents · {result.remaining.accounts} accounts
                  </dd>
                </div>
              </dl>
              <p className="platform-database-reset-result-note">
                Platform records: {result.remaining.platformAdmins} admin · {result.remaining.platformSessions} sessions · {result.remaining.platformConfigs} config · {result.remaining.platformPackageConfigs} package configs. {result.login.passwordHint}
              </p>
            </>
          ) : null}
        </div>
      ) : null}
      {error ? <p className="form-error platform-database-reset-error" role="alert">{error}</p> : null}
    </section>
  );
}
