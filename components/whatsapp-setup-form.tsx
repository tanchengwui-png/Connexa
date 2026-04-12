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
    qrCodeDataUrl: null as string | null
  });

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
      qrCodeDataUrl: payload.status.qrCodeDataUrl ?? null
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
          <input className="control-input" readOnly value={status.connectionStatus} />
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
      {status.lastError ? <div className="form-error">{status.lastError}</div> : null}

      <div className="composer-actions">
        <button className="button button-primary" disabled={isPending} onClick={startQrLogin} type="button">
          {isPending ? "Starting..." : "Generate QR"}
        </button>
        <button className="button button-secondary" disabled={isPending} onClick={syncChats} type="button">
          Sync chats
        </button>
        <button className="button button-secondary" disabled={isPending} onClick={disconnectSession} type="button">
          Disconnect
        </button>
      </div>
    </article>
  );
}
