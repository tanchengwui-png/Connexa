"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type WhatsAppSetupFormProps = {
  initialValues: {
    connectionStatus: string;
    connectedByAgentName: string;
    displayName: string;
    phoneNumber: string;
    lastError: string;
    connectedAt: string | null;
  };
};

export function WhatsAppSetupForm({ initialValues }: WhatsAppSetupFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [status, setStatus] = useState({
    connectionStatus: initialValues.connectionStatus,
    connectedByAgentName: initialValues.connectedByAgentName,
    displayName: initialValues.displayName,
    phoneNumber: initialValues.phoneNumber,
    lastError: initialValues.lastError,
    connectedAt: initialValues.connectedAt,
    qrCodeDataUrl: null as string | null,
    isSyncingHistory: false
  });
  const isReady = status.connectionStatus === "READY";
  const hasActiveSession = status.connectionStatus !== "DISCONNECTED" && status.connectionStatus !== "AUTH_FAILED";
  const visibleStatusError = getVisibleStatusError(status.connectionStatus, status.lastError, status.isSyncingHistory);
  const statusLabel = formatRuntimeStatus(status.connectionStatus, status.isSyncingHistory);
  const statusHint = getRuntimeStatusHint(status.connectionStatus, status.isSyncingHistory);

  const refreshStatus = async () => {
    const response = await fetch("/api/settings/whatsapp", {
      method: "GET"
    });

    if (!response.ok) {
      return;
    }

    const payload = (await response.json()) as {
      status: {
        channel?: {
          connectionStatus?: string;
          connectedByAgentName?: string | null;
          displayName?: string | null;
          phoneNumber?: string | null;
          lastError?: string | null;
          connectedAt?: string | null;
        } | null;
        qrCodeDataUrl?: string | null;
        runtimeStatus?: string;
        lastError?: string | null;
        isSyncingHistory?: boolean;
      };
    };

    setStatus({
      connectionStatus:
        payload.status.runtimeStatus ??
        payload.status.channel?.connectionStatus ??
        "DISCONNECTED",
      connectedByAgentName:
        payload.status.channel?.connectedByAgentName ?? initialValues.connectedByAgentName,
      displayName: payload.status.channel?.displayName ?? "",
      phoneNumber: payload.status.channel?.phoneNumber ?? "",
      lastError: payload.status.lastError ?? payload.status.channel?.lastError ?? "",
      connectedAt: payload.status.channel?.connectedAt ?? null,
      qrCodeDataUrl: payload.status.qrCodeDataUrl ?? null,
      isSyncingHistory: payload.status.isSyncingHistory ?? false
    });
  };

  useEffect(() => {
    void refreshStatus();
    const interval = window.setInterval(() => {
      void refreshStatus();
    }, 3000);

    return () => window.clearInterval(interval);
  }, []);

  const startQrLogin = () => {
    setError(null);
    setSuccess(null);

    startTransition(async () => {
      const response = await fetch("/api/settings/whatsapp", {
        method: "POST"
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(payload?.error ?? "Unable to start WhatsApp QR login.");
        return;
      }

      await refreshStatus();
      router.refresh();
    });
  };

  const startFreshSession = () => {
    setError(null);
    setSuccess(null);

    startTransition(async () => {
      const response = await fetch("/api/settings/whatsapp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          action: "fresh-start"
        })
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(payload?.error ?? "Unable to start a fresh WhatsApp session.");
        return;
      }

      await refreshStatus();
      setSuccess("Fresh session started. Scan the new QR code to relink the phone.");
      router.refresh();
    });
  };

  const disconnectSession = () => {
    setError(null);
    setSuccess(null);

    startTransition(async () => {
      const response = await fetch("/api/settings/whatsapp", {
        method: "DELETE"
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(payload?.error ?? "Unable to disconnect WhatsApp.");
        return;
      }

      await refreshStatus();
      router.refresh();
    });
  };

  const syncChats = () => {
    setError(null);
    setSuccess(null);

    startTransition(async () => {
      const response = await fetch("/api/settings/whatsapp", {
        method: "PATCH"
      });

      const payload = (await response.json().catch(() => null)) as
        | {
            error?: string;
            result?: {
              importedChats?: number;
              importedMessages?: number;
            };
          }
        | null;

      if (!response.ok) {
        setError(payload?.error ?? "Unable to sync WhatsApp chats.");
        return;
      }

      setSuccess(
        `Synced ${payload?.result?.importedChats ?? 0} chats and ${payload?.result?.importedMessages ?? 0} messages.`
      );
      await refreshStatus();
      router.refresh();
    });
  };

  return (
    <article className="content-card settings-dark-panel whatsapp-setup-panel">
      <div className="card-header settings-dark-panel-head">
        <div>
          <h3 className="card-title">QR login</h3>
          <p className="muted">
            Start the client, scan the QR, and keep the session attached to the current manager
            login.
          </p>
        </div>
      </div>

      <div className="whatsapp-setup-fields">
        <label className="control-block">
          <span className="control-label">Connection status</span>
          <input className="control-input" readOnly value={statusLabel} />
        </label>

        <label className="control-block">
          <span className="control-label">Session owner</span>
          <input
            className="control-input"
            readOnly
            value={status.connectedByAgentName || "No active login"}
          />
        </label>

        <label className="control-block">
          <span className="control-label">WhatsApp number</span>
          <input className="control-input" readOnly value={status.phoneNumber || "Not connected"} />
        </label>

        <label className="control-block">
          <span className="control-label">Profile name</span>
          <input className="control-input" readOnly value={status.displayName || "Not connected"} />
        </label>

        <label className="control-block">
          <span className="control-label">Connected at</span>
          <input className="control-input" readOnly value={status.connectedAt ?? "Not connected"} />
        </label>
      </div>

      {status.qrCodeDataUrl ? (
        <div className="whatsapp-setup-fields">
          <img alt="WhatsApp QR code" src={status.qrCodeDataUrl} style={{ maxWidth: 260, width: "100%" }} />
        </div>
      ) : null}

      {error ? <div className="form-error">{error}</div> : null}
      {success ? <div className="form-success">{success}</div> : null}
      {visibleStatusError ? <div className="form-error">{visibleStatusError}</div> : null}
      {statusHint ? <div className="table-subtle">{statusHint}</div> : null}

      <div className="composer-actions">
        {!hasActiveSession ? (
          <button className="button button-primary" disabled={isPending} onClick={startQrLogin} type="button">
            {isPending ? "Starting..." : "Generate QR"}
          </button>
        ) : null}
        <button className="button button-secondary" disabled={isPending} onClick={startFreshSession} type="button">
          {isPending ? "Starting..." : "Start fresh session"}
        </button>
        <button
          className="button button-secondary"
          disabled={isPending || (!isReady && !visibleStatusError) || status.isSyncingHistory}
          onClick={syncChats}
          type="button"
        >
          {status.isSyncingHistory ? "Syncing..." : "Sync chats"}
        </button>
        <button className="button button-secondary" disabled={isPending} onClick={disconnectSession} type="button">
          Disconnect
        </button>
      </div>
    </article>
  );
}

