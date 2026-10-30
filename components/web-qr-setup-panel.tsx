"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useConfirmation } from "@/components/confirmation-provider";
import { HelpNotice } from "@/components/help-notice";
import {
  isStaleWhatsAppConnectionEvent,
  wouldRegressActiveWhatsAppConnection
} from "@/lib/whatsapp-connection-ordering";

type WebQrSetupPanelProps = {
  channelId?: string | null;
  channelLabel?: string | null;
  channelSelectionBasePath?: string;
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
    runtimePresent?: boolean;
    senderReachable?: boolean;
    senderError?: string | null;
    userConnectionState?: "connected" | "recovering" | "reconnection_required" | "disconnected" | "unknown";
    lastHealthCheckAt?: string | null;
    lastHealthyAt?: string | null;
    nextRecoveryAt?: string | null;
    qrCodeDataUrl?: string | null;
    qrCodeGeneratedAt?: string | null;
    qrCodeExpiresAt?: string | null;
    qrCodeExpired?: boolean;
    isInboxReady: boolean;
    isHistoryStabilizing: boolean;
    isHistoryStuck: boolean;
    isLiveOnlyMode: boolean;
    importedConversationCount: number;
    importedMessageCount: number;
    lastSyncError: string | null;
  };
  onBack?: () => void;
  connectedViaPhonePairing?: boolean;
  skipHref?: string;
  onboardingMode?: "guided" | "settings";
  onConnectionStateChange?: (state: {
    connectionStatus: string;
    phoneNumber: string;
    connectedAt: string | null;
    userConnectionState: "connected" | "recovering" | "reconnection_required" | "disconnected" | "unknown";
  }) => void;
};

function buildSettingsWhatsAppUrl(channelId?: string | null) {
  return channelId ? `/api/settings/whatsapp?channelId=${encodeURIComponent(channelId)}` : "/api/settings/whatsapp";
}

function buildConnectionStatusUrl(channelId?: string | null) {
  return channelId
    ? `/api/settings/whatsapp/status?channelId=${encodeURIComponent(channelId)}`
    : "/api/settings/whatsapp/status";
}

type ConnectionStatusSnapshot = {
  channelId: string;
  connectionStatus: string;
  displayName: string | null;
  phoneNumber: string | null;
  lastError: string | null;
  connectedAt: string | null;
  updatedAt: string;
  userConnectionState: "connected" | "recovering" | "reconnection_required" | "disconnected" | "unknown";
  lastHealthCheckAt: string | null;
  lastHealthyAt: string | null;
  nextRecoveryAt: string | null;
  qrCodeDataUrl: string | null;
  qrCodeGeneratedAt: string | null;
  qrCodeExpiresAt: string | null;
  qrCodeExpired: boolean;
};

type ConnectionStatusRealtimeEvent = {
  workspaceId: string;
  channelId: string;
  connectionStatus: string;
  updatedAt: string;
  displayName?: string | null;
  phoneNumber?: string | null;
  connectedAt?: string | null;
  lastError?: string | null;
  connectionAttemptId?: string | null;
  eventSequence?: number;
  qrVersion?: number;
  qrCodeDataUrl?: string | null;
  qrCodeGeneratedAt?: string | null;
  qrCodeExpiresAt?: string | null;
  qrCodeExpired?: boolean;
  snapshot?: boolean;
};

function formatConnectionTimestamp(value: string | null) {
  if (!value) return "Not available";
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return "Not available";
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return `${new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "medium"
  }).format(timestamp)}${timezone ? ` (${timezone})` : ""}`;
}

