"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useConfirmation } from "@/components/confirmation-provider";
import { HelpNotice } from "@/components/help-notice";

type WebQrSetupPanelProps = {
  channelId?: string | null;
  channelSelectionBasePath?: string;
  channelSelectionHref?: string | null;
  initialValues: {
    id?: string;
    connectionStatus: string;
    connectedByAgentName: string;
    displayName: string;
    phoneNumber: string;
    qrCodeDataUrl: string | null;
    lastError: string;
    connectedAt: string | null;
  };
  health?: {
    runtimeStatus: string;
    isInboxReady: boolean;
    isHistoryStabilizing: boolean;
    isHistoryStuck: boolean;
    isLiveOnlyMode: boolean;
    importedConversationCount: number;
    importedMessageCount: number;
    lastSyncError: string | null;
  };
  onBack?: () => void;
  skipHref?: string;
  onboardingMode?: "guided" | "settings";
};

function buildSettingsWhatsAppUrl(channelId?: string | null) {
  return channelId ? `/api/settings/whatsapp?channelId=${encodeURIComponent(channelId)}` : "/api/settings/whatsapp";
}

export function WebQrSetupPanel({
  channelId = null,
  channelSelectionBasePath = "/settings/whatsapp",
  channelSelectionHref = null,
  initialValues,
  health,
  onBack,
  skipHref,
  onboardingMode = "settings"
}: WebQrSetupPanelProps) {
  const router = useRouter();
  const { confirm } = useConfirmation();
  const [isPending, startTransition] = useTransition();
  const [connectionName, setConnectionName] = useState("Primary WhatsApp connection");
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [finalizeRetryToken, setFinalizeRetryToken] = useState(0);
  const [clearChatsAndContacts, setClearChatsAndContacts] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const lastLinkedRefreshKeyRef = useRef<string | null>(null);
  const [status, setStatus] = useState({
    connectionStatus: initialValues.connectionStatus,
    connectedByAgentName: initialValues.connectedByAgentName,
    displayName: initialValues.displayName,
    phoneNumber: initialValues.phoneNumber,
    lastError: initialValues.lastError,
    connectedAt: initialValues.connectedAt,
    qrCodeDataUrl: initialValues.qrCodeDataUrl,
    isSyncingHistory: false
  });
  const channelScopedUrl = buildSettingsWhatsAppUrl(channelId);
  const hasSelectedChannel = Boolean(channelId?.trim());
  const isRelinkableError = status.connectionStatus === "ERROR";

  const hasActiveSession =
    status.connectionStatus !== "DISCONNECTED" &&
    status.connectionStatus !== "AUTH_FAILED" &&
    !isRelinkableError;
  const canRefreshQr =
    hasSelectedChannel &&
    !isPending &&
    (status.connectionStatus === "DISCONNECTED" ||
      status.connectionStatus === "AUTH_FAILED" ||
      isRelinkableError ||
      status.connectionStatus === "QR_READY" ||
      status.connectionStatus === "INITIALIZING");
  const isLinkingInProgress =
    status.connectionStatus === "AUTHENTICATED" ||
    status.connectionStatus === "CONNECTED" ||
    status.connectionStatus === "SYNCING_HISTORY" ||
    status.connectionStatus === "READY";
  const canManageConnection =
    hasSelectedChannel &&
    (hasActiveSession || Boolean(status.phoneNumber) || Boolean(status.lastError) || Boolean(status.connectedAt));
  const showsConnectedSummary =
    !isRelinkableError &&
    (Boolean(status.connectedAt) ||
      ["CONNECTED", "READY", "SYNCING_HISTORY"].includes(status.connectionStatus));
  const shouldRefreshParentForLinkedState =
    hasSelectedChannel &&
    !isRelinkableError &&
    (Boolean(status.connectedAt) ||
      Boolean(status.phoneNumber) ||
      ["AUTHENTICATED", "CONNECTED", "READY", "SYNCING_HISTORY"].includes(status.connectionStatus));

  const statusLabel = useMemo(() => {
    if (status.isSyncingHistory || status.connectionStatus === "SYNCING_HISTORY") {
      return "Importing chats";
    }

    if (status.connectionStatus === "READY") {
      return "Connected and ready";
    }

    if (status.connectionStatus === "CONNECTED") {
      return "Finalizing session";
    }

    if (status.connectionStatus === "QR_READY") {
      return "QR ready to scan";
    }

    if (status.connectionStatus === "AUTHENTICATED") {
      return "Authenticated";
    }

    if (status.connectionStatus === "INITIALIZING") {
      return "Starting runtime";
    }

    return status.connectionStatus === "DISCONNECTED" ? "Not connected" : status.connectionStatus;
  }, [status.connectionStatus, status.isSyncingHistory]);

  const visibleStatusError = getVisibleStatusError(
    status.connectionStatus,
    error ?? status.lastError,
    status.isSyncingHistory
  );

  useEffect(() => {
    lastLinkedRefreshKeyRef.current = null;
  }, [channelId]);

  useEffect(() => {
    setStatus({
      connectionStatus: initialValues.connectionStatus,
      connectedByAgentName: initialValues.connectedByAgentName,
      displayName: initialValues.displayName,
      phoneNumber: initialValues.phoneNumber,
      lastError: initialValues.lastError,
      connectedAt: initialValues.connectedAt,
      qrCodeDataUrl: initialValues.qrCodeDataUrl,
      isSyncingHistory: false
    });
    setSuccess(null);
    setError(null);
    setFinalizeRetryToken(0);
    setClearChatsAndContacts(false);
    setIsDisconnecting(false);
  }, [channelId, initialValues]);

  useEffect(() => {
    if (shouldRefreshParentForLinkedState) {
      return;
    }

    lastLinkedRefreshKeyRef.current = null;
  }, [shouldRefreshParentForLinkedState]);

  useEffect(() => {
    if (!shouldRefreshParentForLinkedState) {
      return;
    }

    const refreshKey = [
      channelId ?? "",
      status.connectionStatus,
      status.phoneNumber,
      status.connectedAt
    ].join("|");

    if (lastLinkedRefreshKeyRef.current === refreshKey) {
      return;
    }

    lastLinkedRefreshKeyRef.current = refreshKey;
    router.refresh();
  }, [
    channelId,
    router,
    shouldRefreshParentForLinkedState,
    status.connectedAt,
    status.connectionStatus,
    status.phoneNumber
  ]);

  async function refreshStatus() {
    if (!hasSelectedChannel) {
      return;
    }

    const response = await fetch(channelScopedUrl, {
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
  }

  async function waitForQrReady(attempts = 8) {
    if (!hasSelectedChannel) {
      return false;
    }

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const response = await fetch(channelScopedUrl, {
        method: "GET"
      });

      if (!response.ok) {
        return false;
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

      const nextStatus =
        payload.status.runtimeStatus ??
        payload.status.channel?.connectionStatus ??
        "DISCONNECTED";

      setStatus({
        connectionStatus: nextStatus,
        connectedByAgentName:
          payload.status.channel?.connectedByAgentName ?? initialValues.connectedByAgentName,
        displayName: payload.status.channel?.displayName ?? "",
        phoneNumber: payload.status.channel?.phoneNumber ?? "",
        lastError: payload.status.lastError ?? payload.status.channel?.lastError ?? "",
        connectedAt: payload.status.channel?.connectedAt ?? null,
        qrCodeDataUrl: payload.status.qrCodeDataUrl ?? null,
        isSyncingHistory: payload.status.isSyncingHistory ?? false
      });

      if (payload.status.qrCodeDataUrl || nextStatus === "QR_READY") {
        return true;
      }

      if (["AUTH_FAILED", "ERROR", "DISCONNECTED"].includes(nextStatus)) {
        return false;
      }

      await new Promise((resolve) => window.setTimeout(resolve, 750));
    }

    return false;
  }

  useEffect(() => {
    if (!hasSelectedChannel) {
      return;
    }

    void refreshStatus();
    const interval = window.setInterval(() => {
      void refreshStatus();
    }, 3000);

    return () => window.clearInterval(interval);
  }, [channelScopedUrl, hasSelectedChannel]);

  useEffect(() => {
    if (
      !hasSelectedChannel ||
      !connectionName.trim() ||
      isPending ||
      status.isSyncingHistory ||
      status.connectionStatus === "READY" ||
      status.connectionStatus === "SYNCING_HISTORY" ||
      status.connectionStatus !== "CONNECTED"
    ) {
      return;
    }

    let isCancelled = false;
    let retryTimer: number | null = null;

    setError(null);
    setSuccess("Phone linked. Connexa is finishing the connection automatically.");

    const finalizeTimer = window.setTimeout(() => {
      startTransition(async () => {
        const response = await fetch(channelScopedUrl, {
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
          const message = payload?.error ?? "Unable to finalize the WhatsApp connection.";

          if (isTransientSetupErrorMessage(message)) {
            if (isCancelled) {
              return;
            }

            setError(null);
            setSuccess("Phone linked. Connexa is still syncing with WhatsApp.");
            await refreshStatus();

            retryTimer = window.setTimeout(() => {
              if (!isCancelled) {
                setFinalizeRetryToken((value) => value + 1);
              }
            }, 4000);
            return;
          }

          setError(getFriendlySetupError(message));
          return;
        }

        await refreshStatus();
        setSuccess(
          `Connection is live. Imported ${payload?.result?.importedChats ?? 0} chats and ${
            payload?.result?.importedMessages ?? 0
          } messages.`
        );
      });
    }, 1200);

    return () => {
      isCancelled = true;
      window.clearTimeout(finalizeTimer);
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
      }
    };
  }, [
    channelScopedUrl,
    connectionName,
    finalizeRetryToken,
    isPending,
    startTransition,
    status.connectionStatus,
    status.isSyncingHistory,
    hasSelectedChannel
  ]);

  function handleRefreshQr() {
    if (!hasSelectedChannel) {
      setError("Select a WhatsApp channel before generating a QR code.");
      return;
    }

    setError(null);
    setSuccess(null);

    startTransition(async () => {
      const response = await fetch(channelScopedUrl, {
        method: "POST"
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(getFriendlySetupError(payload?.error ?? "Unable to start WhatsApp QR login."));
        return;
      }

      const hasQrReady = await waitForQrReady();

      if (hasQrReady) {
        setSuccess("QR session is ready. Scan the code from Linked Devices on the phone.");
        return;
      }

      await refreshStatus();
      setSuccess("WhatsApp runtime is starting. The QR code should appear shortly.");
    });
  }

  async function handleFreshStart() {
    if (!hasSelectedChannel) {
      setError("Select a WhatsApp channel before starting a fresh WhatsApp session.");
      return;
    }

    const shouldReset = await confirm({
      title: "Start fresh WhatsApp session",
      description:
        "Clear the saved browser session and generate a brand-new QR code? Use this when the phone logged out, the session is stale, or relinking is stuck.",
      confirmLabel: "Start fresh",
      tone: "danger"
    });

    if (!shouldReset) {
      return;
    }

    setError(null);
    setSuccess(null);

    startTransition(async () => {
      const response = await fetch(channelScopedUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          action: "fresh-start",
          channelId
        })
      });

      const payload = (await response.json().catch(() => null)) as { error?: string } | null;

      if (!response.ok) {
        setError(getFriendlySetupError(payload?.error ?? "Unable to start a fresh WhatsApp session."));
        return;
      }

      const hasQrReady = await waitForQrReady();

      if (hasQrReady) {
        setSuccess("Fresh session is ready. Scan the new QR code from Linked Devices on the phone.");
        return;
      }

      await refreshStatus();
      setSuccess("Fresh session requested. Connexa is preparing a new QR code.");
    });
  }

  async function handleRemoveConnection() {
    if (!hasSelectedChannel) {
      setError("Select a WhatsApp channel before removing a connection.");
      return;
    }

    const shouldRemove = await confirm({
      title: "Disconnect WhatsApp number",
      description:
        clearChatsAndContacts
          ? "Disconnect this WhatsApp number, clear the saved session, and delete imported chats plus orphaned contacts for this channel? You can link the number again with a new QR code."
          : "Disconnect this WhatsApp number and clear the saved session from Connexa? You can link the number again with a new QR code.",
      confirmLabel: clearChatsAndContacts ? "Disconnect and clear data" : "Disconnect",
      tone: "danger"
    });

    if (!shouldRemove) {
      return;
    }

    setError(null);
    setSuccess(null);
    setIsDisconnecting(true);

    startTransition(async () => {
      try {
        const response = await fetch(channelScopedUrl, {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            clearChatsAndContacts
          })
        });

        const payload = (await response.json().catch(() => null)) as
          | {
              cleanupResult?: {
                deletedContactCount?: number;
                deletedConversationCount?: number;
              } | null;
              error?: string;
              nextChannelId?: string | null;
            }
          | null;

        if (!response.ok) {
          setError(payload?.error ?? "Unable to remove the connected WhatsApp number.");
          return;
        }

        setStatus({
          connectionStatus: "DISCONNECTED",
          connectedByAgentName: initialValues.connectedByAgentName,
          displayName: "",
          phoneNumber: "",
          lastError: "",
          connectedAt: null,
          qrCodeDataUrl: null,
          isSyncingHistory: false
        });
        setFinalizeRetryToken(0);
        setClearChatsAndContacts(false);
        setSuccess(
          clearChatsAndContacts
            ? `WhatsApp was disconnected. Removed ${
                payload?.cleanupResult?.deletedConversationCount ?? 0
              } chats and ${
                payload?.cleanupResult?.deletedContactCount ?? 0
              } contacts for this channel.`
            : "The WhatsApp connection was removed. Generate a new QR code to link a number again."
        );
        if (payload?.nextChannelId) {
          router.push(`${channelSelectionBasePath}?channelId=${encodeURIComponent(payload.nextChannelId)}`);
        } else {
          router.push(channelSelectionBasePath);
        }
        router.refresh();
      } finally {
        setIsDisconnecting(false);
      }
    });
  }

  return (
    <div className="wa-setup-stack">
      <article className="content-card settings-dark-panel wa-setup-card">
        <div className="wa-step-header">
          <div>
            <span className="wa-step-kicker">{onboardingMode === "guided" ? "First login" : showsConnectedSummary ? "Connected number" : "Step 2"}</span>
            <h2>
              {showsConnectedSummary
                ? status.phoneNumber || "WhatsApp connected"
                : onboardingMode === "guided"
                  ? "Connect your business WhatsApp"
                  : "Setup Connection"}
            </h2>
            <p>
              {showsConnectedSummary
                ? "This number is already connected. Disconnect it here when you need to relink the phone or clear the imported inbox data for this channel."
                : onboardingMode === "guided"
                ? "Scan the QR code from the phone that owns your business WhatsApp so the shared inbox can go live."
                : "Use QR-based WhatsApp Web onboarding for a fast connection that your team can activate today."}
            </p>
          </div>
        </div>

        {showsConnectedSummary ? (
          <div className="wa-connected-summary">
            <div className="wa-runtime-meta">
              <div>
                <span>Connected number</span>
                <strong>{status.phoneNumber || "Unknown number"}</strong>
              </div>
              <div>
                <span>Channel</span>
                <strong>{channelSelectionHref || channelId || "Not available"}</strong>
              </div>
              <div>
                <span>Profile name</span>
                <strong>{status.displayName || "Not available"}</strong>
              </div>
              <div>
                <span>Status</span>
                <strong>{statusLabel}</strong>
              </div>
              <div>
                <span>Connected at</span>
                <strong>{status.connectedAt || "Not available"}</strong>
              </div>
            </div>

            <div className="wa-disconnect-panel">
              <strong>Disconnect options</strong>
              <label className="auth-checkbox wa-disconnect-checkbox">
                <input
                  checked={clearChatsAndContacts}
                  onChange={(event) => setClearChatsAndContacts(event.target.checked)}
                  type="checkbox"
                />
                <span>Also clear imported chats and orphaned contacts for this WhatsApp channel</span>
              </label>
              <button
                className="button button-secondary"
                disabled={!canManageConnection || isDisconnecting}
                onClick={handleRemoveConnection}
                type="button"
              >
                {isDisconnecting ? "Disconnecting..." : "Disconnect"}
              </button>
              <div className="table-subtle">
                {canManageConnection
                  ? "Disconnect opens a confirmation step, keeps the workspace number slot, and lets you relink later."
                  : "Disconnect will appear once this WhatsApp channel has a linked session or saved phone details."}
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="wa-form-grid">
              <label className="control-block">
                <span className="control-label">Connection Name</span>
                <input
                  className="control-input"
                  onChange={(event) => setConnectionName(event.target.value)}
                  placeholder="Sales team WhatsApp"
                  value={connectionName}
                />
              </label>
            </div>

            <div className="wa-web-grid">
              <div className="wa-qr-panel">
                <div className="wa-qr-panel-head">
                  <strong>QR connection</strong>
                  <span>{statusLabel}</span>
                </div>

                {status.qrCodeDataUrl ? (
                  <img alt="WhatsApp QR code" className="wa-qr-image" src={status.qrCodeDataUrl} />
                ) : (
                  <div className="wa-qr-placeholder">
                    <span className="wa-qr-placeholder-icon" aria-hidden="true">
                      #
                    </span>
                    <strong>QR code will appear here</strong>
                    <p>Generate or refresh the QR session to start linking a phone.</p>
                  </div>
                )}

                <div className="wa-status-strip">
                  <span className={`wa-status-dot ${status.connectionStatus.toLowerCase()}`} aria-hidden="true" />
                  <span>{status.phoneNumber || "No phone linked yet"}</span>
                  {status.connectedAt ? <span>Connected at {status.connectedAt}</span> : null}
                </div>
              </div>

              <div className="wa-instruction-panel">
                <strong>How to connect</strong>
                <ol className="wa-instruction-list">
                  <li>Open WhatsApp on your phone.</li>
                  <li>Tap Linked Devices.</li>
                  <li>Scan the QR code.</li>
                  <li>Wait for connection confirmation.</li>
                </ol>

                <div className="wa-runtime-meta">
                  <div>
                    <span>Session owner</span>
                    <strong>{status.connectedByAgentName || "No active session"}</strong>
                  </div>
                  <div>
                    <span>Profile name</span>
                    <strong>{status.displayName || "Not connected"}</strong>
                  </div>
                </div>

                <button
                  className="button button-secondary"
                  disabled={!canRefreshQr}
                  onClick={handleRefreshQr}
                  type="button"
                >
                  {isPending ? "Preparing..." : status.connectionStatus === "DISCONNECTED" ? "Generate QR" : "Refresh QR"}
                </button>

                <div className="table-subtle">
                  {isLinkingInProgress
                    ? "Linking is already in progress. Refresh stays locked so the current QR handoff can finish."
                    : "Refreshing generates a new QR code and replaces any previous code still on screen."}
                </div>

                <button className="button button-secondary" disabled={isPending} onClick={handleFreshStart} type="button">
                  {isPending ? "Preparing..." : "Start fresh session"}
                </button>

                <div className="table-subtle">
                  Use this after the phone logged out, the linked-device session broke, or the QR flow needs a clean restart.
                </div>

                <button
                  className="button button-secondary"
                  disabled={!canManageConnection || isDisconnecting}
                  onClick={handleRemoveConnection}
                  type="button"
                >
                  {isDisconnecting ? "Disconnecting..." : "Disconnect"}
                </button>

                <div className="table-subtle">
                  {canManageConnection
                    ? "Use this if the current linked number is stuck or failed. A confirmation modal opens before Connexa disconnects it."
                    : "Disconnect will appear once this WhatsApp channel has a linked session or saved phone details."}
                </div>
              </div>
            </div>
          </>
        )}

        <HelpNotice title={onboardingMode === "guided" ? "What happens next" : "Recommended path"}>
          {onboardingMode === "guided" ? (
            <span className="wa-onboarding-next-copy">
              After the phone is linked, Connexa can import chats and prepare your manager inbox. If the phone is not
              available now, skip this step and finish it later from settings.
            </span>
          ) : (
            "WhatsApp Web is best when your team needs the fastest onboarding path. It is ideal for getting started, while the official API remains the better long-term option for scale and platform stability."
          )}
        </HelpNotice>

        {health?.isLiveOnlyMode ? (
          <HelpNotice title="Live only mode is active">
            WhatsApp is now treated as live for new inbound and outbound traffic. Historical import has been deferred
            because the earlier sync stalled. You can keep using the inbox for new conversations while deciding whether
            to relink the number later for another history import attempt.
          </HelpNotice>
        ) : null}

        {health?.isHistoryStuck ? (
          <HelpNotice title="Historical import looks stuck">
            WhatsApp is connected, but historical chat import has taken too long without producing inbox data.
            New live inbound and outbound traffic should still work. If the imported counts stay at zero, remove and
            relink the number to start a fresh session.
          </HelpNotice>
        ) : null}

        {health?.isHistoryStabilizing ? (
          <HelpNotice title="Connection is live, history is still stabilizing">
            WhatsApp is connected. Historical chat import is still stabilizing in the background, but new live
            messages should still appear in the inbox. Imported {health.importedConversationCount} conversations and{" "}
            {health.importedMessageCount} messages so far.
          </HelpNotice>
        ) : null}

        {!health?.isInboxReady && status.connectionStatus === "CONNECTED" ? (
          <HelpNotice title="Launch note">
            Connexa should be treated as live for new inbound and outbound traffic first. Older WhatsApp history is
            best-effort and may continue importing gradually.
          </HelpNotice>
        ) : null}

        {visibleStatusError ? <div className="form-error">{visibleStatusError}</div> : null}
        {success ? <div className="form-success">{success}</div> : null}

        <div className="wa-form-actions">
          {onBack ? (
            <button className="button button-secondary" onClick={onBack} type="button">
              Back
            </button>
          ) : skipHref ? (
            <Link className="button button-secondary" href={skipHref}>
              Skip for now
            </Link>
          ) : null}
          <div className="table-subtle">
            {status.connectionStatus === "CONNECTED" || status.connectionStatus === "SYNCING_HISTORY"
              ? "Connexa is finishing the connection automatically."
              : status.connectionStatus === "READY"
                ? "WhatsApp is connected and ready."
                : hasActiveSession
                  ? "Finish linking on the phone and Connexa will continue automatically."
                  : "Generate a QR code and link the phone to continue."}
          </div>
        </div>
      </article>
    </div>
  );
}

