"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ConnectionMethodCard } from "@/components/connection-method-card";
import { HelpNotice } from "@/components/help-notice";
import { OfficialApiSetupForm } from "@/components/official-api-setup-form";
import { OnboardingLayout } from "@/components/onboarding-layout";
import { SetupProgressCard } from "@/components/setup-progress-card";
import { WebQrSetupPanel } from "@/components/web-qr-setup-panel";

type WhatsAppConnectionOnboardingProps = {
  initialWebSetup: {
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
    isConnectionStalled?: boolean;
    isInboxReady: boolean;
    isHistoryStabilizing: boolean;
    isHistoryStuck: boolean;
    isLiveOnlyMode: boolean;
    importedConversationCount: number;
    importedMessageCount: number;
    lastSyncError: string | null;
  };
  mode?: "guided" | "settings";
};

type ConnectionMethod = "api" | "web";

const connectionOptions = {
  api: {
    title: "WhatsApp Business API",
    badge: "Coming soon",
    subtitle: "Official API option is not available yet",
    description:
      "Use the official Meta-hosted path for scalable messaging, higher confidence in long-term stability, and stronger operational controls across your support or sales team.",
    benefits: [
      "Official & Secure",
      "Advanced Features",
      "Higher Messaging Limits",
      "Official Support"
    ]
  },
  web: {
    title: "WhatsApp Web Connection",
    badge: "Popular",
    subtitle: "Best for small to medium businesses",
    description:
      "Connect quickly with a QR scan so your team can start onboarding in minutes, keep setup light, and move straight into conversation operations without an API rollout.",
    benefits: [
      "Quick Setup",
      "Personal Account",
      "Business Account",
      "Instant Connection"
    ]
  }
} as const;

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
  initialWebSetup,
  health,
  mode = "settings"
}: WhatsAppConnectionOnboardingProps) {
  const isGuided = mode === "guided";
  const hasExistingWebConnection =
    initialWebSetup.connectionStatus !== "DISCONNECTED" ||
    Boolean(initialWebSetup.phoneNumber) ||
    Boolean(initialWebSetup.connectedAt) ||
    Boolean(initialWebSetup.lastError);
  const shouldOpenConnectionDetails = isGuided || (mode === "settings" && hasExistingWebConnection);
  const [step, setStep] = useState<1 | 2>(shouldOpenConnectionDetails ? 2 : 1);
  const [method, setMethod] = useState<ConnectionMethod>("web");

  const selectedLabel = useMemo(
    () => (method ? connectionOptions[method].title : null),
    [method]
  );
  const readinessLabel = getPlainReadinessLabel(health, initialWebSetup);
  const issueLabel = getIssueLabel(health);
  const isConnected = Boolean(initialWebSetup.phoneNumber);

  return (
    <OnboardingLayout
      badge={isGuided ? "Workspace onboarding" : "WhatsApp onboarding"}
      sidebar={<SetupProgressCard activeStep={step} selectedMethodLabel={selectedLabel} variant={mode} />}
      subtitle={
        isGuided
          ? "Connect your first WhatsApp number, confirm the inbox is live, and get your team ready to respond."
          : step === 1
            ? "Select how you want to connect your WhatsApp account"
            : "Review the current WhatsApp connection, fix issues, or reconnect a number without repeating first-time setup."
      }
      title={
        isGuided
          ? "Set up your workspace"
          : step === 1
            ? "Choose Integration Method"
            : "Manage WhatsApp Connection"
      }
    >
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

      <div className="wa-step-stage">
        {step === 1 ? (
          <div className="wa-step-panel">
            {isGuided ? (
              <article className="content-card settings-dark-panel wa-onboarding-focus-card">
                <div className="wa-step-header">
                  <div>
                    <span className="wa-step-kicker">First action</span>
                    <h2>Connect your first WhatsApp number</h2>
                    <p>
                      This number will power the shared inbox for inbound and outbound conversations.
                      You can add more numbers later if your package allows it.
                    </p>
                  </div>
                </div>
              </article>
            ) : null}

            <div className="wa-method-grid">
              <ConnectionMethodCard
                badge={connectionOptions.api.badge}
                benefits={connectionOptions.api.benefits}
                description={connectionOptions.api.description}
                disabled
                isSelected={method === "api"}
                onSelect={() => setMethod("api")}
                subtitle={connectionOptions.api.subtitle}
                title={connectionOptions.api.title}
              />
              <ConnectionMethodCard
                badge={connectionOptions.web.badge}
                benefits={connectionOptions.web.benefits}
                description={connectionOptions.web.description}
                isSelected={method === "web"}
                onSelect={() => setMethod("web")}
                subtitle={connectionOptions.web.subtitle}
                title={connectionOptions.web.title}
              />
            </div>

            <HelpNotice title={isGuided ? "Recommended path" : "Recommendation"}>
              {isGuided
                ? "For now, use WhatsApp Web to get the inbox live. The official API option will be added later."
                : "WhatsApp Web is the available connection method for now. WhatsApp Business API will be enabled later."}
            </HelpNotice>

            <div className="wa-step-actions">
              <button className="button button-secondary" disabled type="button">
                Step 1 of 2
              </button>
              <button
                className="button button-primary"
                disabled={!method}
                onClick={() => setStep(2)}
                type="button"
              >
                Continue
              </button>
            </div>
          </div>
        ) : method === "api" ? (
          <OfficialApiSetupForm
            connectionName="Primary API channel"
            onBack={() => setStep(1)}
          />
        ) : (
          <WebQrSetupPanel
            health={health}
            initialValues={initialWebSetup}
            onboardingMode={mode}
            onBack={isGuided ? undefined : () => setStep(1)}
            skipHref={isGuided ? "/inbox" : undefined}
          />
        )}
      </div>

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
