"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useConfirmation } from "@/components/confirmation-provider";
import { ConnectionMethodCard } from "@/components/connection-method-card";
import { HelpNotice } from "@/components/help-notice";
import { OfficialApiSetupForm } from "@/components/official-api-setup-form";
import { OnboardingLayout } from "@/components/onboarding-layout";
import { SetupProgressCard } from "@/components/setup-progress-card";
import { WebQrSetupPanel } from "@/components/web-qr-setup-panel";

type WhatsAppConnectionOnboardingProps = {
  metaEmbeddedSignup?: {
    enabled: boolean;
    appId: string;
    configId: string;
    graphVersion: string;
  };
  channels?: Array<{
    id: string;
    label: string;
    connectionMethod: ConnectionMethod;
    connectionStatus: string;
    phoneNumber: string | null;
  }>;
  initialWebSetup: {
    id: string;
    connectionMethod: ConnectionMethod;
    connectionStatus: string;
    connectedByAgentName: string;
    displayName: string;
    phoneNumber: string;
    phoneNumberId?: string | null;
    businessAccountId?: string | null;
    accessTokenLastFour?: string | null;
    verifyTokenLastFour?: string | null;
    qrCodeDataUrl: string | null;
    lastError: string;
    connectedAt: string | null;
  };
  health?: {
    runtimeStatus: string;
    isConnectionStalled?: boolean;
    isInboxReady: boolean;
    isHistoryStabilizing: boolean;
    isHistoryStuck: boolean;
    isLiveOnlyMode: boolean;
    importedConversationCount: number;
    importedMessageCount: number;
    lastSyncError: string | null;
  };
  channelSelectionBasePath?: string;
  mode?: "guided" | "settings";
  selectedChannelId?: string | null;
  workspaceId: string;
};

type ConnectionMethod = "api" | "web";

const connectionOptions = {
  api: {
    title: "WhatsApp Business API",
    badge: "Advanced",
    subtitle: "Official Meta Cloud setup",
    description:
      "Use Meta's official Cloud API if your business already has Meta Business access and approved WhatsApp sender details."
  },
  web: {
    title: "Web Connection via QR",
    badge: "Recommended",
    subtitle: "Fastest way to start",
    description:
      "Connect your existing WhatsApp Business app by scanning a QR code. This is the simplest path for first-time setup."
  }
} as const;

const LINKED_CHANNEL_STATUSES = ["AUTHENTICATED", "CONNECTED", "READY", "SYNCING_HISTORY"] as const;

function getPlainReadinessLabel(
  health: WhatsAppConnectionOnboardingProps["health"],
  initialWebSetup: WhatsAppConnectionOnboardingProps["initialWebSetup"]
) {
  if (!health) {
    return initialWebSetup.phoneNumber ? "Checking connection" : "Not connected yet";
  }

  if (health.isInboxReady) {
    return "Ready for live conversations";
  }

  if (health.isConnectionStalled) {
    return "Connection needs attention";
  }

  if (health.isLiveOnlyMode) {
    return "Live messages are working";
  }

  if (health.isHistoryStuck) {
    return "Connection needs attention";
  }

  if (health.isHistoryStabilizing || health.runtimeStatus === "SYNCING_HISTORY") {
    return "Still preparing";
  }

  if (initialWebSetup.phoneNumber || health.runtimeStatus === "CONNECTED") {
    return "Connection in progress";
  }

  return "Not connected yet";
}

function getIssueLabel(health: WhatsAppConnectionOnboardingProps["health"]) {
  if (!health?.lastSyncError) {
    return "No issues detected";
  }

  return health.lastSyncError;
}