function getFriendlySetupError(message: string) {
  const normalized = message.trim();

  if (isTransientSetupErrorMessage(normalized)) {
    return "WhatsApp is still finalizing the browser session. Connexa will keep trying automatically.";
  }

  if (
    normalized.includes("Sender service is unreachable") ||
    normalized.includes("fetch failed") ||
    normalized.includes("ECONNREFUSED")
  ) {
    return "Connexa could not reach the WhatsApp sender service. If this is running in Docker, use the sender container hostname in SENDER_SERVICE_URL, for example http://sender:3101, not 127.0.0.1.";
  }

  return normalized;
}

function isTransientSetupErrorMessage(message: string) {
  return (
    message.includes("Attempted to use detached Frame") ||
    message.includes("Execution context was destroyed") ||
    message.includes("Runtime.callFunctionOn") ||
    message.includes("waitForChatLoading") ||
    message.includes("WhatsApp is still finalizing the browser session") ||
    message.includes("WhatsApp is still preparing chat history")
  );
}

function getVisibleStatusError(status: string, lastError: string | null, isSyncingHistory: boolean) {
  const normalized = lastError?.trim();

  if (!normalized) {
    return null;
  }

  const isTransientInternalError =
    normalized.includes("Attempted to use detached Frame") ||
    normalized.includes("WhatsApp is still finalizing the browser session") ||
    normalized.includes("WhatsApp is still preparing chat history") ||
    normalized.includes("waitForChatLoading") ||
    normalized.includes("Execution context was destroyed") ||
    normalized.includes("Protocol error (Runtime.callFunctionOn)") ||
    normalized.includes("Runtime.callFunctionOn timed out");

  if (
    isTransientInternalError &&
    (isSyncingHistory ||
      status === "CONNECTED" ||
      status === "SYNCING_HISTORY" ||
      status === "AUTHENTICATED" ||
      status === "INITIALIZING")
  ) {
    return null;
  }

  return getFriendlySetupError(normalized);
}
