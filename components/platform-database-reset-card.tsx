"use client";

import { useState } from "react";
import { useConfirmation } from "@/components/confirmation-provider";
import { useToast } from "@/components/toast-provider";

export function PlatformDatabaseResetCard() {
  const { confirm } = useConfirmation();
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

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
    setMessage(null);

    try {
      const response = await fetch("/api/platform/database/reset", {
        method: "POST"
      });
      const data = (await response.json()) as {
        error?: string;
        result?: {
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
      };

      if (!response.ok) {
        throw new Error(data.error ?? "Unable to reset the demo database.");
      }

      const remaining = data.result?.remaining;
      const target = data.result?.target;
      const owner = data.result?.seededPlatformOwner;
      const login = data.result?.login;
      const successMessage =
        remaining && owner && login
          ? `Database reset on ${target?.database ?? "unknown"}@${target?.host ?? "unknown"}:${target?.port ?? "?"}. Only ${owner.email} was reseeded. Remaining rows: ${remaining.platformAdmins} platform admin, ${remaining.platformSessions} platform sessions, ${remaining.platformConfigs} platform config, ${remaining.platformPackageConfigs} platform package configs, ${remaining.workspaces} workspaces, ${remaining.agents} agents, ${remaining.accounts} accounts. ${login.passwordHint}`
          : "Database reset completed.";
      setMessage(successMessage);
      toast.success("Database reset complete", successMessage);
    } catch (caughtError) {
      const nextError = caughtError instanceof Error ? caughtError.message : "Unable to reset the database.";
      setError(nextError);
      toast.error("Database reset failed", nextError);
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="content-card settings-dark-panel platform-danger-panel">
      <div className="card-header settings-dark-panel-head">
        <div>
          <h3 className="card-title">Database reset</h3>
          <p className="muted">Wipe current data and reseed only the platform owner account from platform admin.</p>
        </div>
      </div>

      <div className="platform-danger-copy">
        <p>
          This action deletes current workspace records and platform state including contacts, conversations, leads,
          products, automations, sessions, package settings, and SMTP configuration.
        </p>
        <p>After reset, only the seeded platform owner account remains.</p>
      </div>

      <div className="panel-row">
        <button className="confirmation-dialog-danger" disabled={pending} onClick={handleReset} type="button">
          {pending ? "Resetting..." : "Reset database"}
        </button>
      </div>

      {message ? <p className="table-subtle">{message}</p> : null}
      {error ? <p className="form-error">{error}</p> : null}
    </section>
  );
}