export function WebQrSetupPanel({
  channelId = null,
  channelLabel = null,
  channelSelectionBasePath = "/settings/whatsapp",
  initialValues,
  health,
  onBack,
  connectedViaPhonePairing = false,
  skipHref,
  onboardingMode = "settings",
  onConnectionStateChange
}: WebQrSetupPanelProps) {
  const router = useRouter();
  const { confirm } = useConfirmation();
  const [isPending, startTransition] = useTransition();
  const [connectionName, setConnectionName] = useState("Primary WhatsApp connection");
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clearChatsAndContacts, setClearChatsAndContacts] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [hasLoadedRuntimeStatus, setHasLoadedRuntimeStatus] = useState(false);
  const [status, setStatus] = useState({
    connectionStatus: initialValues.connectionStatus,
    connectedByAgentName: initialValues.connectedByAgentName,
    displayName: initialValues.displayName,
    phoneNumber: initialValues.phoneNumber,
    lastError: initialValues.lastError,
    connectedAt: initialValues.connectedAt,
    qrCodeDataUrl: health?.qrCodeDataUrl ?? initialValues.qrCodeDataUrl,
    qrCodeGeneratedAt: health?.qrCodeGeneratedAt ?? null,
    qrCodeExpiresAt: health?.qrCodeExpiresAt ?? null,
    qrCodeExpired: health?.qrCodeExpired ?? false,
    runtimePresent: health?.runtimePresent ?? false,
    senderReachable: health?.senderReachable ?? true,
    senderError: health?.senderError ?? null,
    userConnectionState: health?.userConnectionState ?? "unknown",
    lastHealthCheckAt: health?.lastHealthCheckAt ?? null,
    lastHealthyAt: health?.lastHealthyAt ?? null,
    nextRecoveryAt: health?.nextRecoveryAt ?? null,
    isSyncingHistory: false
  });
  const statusRef = useRef(status);
  const activeStatusRequestRef = useRef<AbortController | null>(null);
  const statusRefreshPendingRef = useRef(false);
  const latestStatusVersionRef = useRef(0);
  const connectedTimingReportedRef = useRef(false);
  const connectionAttemptIdRef = useRef<string | null>(null);
  const latestConnectionEventSequenceRef = useRef(0);
  const latestQrVersionRef = useRef(0);
  const guidedQrStartRequestedRef = useRef(false);
  const qrRequestStartedAtRef = useRef<string | null>(null);
  const qrDisplayedTimingKeyRef = useRef<string | null>(null);
  const channelScopedUrl = buildSettingsWhatsAppUrl(channelId);
  const connectionStatusUrl = buildConnectionStatusUrl(channelId);
  const hasSelectedChannel = Boolean(channelId?.trim());
  const isRelinkableError =
    status.connectionStatus === "ERROR" ||
    status.connectionStatus === "REAUTH_REQUIRED" ||
    status.userConnectionState === "reconnection_required";
  const hasDeferredHistory = Boolean(
    health?.lastSyncError?.toLowerCase().includes("historical chat import has been deferred")
  );
  const isRuntimeImportingHistory =
    status.isSyncingHistory ||
    status.connectionStatus === "SYNCING_HISTORY" ||
    status.connectionStatus === "CONNECTED";
  // Health is server-rendered while runtime status is polled every three
  // seconds. Never retain an old warning after the live runtime reaches READY.
  const showHistoryStuck = Boolean(health?.isHistoryStuck && isRuntimeImportingHistory);
  const showHistoryStabilizing = Boolean(health?.isHistoryStabilizing && isRuntimeImportingHistory);

  const hasActiveSession =
    status.connectionStatus !== "DISCONNECTED" &&
    status.connectionStatus !== "AUTH_FAILED" &&
    !isRelinkableError;
  const canRefreshQr =
    hasSelectedChannel &&
    !isPending &&
    (status.connectionStatus === "DISCONNECTED" ||
      status.connectionStatus === "AUTH_FAILED" ||
      status.connectionStatus === "REAUTH_REQUIRED" ||
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
    ((connectedViaPhonePairing && !hasLoadedRuntimeStatus) ||
      Boolean(status.connectedAt) ||
      ["CONNECTED", "READY", "SYNCING_HISTORY"].includes(status.connectionStatus));
  const isAuthenticatedHandoff = !isRelinkableError && status.connectionStatus === "AUTHENTICATED";
  const statusLabel = useMemo(() => {
    if (status.connectionStatus === "AUTHENTICATED") return "Authenticating";
    if (["CONNECTED", "READY", "SYNCING_HISTORY"].includes(status.connectionStatus)) return "Connected";
    if (status.userConnectionState === "connected") return "Connected";
    if (status.userConnectionState === "recovering") return "Recovering connection...";
    if (status.userConnectionState === "reconnection_required") return "Reconnection required";
    if (status.userConnectionState === "disconnected") return "Not connected";
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
      return status.qrCodeExpired ? "QR expired" : "QR ready to scan";
    }

    if (status.connectionStatus === "INITIALIZING") {
      return "Starting runtime";
    }

    return status.connectionStatus === "DISCONNECTED" ? "Not connected" : status.connectionStatus;
  }, [status.connectionStatus, status.isSyncingHistory, status.qrCodeExpired, status.userConnectionState]);

  const visibleStatusError = getVisibleStatusError(
    status.connectionStatus,
    error ?? status.lastError,
    status.isSyncingHistory
  );

  useEffect(() => {
    onConnectionStateChange?.({
      connectionStatus: status.connectionStatus,
      phoneNumber: status.phoneNumber,
      connectedAt: status.connectedAt,
      userConnectionState: status.userConnectionState
    });
  }, [
    onConnectionStateChange,
    status.connectedAt,
    status.connectionStatus,
    status.phoneNumber,
    status.userConnectionState
  ]);

  useEffect(() => {
    const nextStatus = {
      connectionStatus: initialValues.connectionStatus,
      connectedByAgentName: initialValues.connectedByAgentName,
      displayName: initialValues.displayName,
      phoneNumber: initialValues.phoneNumber,
      lastError: initialValues.lastError,
      connectedAt: initialValues.connectedAt,
      qrCodeDataUrl: health?.qrCodeDataUrl ?? initialValues.qrCodeDataUrl,
      qrCodeGeneratedAt: health?.qrCodeGeneratedAt ?? null,
      qrCodeExpiresAt: health?.qrCodeExpiresAt ?? null,
      qrCodeExpired: health?.qrCodeExpired ?? false,
      runtimePresent: health?.runtimePresent ?? false,
      senderReachable: health?.senderReachable ?? true,
      senderError: health?.senderError ?? null,
      userConnectionState: health?.userConnectionState ?? "unknown",
      lastHealthCheckAt: health?.lastHealthCheckAt ?? null,
      lastHealthyAt: health?.lastHealthyAt ?? null,
      nextRecoveryAt: health?.nextRecoveryAt ?? null,
      isSyncingHistory: false
    };
    setStatus(nextStatus);
    statusRef.current = nextStatus;
    latestStatusVersionRef.current = 0;
    connectedTimingReportedRef.current = false;
    connectionAttemptIdRef.current = null;
    latestConnectionEventSequenceRef.current = 0;
    latestQrVersionRef.current = 0;
    guidedQrStartRequestedRef.current = false;
    qrRequestStartedAtRef.current = null;
    qrDisplayedTimingKeyRef.current = null;
    setSuccess(null);
    setError(null);
    setClearChatsAndContacts(false);
    setIsDisconnecting(false);
    setHasLoadedRuntimeStatus(false);
  }, [channelId, health, initialValues]);

  function applyConnectionSnapshot(snapshot: ConnectionStatusSnapshot) {
    const snapshotVersion = new Date(snapshot.updatedAt).getTime();
    if (!Number.isFinite(snapshotVersion) || snapshotVersion < latestStatusVersionRef.current) {
      return false;
    }
    if (wouldRegressActiveWhatsAppConnection(statusRef.current.connectionStatus, snapshot.connectionStatus)) {
      return false;
    }

    latestStatusVersionRef.current = snapshotVersion;
    setStatus((current) => {
      const nextStatus = {
        ...current,
        connectionStatus: snapshot.connectionStatus,
        displayName: snapshot.displayName ?? "",
        phoneNumber: snapshot.phoneNumber ?? "",
        lastError: snapshot.lastError ?? "",
        connectedAt: snapshot.connectedAt,
        qrCodeDataUrl: snapshot.qrCodeDataUrl,
        qrCodeGeneratedAt: snapshot.qrCodeGeneratedAt,
        qrCodeExpiresAt: snapshot.qrCodeExpiresAt,
        qrCodeExpired: snapshot.qrCodeExpired,
        runtimePresent: snapshot.connectionStatus !== "DISCONNECTED",
        senderReachable: true,
        senderError: null,
        userConnectionState: snapshot.userConnectionState,
        lastHealthCheckAt: snapshot.lastHealthCheckAt,
        lastHealthyAt: snapshot.lastHealthyAt,
        nextRecoveryAt: snapshot.nextRecoveryAt,
        isSyncingHistory: snapshot.connectionStatus === "SYNCING_HISTORY"
      };
      statusRef.current = nextStatus;
      return nextStatus;
    });
    setHasLoadedRuntimeStatus(true);

    if (snapshot.connectionStatus === "AUTHENTICATED") {
      setSuccess("QR scanned. WhatsApp is authenticating and preparing the live session.");
    } else if (["CONNECTED", "READY", "SYNCING_HISTORY"].includes(snapshot.connectionStatus)) {
      setSuccess("WhatsApp connected. You can open Inbox while chat history imports in the background.");
    }
    return true;
  }

  function applyConnectionEvent(event: ConnectionStatusRealtimeEvent) {
    if (event.channelId !== channelId) return false;
    const eventVersion = new Date(event.updatedAt).getTime();
    if (!Number.isFinite(eventVersion) || eventVersion < latestStatusVersionRef.current) return false;

    const currentAttemptId = connectionAttemptIdRef.current;
    const isCurrentAttempt = Boolean(
      event.connectionAttemptId && currentAttemptId && event.connectionAttemptId === currentAttemptId
    );
    if (isStaleWhatsAppConnectionEvent({
      currentAttemptId,
      eventAttemptId: event.connectionAttemptId,
      currentSequence: latestConnectionEventSequenceRef.current,
      eventSequence: event.eventSequence,
      currentQrVersion: latestQrVersionRef.current,
      eventQrVersion: event.qrVersion,
      eventStatus: event.connectionStatus
    })) {
      return false;
    }
    if (
      (!event.connectionAttemptId || isCurrentAttempt) &&
      wouldRegressActiveWhatsAppConnection(statusRef.current.connectionStatus, event.connectionStatus)
    ) {
      return false;
    }

    latestStatusVersionRef.current = eventVersion;
    if (event.connectionAttemptId && event.connectionAttemptId !== currentAttemptId) {
      connectionAttemptIdRef.current = event.connectionAttemptId;
      latestConnectionEventSequenceRef.current = 0;
      latestQrVersionRef.current = 0;
    }
    if (typeof event.eventSequence === "number") {
      latestConnectionEventSequenceRef.current = event.eventSequence;
    }
    if (typeof event.qrVersion === "number") {
      latestQrVersionRef.current = Math.max(latestQrVersionRef.current, event.qrVersion);
    }
    setStatus((current) => {
      const clearsQr = ["AUTHENTICATED", "CONNECTED", "READY", "SYNCING_HISTORY"].includes(
        event.connectionStatus
      );
      const hasQrPayload = event.connectionStatus === "QR_READY" && Boolean(event.qrCodeDataUrl);
      const nextStatus = {
        ...current,
        connectionStatus: event.connectionStatus,
        displayName: event.displayName === undefined ? current.displayName : event.displayName ?? "",
        phoneNumber: event.phoneNumber === undefined ? current.phoneNumber : event.phoneNumber ?? "",
        connectedAt: event.connectedAt === undefined ? current.connectedAt : event.connectedAt,
        lastError: event.lastError === undefined ? current.lastError : event.lastError ?? "",
        qrCodeDataUrl: clearsQr ? null : hasQrPayload ? event.qrCodeDataUrl ?? null : current.qrCodeDataUrl,
        qrCodeGeneratedAt: clearsQr
          ? null
          : event.qrCodeGeneratedAt === undefined
            ? current.qrCodeGeneratedAt
            : event.qrCodeGeneratedAt,
        qrCodeExpiresAt: clearsQr
          ? null
          : event.qrCodeExpiresAt === undefined
            ? current.qrCodeExpiresAt
            : event.qrCodeExpiresAt,
        qrCodeExpired: clearsQr ? false : event.qrCodeExpired ?? current.qrCodeExpired,
        runtimePresent: event.connectionStatus !== "DISCONNECTED",
        senderReachable: true,
        senderError: null,
        userConnectionState: ["CONNECTED", "READY", "SYNCING_HISTORY"].includes(event.connectionStatus)
          ? ("connected" as const)
          : event.connectionStatus === "DISCONNECTED"
            ? ("disconnected" as const)
            : event.connectionStatus === "REAUTH_REQUIRED"
              ? ("reconnection_required" as const)
              : current.userConnectionState,
        isSyncingHistory: event.connectionStatus === "SYNCING_HISTORY"
      };
      statusRef.current = nextStatus;
      return nextStatus;
    });
    setHasLoadedRuntimeStatus(true);
    if (event.connectionStatus === "AUTHENTICATED") {
      setSuccess("QR accepted. WhatsApp is finalizing the live session; you can open Inbox now.");
    } else if (["CONNECTED", "READY", "SYNCING_HISTORY"].includes(event.connectionStatus)) {
      setSuccess("WhatsApp connected. You can open Inbox while chat history imports in the background.");
    }
    return true;
  }

  function beginQrRequestOptimistically() {
    const requestedAt = new Date().toISOString();
    qrRequestStartedAtRef.current = requestedAt;
    qrDisplayedTimingKeyRef.current = null;
    latestStatusVersionRef.current = Date.now();
    setStatus((current) => {
      const nextStatus = {
        ...current,
        connectionStatus: "INITIALIZING",
        qrCodeDataUrl: null,
        qrCodeGeneratedAt: null,
        qrCodeExpiresAt: null,
        qrCodeExpired: false,
        runtimePresent: true,
        senderReachable: true,
        senderError: null,
        lastError: ""
      };
      statusRef.current = nextStatus;
      return nextStatus;
    });
    return requestedAt;
  }

  async function refreshStatus() {
    if (!hasSelectedChannel) {
      return null;
    }

    if (activeStatusRequestRef.current) {
      statusRefreshPendingRef.current = true;
      return null;
    }

    const controller = new AbortController();
    activeStatusRequestRef.current = controller;
    try {
      const response = await fetch(connectionStatusUrl, {
        method: "GET",
        cache: "no-store",
        signal: controller.signal
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        setStatus((current) => ({
          ...current,
          senderReachable: false,
          senderError: payload?.error ?? "Connexa cannot load the saved WhatsApp connection state."
        }));
        return null;
      }

      const payload = (await response.json()) as { status: ConnectionStatusSnapshot };
      applyConnectionSnapshot(payload.status);
      return payload.status;
    } catch (requestError) {
      if (!(requestError instanceof Error && requestError.name === "AbortError")) {
        setStatus((current) => ({
          ...current,
          senderReachable: false,
          senderError: "Connexa cannot load the saved WhatsApp connection state."
        }));
      }
      return null;
    } finally {
      if (activeStatusRequestRef.current === controller) {
        activeStatusRequestRef.current = null;
      }
      if (statusRefreshPendingRef.current) {
        statusRefreshPendingRef.current = false;
        window.setTimeout(() => void refreshStatus(), 0);
      }
    }
  }

  async function waitForQrReady(attempts = 8) {
    if (!hasSelectedChannel) {
      return false;
    }

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const snapshot = await refreshStatus();
      if (snapshot?.qrCodeDataUrl && snapshot.qrCodeExpired !== true) {
        return true;
      }

      if (snapshot && ["AUTH_FAILED", "ERROR", "DISCONNECTED"].includes(snapshot.connectionStatus)) {
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

    let disposed = false;
    let timer: number | null = null;
    const schedule = () => {
      if (disposed) return;
      const currentStatus = statusRef.current.connectionStatus;
      const delay = document.visibilityState !== "visible"
        ? 15_000
        : ["INITIALIZING", "QR_READY", "AUTHENTICATED"].includes(currentStatus)
          ? 750
          : ["CONNECTED", "READY", "SYNCING_HISTORY"].includes(currentStatus)
            ? 15_000
            : 3_000;
      timer = window.setTimeout(run, delay);
    };
    const run = async () => {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
      await refreshStatus();
      schedule();
    };
    const handleVisibility = () => {
      if (document.visibilityState !== "visible") return;
      if (timer !== null) window.clearTimeout(timer);
      void run();
    };

    void run();
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      disposed = true;
      if (timer !== null) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", handleVisibility);
      activeStatusRequestRef.current?.abort();
      activeStatusRequestRef.current = null;
    };
  }, [connectionStatusUrl, hasSelectedChannel]);

  useEffect(() => {
    if (!hasSelectedChannel || !channelId) return;
    const eventSource = new EventSource(`/api/inbox/events?channelId=${encodeURIComponent(channelId)}`);
    const requestSnapshot = () => void refreshStatus();
    const applyRealtimeStatus = (message: Event) => {
      try {
        applyConnectionEvent(JSON.parse((message as MessageEvent<string>).data) as ConnectionStatusRealtimeEvent);
      } catch {
        void refreshStatus();
      }
    };
    eventSource.addEventListener("open", requestSnapshot);
    eventSource.addEventListener("whatsapp:connection", applyRealtimeStatus);

    return () => {
      eventSource.removeEventListener("open", requestSnapshot);
      eventSource.removeEventListener("whatsapp:connection", applyRealtimeStatus);
      eventSource.close();
    };
  }, [channelId, hasSelectedChannel]);

  useEffect(() => {
    if (
      onboardingMode !== "guided" ||
      !hasSelectedChannel ||
      guidedQrStartRequestedRef.current ||
      statusRef.current.connectionStatus !== "DISCONNECTED" ||
      Boolean(statusRef.current.connectedAt) ||
      Boolean(statusRef.current.phoneNumber)
    ) {
      return;
    }

    guidedQrStartRequestedRef.current = true;
    beginQrRequestOptimistically();
    setError(null);
    setSuccess("Preparing a secure QR code. Keep this page open; it will appear automatically.");
    void fetch(channelScopedUrl, { method: "POST" }).then(async (response) => {
      if (response.ok) return;
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(getFriendlySetupError(payload?.error ?? "Unable to start WhatsApp QR login."));
    }).catch(() => {
      setError("Connexa could not reach the WhatsApp sender. It will retry when the connection status refreshes.");
    });
  }, [channelScopedUrl, hasSelectedChannel, onboardingMode]);

  function reportQrDisplayed(qrCodeDataUrl: string) {
    if (!channelId || status.qrCodeExpired) return;
    const timingKey = `${connectionAttemptIdRef.current ?? "snapshot"}:${latestQrVersionRef.current}:${
      status.qrCodeGeneratedAt ?? "unknown"
    }`;
    if (qrDisplayedTimingKeyRef.current === timingKey) return;
    // The image load event confirms decoding; two animation frames ensure the
    // QR has reached a browser paint before recording it as visible.
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      const current = statusRef.current;
      if (
        current.connectionStatus !== "QR_READY" ||
        current.qrCodeExpired ||
        current.qrCodeDataUrl !== qrCodeDataUrl ||
        qrDisplayedTimingKeyRef.current === timingKey
      ) {
        return;
      }
      qrDisplayedTimingKeyRef.current = timingKey;
      void fetch("/api/settings/whatsapp/timing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelId,
          eventType: "QR_DISPLAYED",
          observedAt: new Date().toISOString(),
          requestedAt: qrRequestStartedAtRef.current,
          connectionAttemptId: connectionAttemptIdRef.current,
          qrVersion: latestQrVersionRef.current || null
        }),
        keepalive: true
      }).catch(() => null);
    }));
  }

  useEffect(() => {
    if (
      !channelId ||
      connectedTimingReportedRef.current ||
      !["CONNECTED", "READY", "SYNCING_HISTORY"].includes(status.connectionStatus)
    ) {
      return;
    }

    connectedTimingReportedRef.current = true;
    const timingKey = `connexa:whatsapp-ui-connected:${channelId}:${status.connectedAt ?? "unknown"}`;
    if (window.sessionStorage.getItem(timingKey)) return;
    window.sessionStorage.setItem(timingKey, "1");
    void fetch("/api/settings/whatsapp/timing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channelId,
        eventType: "UI_CONNECTED",
        observedAt: new Date().toISOString(),
        connectionAttemptId: connectionAttemptIdRef.current
      }),
      keepalive: true
    }).catch(() => null);
  }, [channelId, status.connectedAt, status.connectionStatus]);

  function handleRefreshQr() {
    if (!hasSelectedChannel) {
      setError("Select a WhatsApp channel before generating a QR code.");
      return;
    }

    setError(null);
    setSuccess(null);
    beginQrRequestOptimistically();

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
    beginQrRequestOptimistically();

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
          qrCodeGeneratedAt: null,
          qrCodeExpiresAt: null,
          qrCodeExpired: false,
          runtimePresent: false,
          senderReachable: true,
          senderError: null,
          userConnectionState: "reconnection_required",
          lastHealthCheckAt: null,
          lastHealthyAt: null,
          nextRecoveryAt: null,
          isSyncingHistory: false
        });
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
            <span className="wa-step-kicker">
              {isAuthenticatedHandoff
                ? "Scan accepted"
                : onboardingMode === "guided"
                  ? "First login"
                  : showsConnectedSummary
                    ? "Connected number"
                    : "Step 2"}
            </span>
            <h2>
              {isAuthenticatedHandoff
                ? "WhatsApp is authenticating"
                : showsConnectedSummary
                ? status.phoneNumber || "WhatsApp connected"
                : onboardingMode === "guided"
                  ? "Connect your business WhatsApp"
                  : "Setup Connection"}
            </h2>
            <p>
              {isAuthenticatedHandoff
                ? "Your QR scan succeeded. WhatsApp is completing its secure live-session setup; you can continue to Inbox now."
                : showsConnectedSummary
                ? status.userConnectionState === "connected"
                  ? "This number is connected and verified by the live sender. Disconnect it here when you need to relink the phone or clear imported inbox data."
                  : "This number has a saved linked session. Connexa is checking whether the live sender can currently use it."
                : onboardingMode === "guided"
                ? "Scan the QR code from the phone that owns your business WhatsApp so the shared inbox can go live."
                : "Use QR-based WhatsApp Web onboarding for a fast connection that your team can activate today."}
            </p>
          </div>
        </div>

        {showsConnectedSummary || isAuthenticatedHandoff || isRelinkableError ? (
          <div
            className={`wa-connection-health wa-connection-health-${status.senderReachable ? status.userConnectionState : "unknown"}`}
            role="status"
          >
            <strong>{status.senderReachable ? statusLabel : "Connection status unavailable"}</strong>
            <span>
              {isAuthenticatedHandoff
                ? "Scan accepted. WhatsApp is finishing the live connection in the background."
                : !status.senderReachable
                  ? "Connexa cannot verify the live sender right now."
                  : status.userConnectionState === "connected"
                    ? `Verified by the runtime watchdog${status.lastHealthCheckAt ? ` at ${status.lastHealthCheckAt}` : ""}.`
                    : status.userConnectionState === "recovering"
                      ? `Connexa is retrying automatically${status.nextRecoveryAt ? ` after ${status.nextRecoveryAt}` : ""}.`
                      : status.userConnectionState === "reconnection_required"
                        ? "The saved session needs attention. Open troubleshooting to relink the phone."
                        : "Connexa is finalizing the linked session."
              }
            </span>
          </div>
        ) : null}

        {isAuthenticatedHandoff ? (
          <div className="wa-connected-summary" role="status">
            <div className="form-success">
              <strong>QR accepted.</strong>{" "}
              The phone is linked and WhatsApp is finalizing the live connection. This page will update automatically.
            </div>
            <div className="wa-runtime-meta">
              <div>
                <span>Connection stage</span>
                <strong>Authenticating</strong>
              </div>
              <div>
                <span>What happens next</span>
                <strong>WhatsApp confirms the live session</strong>
              </div>
            </div>
            <HelpNotice title="You do not need to wait here">
              You can enter Inbox now. Live sending becomes available as soon as WhatsApp emits its genuine ready event,
              while chat history continues separately in the background.
            </HelpNotice>
          </div>
        ) : showsConnectedSummary ? (
          <div className="wa-connected-summary">
            <div className="form-success" role="status">
              <strong>WhatsApp connected.</strong>{" "}
              New messages are live now. Existing chat history continues importing in the background.
            </div>
            {connectedViaPhonePairing ? (
              <div className="form-success" role="status">
                <strong>Pairing successful.</strong>{" "}
                {status.userConnectionState === "connected"
                  ? "Your phone is linked. Recent chats will appear while older history imports in the background."
                  : "Your phone is linked and Connexa is verifying the live session."}
              </div>
            ) : null}
            <div className="wa-runtime-meta">
              <div>
                <span>Connected number</span>
                <strong>{status.phoneNumber || "Unknown number"}</strong>
              </div>
              <div>
                <span>Channel</span>
                <strong>{channelLabel || status.phoneNumber || channelId || "Not available"}</strong>
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
                <strong>{formatConnectionTimestamp(status.connectedAt)}</strong>
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
                  <img
                    alt="WhatsApp QR code"
                    className="wa-qr-image"
                    onLoad={() => reportQrDisplayed(status.qrCodeDataUrl!)}
                    src={status.qrCodeDataUrl}
                  />
                ) : (
                  <div className="wa-qr-placeholder">
                    <span className="wa-qr-placeholder-icon" aria-hidden="true">
                      #
                    </span>
                    <strong>{status.qrCodeExpired ? "QR code expired" : "QR code will appear here"}</strong>
                    <p>
                      {status.qrCodeExpired
                        ? status.runtimePresent
                          ? "Connexa is waiting for WhatsApp to issue the next QR code automatically."
                          : "The sender restarted during pairing. Generate a new session to receive a current QR code."
                        : "Generate or refresh the QR session to start linking a phone."}
                    </p>
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
                  {isPending
                    ? "Preparing..."
                    : status.userConnectionState === "reconnection_required"
                      ? "Reconnect WhatsApp"
                      : status.connectionStatus === "DISCONNECTED"
                        ? "Generate QR"
                        : "Refresh QR"}
                </button>

                <div className="table-subtle">
                  {isLinkingInProgress
                    ? "Linking is already in progress. Refresh stays locked so the current QR handoff can finish."
                    : "Connexa waits for the active WhatsApp runtime to issue a current QR code."}
                </div>

                <details className="wa-troubleshooting-panel">
                  <summary>Advanced troubleshooting</summary>
                  <div className="wa-troubleshooting-actions">
                    <button className="button button-secondary" disabled={isPending} onClick={handleFreshStart} type="button">
                      {isPending ? "Preparing..." : "Start fresh session"}
                    </button>

                    <div className="table-subtle">
                      Use this only after the phone logged out or the linked-device session cannot recover. It clears the saved browser session after confirmation.
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
                        ? "Disconnect opens a confirmation step before changing the active session."
                        : "Disconnect becomes available after this channel has session data."}
                    </div>
                  </div>
                </details>
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

        {!status.senderReachable ? (
          <HelpNotice title="WhatsApp sender temporarily unreachable">
            Connexa is showing the last saved WhatsApp connection state. This does not mean the linked WhatsApp
            session is disconnected. {status.senderError || "The sender status check will retry automatically."}
          </HelpNotice>
        ) : null}

        {hasDeferredHistory ? (
          <HelpNotice title="Historical import is paused">
            WhatsApp remains available for new inbound and outbound traffic. Historical import was deferred after it
            stalled and Connexa will retry it in the background. You can keep using Inbox; relink the number only if
            the import does not recover later.
          </HelpNotice>
        ) : null}

        {showHistoryStuck ? (
          <HelpNotice title="Historical import looks stuck">
            WhatsApp is connected, but no historical-import progress has been recorded for several minutes. New live
            traffic remains available, and Connexa will quarantine a problematic chat and continue automatically.
          </HelpNotice>
        ) : null}

        {showHistoryStabilizing && health ? (
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
          {showsConnectedSummary || isAuthenticatedHandoff ? (
            <Link className="button button-primary" href="/inbox">
              {isAuthenticatedHandoff ? "Continue to Inbox" : "Go to Inbox"}
            </Link>
          ) : null}
          <div className="table-subtle">
            {status.userConnectionState === "recovering"
              ? "Connexa is recovering the saved session automatically."
              : status.userConnectionState === "connected"
                ? "WhatsApp is connected and verified."
                : status.connectionStatus === "CONNECTED" || status.connectionStatus === "SYNCING_HISTORY"
              ? "Connexa is finishing the connection automatically."
              : status.connectionStatus === "READY"
                ? "Connexa is checking the live WhatsApp session."
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
