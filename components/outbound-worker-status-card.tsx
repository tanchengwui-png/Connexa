"use client";

import { useEffect, useState, useTransition } from "react";

type OutboundWorkerStatus = {
  pending: number;
  running: number;
  sent: number;
  failed: number;
  oldestPendingAt: string | null;
  heartbeat: {
    workerLabel: string | null;
    lastSeenAt: string;
    isOnline: boolean;
  } | null;
  latestFailure: {
    id: string;
    message: string;
    updatedAt: string;
    attempts: number;
    maxAttempts: number;
  } | null;
};

type OutboundWorkerStatusCardProps = {
  initialStatus: OutboundWorkerStatus;
  workerConfig: {
    endpointConfigured: boolean;
    appUrl: string | null;
  };
};

export function OutboundWorkerStatusCard({
  initialStatus,
  workerConfig
}: OutboundWorkerStatusCardProps) {
  const [status, setStatus] = useState(initialStatus);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const refresh = async () => {
      const response = await fetch("/api/settings/whatsapp/worker-status", {
        method: "GET",
        cache: "no-store"
      });

      const payload = (await response.json().catch(() => null)) as
        | {
            error?: string;
            status?: OutboundWorkerStatus;
          }
        | null;

      if (!response.ok || !payload?.status) {
        setError(payload?.error ?? "Unable to refresh worker status.");
        return;
      }

      setStatus(payload.status);
      setError(null);
    };

    void refresh();
    const interval = window.setInterval(() => {
      void refresh();
    }, 5000);

    return () => window.clearInterval(interval);
  }, []);

  const retryFailedJobs = () => {
    setError(null);
    setSuccess(null);

    startTransition(async () => {
      const response = await fetch("/api/settings/whatsapp/worker-status", {
        method: "POST"
      });

      const payload = (await response.json().catch(() => null)) as
        | {
            error?: string;
            result?: { retried?: number };
            status?: OutboundWorkerStatus;
          }
        | null;

      if (!response.ok || !payload?.status) {
        setError(payload?.error ?? "Unable to retry failed outbound jobs.");
        return;
      }

      setStatus(payload.status);
      setSuccess(`Retried ${payload.result?.retried ?? 0} failed job(s).`);
    });
  };

  return (
    <article className="content-card settings-dark-panel whatsapp-setup-panel">
      <div className="card-header settings-dark-panel-head">
        <div>
          <h3 className="card-title">Outbound worker</h3>
          <p className="muted">Queue health for the separate sender process.</p>
        </div>
      </div>

      <div className="worker-status-metrics">
        <div className="worker-status-metric">
          <span>Worker</span>
          <strong>{status.heartbeat?.isOnline ? "Online" : "Offline"}</strong>
        </div>
        <div className="worker-status-metric">
          <span>Pending</span>
          <strong>{status.pending}</strong>
        </div>
        <div className="worker-status-metric">
          <span>Running</span>
          <strong>{status.running}</strong>
        </div>
        <div className="worker-status-metric">
          <span>Sent</span>
          <strong>{status.sent}</strong>
        </div>
        <div className="worker-status-metric">
          <span>Failed</span>
          <strong>{status.failed}</strong>
        </div>
      </div>

      <div className="whatsapp-setup-fields">
        <label className="control-block">
          <span className="control-label">Worker label</span>
          <input
            className="control-input"
            readOnly
            value={status.heartbeat?.workerLabel ?? "No heartbeat yet"}
          />
        </label>

        <label className="control-block">
          <span className="control-label">Last heartbeat</span>
          <input
            className="control-input"
            readOnly
            value={status.heartbeat?.lastSeenAt ? formatRelativeTime(status.heartbeat.lastSeenAt) : "No heartbeat yet"}
          />
        </label>

        <label className="control-block">
          <span className="control-label">Worker auth token</span>
          <input
            className="control-input"
            readOnly
            value={workerConfig.endpointConfigured ? "Configured" : "Missing"}
          />
        </label>

        <label className="control-block">
          <span className="control-label">Attachment base URL</span>
          <input
            className="control-input"
            readOnly
            value={workerConfig.appUrl ?? "APP_URL not configured"}
          />
        </label>

        <label className="control-block">
          <span className="control-label">Oldest pending job</span>
          <input
            className="control-input"
            readOnly
            value={status.oldestPendingAt ? formatRelativeTime(status.oldestPendingAt) : "No pending jobs"}
          />
        </label>
      </div>

      {status.latestFailure ? (
        <div className="worker-status-failure">
          <strong>Latest failed job</strong>
          <p>{status.latestFailure.message}</p>
          <span>
            {formatAbsolute(status.latestFailure.updatedAt)} | attempt {status.latestFailure.attempts}/
            {status.latestFailure.maxAttempts}
          </span>
        </div>
      ) : null}

      <div className="composer-actions">
        <button
          className="button button-secondary"
          disabled={isPending || status.failed === 0}
          onClick={retryFailedJobs}
          type="button"
        >
          {isPending ? "Retrying..." : "Retry failed jobs"}
        </button>
      </div>

      {error ? <div className="form-error">{error}</div> : null}
      {success ? <div className="form-success">{success}</div> : null}
    </article>
  );
}

function formatRelativeTime(value: string) {
  const target = new Date(value).getTime();
  const deltaMinutes = Math.max(0, Math.round((Date.now() - target) / 60000));

  if (deltaMinutes < 1) {
    return "Ready now";
  }

  if (deltaMinutes < 60) {
    return `${deltaMinutes} min ago`;
  }

  const hours = Math.floor(deltaMinutes / 60);
  const minutes = deltaMinutes % 60;
  return minutes ? `${hours}h ${minutes}m ago` : `${hours}h ago`;
}

function formatAbsolute(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