export function WhatsAppConnectionOnboarding({
  channels = [],
  initialWebSetup,
  health,
  metaEmbeddedSignup,
  mode = "settings",
  selectedChannelId = null,
  channelSelectionBasePath = "/settings/whatsapp",
  workspaceId
}: WhatsAppConnectionOnboardingProps) {
  const router = useRouter();
  const { confirm } = useConfirmation();
  const isGuided = mode === "guided";
  const hasExistingWebConnection =
    initialWebSetup.connectionStatus !== "DISCONNECTED" ||
    Boolean(initialWebSetup.phoneNumber) ||
    Boolean(initialWebSetup.connectedAt) ||
    Boolean(initialWebSetup.lastError);
  const defaultConnectionMethod: ConnectionMethod = isGuided && !hasExistingWebConnection
    ? "web"
    : initialWebSetup.connectionMethod;
  const shouldOpenConnectionDetails = isGuided || (mode === "settings" && hasExistingWebConnection);
  const [step, setStep] = useState<1 | 2>(shouldOpenConnectionDetails ? 2 : 1);
  const [method, setMethod] = useState<ConnectionMethod>(defaultConnectionMethod);
  const [pendingMethod, setPendingMethod] = useState<ConnectionMethod>(defaultConnectionMethod);

  const selectedLabel = useMemo(
    () => (method ? connectionOptions[method].title : null),
    [method]
  );
  const readinessLabel = getPlainReadinessLabel(health, initialWebSetup);
  const issueLabel = getIssueLabel(health);
  const hasSelectedChannel = Boolean(selectedChannelId);
  const selectedChannel = channels.find((channel) => channel.id === selectedChannelId) ?? null;
  const channelRuntimeStatus = health?.runtimeStatus ?? initialWebSetup.connectionStatus;
  const isLinkedChannel =
    Boolean(initialWebSetup.connectedAt) ||
    Boolean(initialWebSetup.phoneNumber) ||
    Boolean(selectedChannel?.phoneNumber) ||
    LINKED_CHANNEL_STATUSES.includes(channelRuntimeStatus as (typeof LINKED_CHANNEL_STATUSES)[number]) ||
    LINKED_CHANNEL_STATUSES.includes(initialWebSetup.connectionStatus as (typeof LINKED_CHANNEL_STATUSES)[number]) ||
    LINKED_CHANNEL_STATUSES.includes(selectedChannel?.connectionStatus as (typeof LINKED_CHANNEL_STATUSES)[number]);
  const isConnected =
    Boolean(initialWebSetup.connectedAt) ||
    ["CONNECTED", "READY", "SYNCING_HISTORY"].includes(channelRuntimeStatus);
  const shouldLockChannelConfiguration = hasSelectedChannel && isLinkedChannel;
  const selectedNumberStatus = selectedChannelId ? "Completed" : "Needs setup";
  const methodStatus = method ? "Completed" : "Needs setup";
  const connectionStatus = isConnected ? "Completed" : "Needs setup";
  const inboxStatus = health?.isInboxReady ? "Completed" : "Review";
  const [createChannelError, setCreateChannelError] = useState<string | null>(null);
  const [isCreatingChannel, setIsCreatingChannel] = useState(false);
  const [deletingChannelId, setDeletingChannelId] = useState<string | null>(null);
  const [isSavingMethod, setIsSavingMethod] = useState(false);
  const [pendingChannelId, setPendingChannelId] = useState(selectedChannelId ?? "");
  const selectedChannelHref = hasSelectedChannel ? buildChannelSelectionHref(selectedChannelId) : null;
  const shouldShowChannelSelector = !shouldLockChannelConfiguration && (!isGuided || channels.length > 1 || !hasSelectedChannel);
  const shouldShowPostSelectionSections = isGuided || hasSelectedChannel;
  const completedSetupSteps = [
    selectedNumberStatus,
    methodStatus,
    connectionStatus,
    inboxStatus
  ].filter((status) => status === "Completed").length;
  const sidebarStep: 1 | 2 | 3 | 4 = !hasSelectedChannel
    ? 1
    : step === 1
      ? 2
      : isConnected
        ? 4
        : 3;

  useEffect(() => {
    setPendingChannelId(selectedChannelId ?? "");
  }, [selectedChannelId]);

  useEffect(() => {
    const nextMethod = selectedChannel?.connectionMethod ?? defaultConnectionMethod;
    setMethod(nextMethod);
    setPendingMethod(nextMethod);
  }, [defaultConnectionMethod, selectedChannel]);

  useEffect(() => {
    if (!isGuided || selectedChannelId || channels.length !== 1) {
      return;
    }

    router.push(buildChannelSelectionHref(channels[0].id));
    router.refresh();
  }, [channels, isGuided, router, selectedChannelId]);

  function buildChannelSelectionHref(channelId?: string | null) {
    const normalizedChannelId = channelId?.trim() ?? "";
    if (!normalizedChannelId) {
      return channelSelectionBasePath;
    }

    return `${channelSelectionBasePath}?channelId=${encodeURIComponent(normalizedChannelId)}`;
  }

  async function handleCreateChannel() {
    if (isCreatingChannel) {
      return;
    }

    setCreateChannelError(null);
    setIsCreatingChannel(true);
    try {
      const response = await fetch("/api/settings/whatsapp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          action: "create-channel"
        })
      });
      const payload = (await response.json().catch(() => null)) as
        | { channel?: { id?: string | null } | null; error?: string }
        | null;

      if (!response.ok || !payload?.channel?.id) {
        setCreateChannelError(payload?.error ?? "Unable to add another WhatsApp number.");
        return;
      }

      setCreateChannelError(null);
      setPendingChannelId(payload.channel.id);
      router.push(buildChannelSelectionHref(payload.channel.id));
      router.refresh();
    } finally {
      setIsCreatingChannel(false);
    }
  }

  function handleSelectChannel() {
    if (!pendingChannelId.trim()) {
      return;
    }

    setCreateChannelError(null);
    router.push(buildChannelSelectionHref(pendingChannelId));
    router.refresh();
  }

  function handleResetChannelSelection() {
    setCreateChannelError(null);
    setPendingChannelId("");
    router.push(buildChannelSelectionHref(null));
    router.refresh();
  }

  async function handleConnectionMethodChange(nextMethod: ConnectionMethod) {
    if (isSavingMethod || nextMethod === pendingMethod) {
      return;
    }

    const previousMethod = method;
    const previousPendingMethod = pendingMethod;

    setCreateChannelError(null);
    setPendingMethod(nextMethod);
    setMethod(nextMethod);
    setStep(2);

    if (!selectedChannelId) {
      return;
    }

    setIsSavingMethod(true);
    try {
      const response = await fetch(`/api/settings/whatsapp?channelId=${encodeURIComponent(selectedChannelId)}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          action: "save-connection-method",
          channelId: selectedChannelId,
          connectionMethod: nextMethod
        })
      });

      const payload = (await response.json().catch(() => null)) as { error?: string } | null;

      if (!response.ok) {
        setCreateChannelError(payload?.error ?? "Unable to save the WhatsApp connection method.");
        setMethod(previousMethod);
        setPendingMethod(previousPendingMethod);
        return;
      }

      router.refresh();
    } finally {
      setIsSavingMethod(false);
    }
  }

  async function handleDeleteChannel(channel: {
    id: string;
    label: string;
    phoneNumber: string | null;
  }) {
    if (deletingChannelId) {
      return;
    }

    const shouldDelete = await confirm({
      title: "Delete workspace number?",
      description: `Delete ${channel.label} ${channel.phoneNumber ? `(${channel.phoneNumber})` : ""} from this workspace? This removes the saved WhatsApp connection for that channel.`,
      confirmLabel: "Delete number",
      tone: "danger"
    });

    if (!shouldDelete) {
      return;
    }

    setDeletingChannelId(channel.id);
    try {
      setCreateChannelError(null);
      const response = await fetch(`/api/settings/whatsapp?channelId=${encodeURIComponent(channel.id)}`, {
        method: "DELETE"
      });
      const payload = (await response.json().catch(() => null)) as
        | {
            error?: string;
            nextChannelId?: string | null;
          }
        | null;

      if (!response.ok) {
        return;
      }

      if (payload?.nextChannelId) {
        setPendingChannelId(payload.nextChannelId);
        router.push(buildChannelSelectionHref(payload.nextChannelId));
      } else {
        setPendingChannelId("");
        router.push(buildChannelSelectionHref(null));
      }
      router.refresh();
    } finally {
      setDeletingChannelId(null);
    }
  }

  return (
    <OnboardingLayout
      badge={isGuided ? "Workspace onboarding" : "WhatsApp setup"}
      sidebar={<SetupProgressCard activeStep={sidebarStep} selectedMethodLabel={selectedLabel} variant={mode} />}
      subtitle={
        isGuided
          ? "Connect your existing WhatsApp Business number with QR. The official API is available as an advanced setup path."
          : "Select a number, choose the connection method, connect the phone, then verify inbox readiness."
      }
      title={
        isGuided
          ? "Connect your WhatsApp"
          : "WhatsApp setup checklist"
      }
    >
      {!isGuided ? (
        <section className="wa-settings-checklist">
          <article className="wa-settings-progress-card">
            <span>Setup progress</span>
            <strong>{completedSetupSteps} of 4 completed</strong>
            <div className="wa-settings-progress-track">
              <div style={{ width: `${(completedSetupSteps / 4) * 100}%` }} />
            </div>
            <p>{readinessLabel}</p>
          </article>

          <div className="wa-settings-step-grid">
            <article className="wa-settings-step-card">
              <span className="wa-settings-step-number">1</span>
              <div>
                <strong>Select number</strong>
                <p>{selectedChannel?.label ?? "Choose a workspace number to manage."}</p>
              </div>
              <span className={`wa-settings-step-status${hasSelectedChannel ? " completed" : " needs-setup"}`}>
                {selectedNumberStatus}
              </span>
            </article>
            <article className="wa-settings-step-card">
              <span className="wa-settings-step-number">2</span>
              <div>
                <strong>Choose method</strong>
                <p>{selectedLabel ?? "Select QR setup or Business API."}</p>
              </div>
              <span className="wa-settings-step-status completed">{methodStatus}</span>
            </article>
            <article className="wa-settings-step-card">
              <span className="wa-settings-step-number">3</span>
              <div>
                <strong>Connect phone</strong>
                <p>{isConnected ? initialWebSetup.phoneNumber : "Scan QR or save API credentials."}</p>
              </div>
              <span className={`wa-settings-step-status${isConnected ? " completed" : " needs-setup"}`}>
                {connectionStatus}
              </span>
            </article>
            <article className="wa-settings-step-card">
              <span className="wa-settings-step-number">4</span>
              <div>
                <strong>Verify inbox</strong>
                <p>{readinessLabel}</p>
              </div>
              <span className={`wa-settings-step-status${health?.isInboxReady ? " completed" : " review"}`}>
                {inboxStatus}
              </span>
            </article>
          </div>
        </section>
      ) : null}

      {!isGuided && channels.length ? (
        <article className="content-card settings-dark-panel wa-onboarding-followup-card">
          <div className="card-header settings-dark-panel-head">
            <div>
              <h3 className="card-title">Workspace numbers</h3>
              <p className="muted">Each number now has its own runtime, QR session, sync, and reconnect flow.</p>
            </div>
            <button
              className="button button-secondary"
              disabled={isCreatingChannel}
              onClick={handleCreateChannel}
              type="button"
            >
              {isCreatingChannel ? "Adding..." : "Add number"}
            </button>
          </div>
          {createChannelError ? <div className="form-error">{createChannelError}</div> : null}

          <div className="wa-next-steps-list">
            {channels.map((channel) => (
              <div className="wa-next-step-item" key={channel.id}>
                <div>
                  <strong>{channel.label}</strong>
                  <p>
                    {channel.phoneNumber || "No phone linked yet"} · {channel.connectionStatus}
                  </p>
                </div>
                <div className="wa-number-actions">
                  <Link
                    className="button button-secondary"
                    href={`/settings/whatsapp?channelId=${channel.id}`}
                  >
                    {selectedChannelId === channel.id ? "Selected" : "Manage"}
                  </Link>
                  <button
                    className="button button-secondary"
                    disabled={deletingChannelId === channel.id}
                    onClick={() =>
                      handleDeleteChannel({
                        id: channel.id,
                        label: channel.label,
                        phoneNumber: channel.phoneNumber
                      })
                    }
                    type="button"
                  >
                    {deletingChannelId === channel.id ? "Deleting..." : "Delete"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </article>
      ) : null}

      {isGuided ? (
        <div className="wa-onboarding-summary-grid">
          <article className="wa-onboarding-summary-card">
            <span>Current package</span>
            <strong>Workspace package active</strong>
            <p>Start with the first WhatsApp number now. More numbers can be added later if the package allows it.</p>
          </article>
          <article className="wa-onboarding-summary-card">
            <span>Workspace readiness</span>
            <strong>{readinessLabel}</strong>
            <p>{isConnected ? "A number is already linked to this workspace." : "Connect the first number to activate the shared inbox."}</p>
          </article>
        </div>
      ) : null}

      {shouldShowPostSelectionSections ? (
        <div className="wa-step-stage">
          {step === 1 ? (
            <div className="wa-step-panel">
              {isGuided ? (
                <article className="content-card settings-dark-panel wa-onboarding-focus-card">
                  <div className="wa-step-header">
                    <div>
                      <span className="wa-step-kicker">Recommended first step</span>
                      <h2>Start with QR setup</h2>
                      <p>
                        Scan a QR code from the phone that owns your WhatsApp Business number. You can move to the official API later when your Meta setup is ready.
                      </p>
                    </div>
                  </div>
                </article>
              ) : null}

              <div className="wa-method-grid">
                <ConnectionMethodCard
                  badge={connectionOptions.web.badge}
                  disabled={isSavingMethod}
                  description={connectionOptions.web.description}
                  isSelected={pendingMethod === "web"}
                  onSelect={() => void handleConnectionMethodChange("web")}
                  subtitle={connectionOptions.web.subtitle}
                  title={connectionOptions.web.title}
                />
                <ConnectionMethodCard
                  badge={connectionOptions.api.badge}
                  disabled={isSavingMethod}
                  description={connectionOptions.api.description}
                  isSelected={pendingMethod === "api"}
                  onSelect={() => void handleConnectionMethodChange("api")}
                  subtitle={connectionOptions.api.subtitle}
                  title={connectionOptions.api.title}
                />
              </div>

              <HelpNotice title={isGuided ? "Recommended path" : "Recommendation"}>
                {isGuided
                  ? "Use QR setup unless you already have Meta Business access, an approved WhatsApp sender, and are ready for the official Cloud API."
                  : "Use QR setup for the fastest connection, or choose WhatsApp Business API when the workspace already has Meta Cloud credentials."}
              </HelpNotice>

              <div className="wa-step-actions">
                <button className="button button-secondary" disabled type="button">
                  Step 1 of 2
                </button>
                {isSavingMethod ? <span className="table-subtle">Saving connection method...</span> : null}
              </div>
            </div>
          ) : (
            <div className="wa-step-panel">
              {!shouldLockChannelConfiguration ? (
                <article className="content-card settings-dark-panel wa-onboarding-followup-card">
                  <div className="wa-step-header">
                    <div>
                      <span className="wa-step-kicker">{isGuided ? "Setup option" : "Connection method"}</span>
                      <h2>{isGuided ? "Connect your WhatsApp number" : "Choose how this phone number connects"}</h2>
                      <p>
                        {isGuided
                          ? "QR setup is recommended for first-time onboarding. Use the API option only if your Meta Business setup is already prepared."
                          : "The selected method is bound to this WhatsApp channel. Switch here any time instead of hiding the choice behind the first step."}
                      </p>
                    </div>
                  </div>

                  <div className="wa-method-grid">
                    <ConnectionMethodCard
                      badge={connectionOptions.web.badge}
                      disabled={isSavingMethod}
                      description={connectionOptions.web.description}
                      isSelected={pendingMethod === "web"}
                      onSelect={() => void handleConnectionMethodChange("web")}
                      subtitle={connectionOptions.web.subtitle}
                      title={connectionOptions.web.title}
                    />
                    <ConnectionMethodCard
                      badge={connectionOptions.api.badge}
                      disabled={isSavingMethod}
                      description={connectionOptions.api.description}
                      isSelected={pendingMethod === "api"}
                      onSelect={() => void handleConnectionMethodChange("api")}
                      subtitle={connectionOptions.api.subtitle}
                      title={connectionOptions.api.title}
                    />
                  </div>

                  {createChannelError ? <div className="form-error">{createChannelError}</div> : null}

                  {isSavingMethod ? <div className="table-subtle">Saving connection method...</div> : null}

                  <div className="table-subtle">
                    {selectedChannel
                      ? `${selectedChannel.label} currently uses ${method === "api" ? "WhatsApp Business API" : "QR setup"}.`
                      : "Connexa is preparing your workspace number."}
                  </div>
                </article>
              ) : (
                <article className="content-card settings-dark-panel wa-onboarding-followup-card">
                  <div className="wa-step-header">
                    <div>
                      <span className="wa-step-kicker">Connected number</span>
                      <h2>{initialWebSetup.phoneNumber || selectedChannel?.label || "WhatsApp connected"}</h2>
                      <p>
                        This number is already connected. Disconnect it here when you need to relink or replace the phone.
                      </p>
                      {selectedChannelHref ? (
                        <div className="table-subtle">
                          Channel: {selectedChannelHref}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </article>
              )}

              {method === "api" ? (
                <>
                {shouldShowChannelSelector ? (
                  <article className="content-card settings-dark-panel wa-onboarding-followup-card">
                    <div className="wa-step-header">
                      <div>
                        <span className="wa-step-kicker">Workspace number</span>
                        <h2>{channels.length > 1 ? "Choose the WhatsApp number" : "Preparing your WhatsApp number"}</h2>
                        <p>
                          {channels.length > 1
                            ? "Select the workspace number that should use the official Meta Cloud sender."
                            : "Connexa is setting up the first workspace number before the API setup unlocks."}
                        </p>
                      </div>
                    </div>

                    {channels.length > 1 ? (
                      <div className="wa-form-grid">
                        <label className="control-block">
                          <span className="control-label">WhatsApp number</span>
                          <select
                            className="control-select"
                            onChange={(event) => setPendingChannelId(event.target.value)}
                            value={pendingChannelId}
                          >
                            <option value="">Select a WhatsApp number</option>
                            {channels.map((channel) => (
                              <option key={channel.id} value={channel.id}>
                                {channel.label} · {channel.phoneNumber || "No phone linked yet"} · {channel.connectionStatus}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                    ) : null}

                    {channels.length > 1 ? (
                      <div className="wa-step-actions">
                        <button
                          className="button button-secondary"
                          disabled={!pendingChannelId.trim() || pendingChannelId === selectedChannelId}
                          onClick={handleSelectChannel}
                          type="button"
                        >
                          Use selected number
                        </button>
                        <button
                          className="button button-secondary"
                          disabled={!hasSelectedChannel}
                          onClick={handleResetChannelSelection}
                          type="button"
                        >
                          Reset selection
                        </button>
                      </div>
                    ) : null}

                    <div className="table-subtle">
                      {hasSelectedChannel
                        ? `Current number: ${selectedChannel?.label ?? "Unknown number"}`
                        : "The setup form unlocks once the workspace number is ready."}
                    </div>
                  </article>
                ) : null}

                {hasSelectedChannel ? (
                  <OfficialApiSetupForm
                    channelId={selectedChannelId ?? ""}
                    connectionName={selectedChannel?.label ?? "Primary API channel"}
                    initialValues={{
                      businessAccountId: initialWebSetup.businessAccountId,
                      displayName: initialWebSetup.displayName,
                      phoneNumber: initialWebSetup.phoneNumber,
                      phoneNumberId: initialWebSetup.phoneNumberId,
                      verifyTokenLastFour: initialWebSetup.verifyTokenLastFour,
                      accessTokenLastFour: initialWebSetup.accessTokenLastFour,
                      connectionStatus: initialWebSetup.connectionStatus
                    }}
                    metaEmbeddedSignup={metaEmbeddedSignup}
                    onBack={() => setStep(1)}
                    workspaceId={workspaceId}
                  />
                ) : (
                  <HelpNotice title="Preparing WhatsApp number">
                    Connexa is preparing your workspace number. The API setup will unlock automatically once the number is ready.
                  </HelpNotice>
                )}
              </>
            ) : (
              <>
                {shouldShowChannelSelector ? (
                  <article className="content-card settings-dark-panel wa-onboarding-followup-card">
                    <div className="wa-step-header">
                      <div>
                        <span className="wa-step-kicker">Workspace number</span>
                        <h2>{channels.length > 1 ? "Choose the WhatsApp number" : "Preparing your WhatsApp number"}</h2>
                        <p>
                          {channels.length > 1
                            ? "Select the workspace number that should connect through QR."
                            : "Connexa is setting up the first workspace number before the QR code unlocks."}
                        </p>
                      </div>
                    </div>

                    {channels.length > 1 ? (
                      <div className="wa-form-grid">
                        <label className="control-block">
                          <span className="control-label">WhatsApp number</span>
                          <select
                            className="control-select"
                            onChange={(event) => setPendingChannelId(event.target.value)}
                            value={pendingChannelId}
                          >
                            <option value="">Select a WhatsApp number</option>
                            {channels.map((channel) => (
                              <option key={channel.id} value={channel.id}>
                                {channel.label} · {channel.phoneNumber || "No phone linked yet"} · {channel.connectionStatus}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                    ) : null}

                    {channels.length > 1 ? (
                      <div className="wa-step-actions">
                        <button
                          className="button button-secondary"
                          disabled={!pendingChannelId.trim() || pendingChannelId === selectedChannelId}
                          onClick={handleSelectChannel}
                          type="button"
                        >
                          Use selected number
                        </button>
                        <button
                          className="button button-secondary"
                          disabled={!hasSelectedChannel}
                          onClick={handleResetChannelSelection}
                          type="button"
                        >
                          Reset selection
                        </button>
                      </div>
                    ) : null}

                    <div className="table-subtle">
                      {hasSelectedChannel
                        ? `Current number: ${selectedChannel?.label ?? "Unknown number"}`
                        : "The QR code unlocks once the workspace number is ready."}
                    </div>
                  </article>
                ) : null}

                {hasSelectedChannel ? (
                  <WebQrSetupPanel
                    channelId={selectedChannelId}
                    health={health}
                    initialValues={initialWebSetup}
                    channelSelectionHref={selectedChannelHref}
                    channelSelectionBasePath={channelSelectionBasePath}
                    onboardingMode={mode}
                    onBack={isGuided ? undefined : () => setStep(1)}
                  />
                ) : (
                  <HelpNotice title="Preparing WhatsApp number">
                    Connexa is preparing your workspace number. The QR setup will unlock automatically once the number is ready.
                  </HelpNotice>
                )}
                </>
              )}
            </div>
          )}
        </div>
      ) : null}

      {isGuided ? (
        <div className="wa-onboarding-followup-grid">
          <article className="content-card settings-dark-panel wa-onboarding-followup-card">
            <div className="card-header settings-dark-panel-head">
              <div>
                <h3 className="card-title">Inbox readiness</h3>
                <p className="muted">Keep the language simple for first-time setup. Technical detail can stay secondary.</p>
              </div>
            </div>

            <div className="panel-row">
              <div className="lead-row">
                <strong>Connection</strong>
                <div className="table-subtle">{isConnected ? "Connected" : "Not connected yet"}</div>
              </div>
              <div className="lead-row">
                <strong>Inbox status</strong>
                <div className="table-subtle">{readinessLabel}</div>
              </div>
              <div className="lead-row">
                <strong>Message history</strong>
                <div className="table-subtle">
                  {health?.isHistoryStabilizing || health?.runtimeStatus === "SYNCING_HISTORY"
                    ? "Importing in background"
                    : health?.isInboxReady
                      ? "Ready"
                      : "Waiting for connection"}
                </div>
              </div>
              <div className="lead-row">
                <strong>Latest issue</strong>
                <div className="table-subtle">{issueLabel}</div>
              </div>
            </div>
          </article>

          <article className="content-card settings-dark-panel wa-onboarding-followup-card">
            <div className="card-header settings-dark-panel-head">
              <div>
                <h3 className="card-title">What to do next</h3>
                <p className="muted">Finish the first connection, then move into the next workspace setup tasks.</p>
              </div>
            </div>

            <div className="wa-next-steps-list">
              <div className="wa-next-step-item">
                <div>
                  <strong>Choose workspace industry</strong>
                  <p>Set the business profile that shapes workspace defaults and context.</p>
                </div>
                <Link className="button button-secondary" href="/settings/industry">
                  Open industry setup
                </Link>
              </div>
              <div className="wa-next-step-item">
                <div>
                  <strong>Invite your team</strong>
                  <p>Add agents once the inbox is connected and ready for real conversations.</p>
                </div>
                <Link className="button button-secondary" href="/team">
                  Open team setup
                </Link>
              </div>
              <div className="wa-next-step-item">
                <div>
                  <strong>Manage numbers later</strong>
                  <p>Use account settings when you want to review connected numbers and package capacity.</p>
                </div>
                <Link className="button button-secondary" href="/account-settings">
                  Open account settings
                </Link>
              </div>
            </div>
          </article>
        </div>
      ) : null}
    </OnboardingLayout>
  );
}