function formatRuntimeStatus(status: string, isSyncingHistory: boolean) {
  if (isSyncingHistory || status === "SYNCING_HISTORY") {
    return "Importing chats";
  }

  if (status === "READY") {
    return "Ready";
  }

  if (status === "CONNECTED") {
    return "Finalizing session";
  }

  if (status === "AUTHENTICATED") {
    return "Authenticating";
  }

  if (status === "QR_READY") {
    return "Waiting for QR scan";
  }

  if (status === "INITIALIZING") {
    return "Starting WhatsApp";
  }

  if (status === "DISCONNECTED") {
    return "Disconnected";
  }

  return status;
}

function getRuntimeStatusHint(status: string, isSyncingHistory: boolean) {
  if (isSyncingHistory || status === "SYNCING_HISTORY") {
    return "Chat history is importing in the background. You can continue onboarding.";
  }

  if (status === "CONNECTED") {
    return "WhatsApp is connected. Connexa is preparing the session and will import chats automatically.";
  }

  if (status === "READY") {
    return "WhatsApp is ready. Chat history import has completed.";
  }

  return null;
}

function getVisibleStatusError(status: string, lastError: string, isSyncingHistory: boolean) {
  const normalized = lastError.trim();

  if (!normalized) {
    return null;
  }

  const isTransientInternalError =
    normalized.includes("Attempted to use detached Frame") ||
    normalized.includes("WhatsApp is still finalizing the browser session") ||
    normalized.includes("WhatsApp is still preparing chat history") ||
    normalized.includes("waitForChatLoading") ||
    normalized.includes("Execution context was destroyed") ||
    normalized.includes("Protocol error (Runtime.callFunctionOn)");

  if (isTransientInternalError && (isSyncingHistory || status === "CONNECTED" || status === "SYNCING_HISTORY")) {
    return null;
  }

  return normalized;
}
