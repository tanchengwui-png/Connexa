"use client";

import { useEffect, useState, useTransition } from "react";
import { HelpNotice } from "@/components/help-notice";
import { getPreferredWhatsAppChannelLabel } from "@/lib/whatsapp-channel-label";

declare global {
  interface Window {
    FB?: {
      init: (input: {
        appId: string;
        autoLogAppEvents?: boolean;
        cookie?: boolean;
        xfbml?: boolean;
        version: string;
      }) => void;
      login: (
        callback: (response: { authResponse?: { code?: string } | null; status?: string }) => void,
        options: Record<string, unknown>
      ) => void;
    };
    fbAsyncInit?: () => void;
  }
}

type OfficialApiSetupFormProps = {
  channelId: string;
  connectionName: string;
  initialValues?: {
    businessAccountId?: string | null;
    displayName?: string | null;
    phoneNumber?: string | null;
    phoneNumberId?: string | null;
    verifyTokenLastFour?: string | null;
    accessTokenLastFour?: string | null;
    connectionStatus?: string | null;
  };
  metaEmbeddedSignup?: {
    enabled: boolean;
    appId: string;
    configId: string;
    graphVersion: string;
  };
  onBack: () => void;
  workspaceId: string;
};

type EmbeddedSignupPhoneNumber = {
  businessAccountId: string | null;
  businessName: string | null;
  phoneNumberId: string;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  codeVerificationStatus: string | null;
  qualityRating: string | null;
};

export function OfficialApiSetupForm({
  channelId,
  connectionName,
  initialValues,
  metaEmbeddedSignup,
  onBack,
  workspaceId
}: OfficialApiSetupFormProps) {
  const [isPending, startTransition] = useTransition();
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [isEmbeddedSignupPending, setIsEmbeddedSignupPending] = useState(false);
  const [facebookSdkReady, setFacebookSdkReady] = useState(false);
  const [showManualSetup, setShowManualSetup] = useState(false);
  const [embeddedSetupId, setEmbeddedSetupId] = useState<string | null>(null);
  const [embeddedPhoneNumbers, setEmbeddedPhoneNumbers] = useState<EmbeddedSignupPhoneNumber[]>([]);
  const [selectedEmbeddedPhoneNumberId, setSelectedEmbeddedPhoneNumberId] = useState("");
  const [twoStepPin, setTwoStepPin] = useState("");
  const [isFinalizingEmbeddedSignup, setIsFinalizingEmbeddedSignup] = useState(false);
  const preferredInitialConnectionName =
    getPreferredWhatsAppChannelLabel({
      displayName: initialValues?.displayName,
      phoneNumber: initialValues?.phoneNumber,
      fallbackLabel: connectionName
    }) ?? connectionName;
  const [values, setValues] = useState({
    connectionName: preferredInitialConnectionName,
    accessToken: "",
    phoneNumberId: initialValues?.phoneNumberId?.trim() || "",
    businessAccountId: initialValues?.businessAccountId?.trim() || "",
    phoneNumber: initialValues?.phoneNumber?.trim() || "",
    webhookVerifyToken: ""
  });
  const [feedback, setFeedback] = useState<string | null>(null);
  const [feedbackTone, setFeedbackTone] = useState<"success" | "error">("success");
  const [hasServerManagedConnection, setHasServerManagedConnection] = useState(Boolean(initialValues?.accessTokenLastFour));

  const isComplete = Object.values(values).every((value) => value.trim().length > 0);
  const hasSavedAccessToken = Boolean(initialValues?.accessTokenLastFour);
  const hasSavedVerifyToken = Boolean(initialValues?.verifyTokenLastFour);
  const isConnected =
    (initialValues?.connectionStatus === "CONNECTED" && Boolean(initialValues?.phoneNumberId)) ||
    Boolean(values.phoneNumberId && values.businessAccountId && hasServerManagedConnection);
  const facebookButtonDisabled = isEmbeddedSignupPending;
  const facebookButtonLabel = isEmbeddedSignupPending
    ? "Connecting..."
    : "Connect with Facebook";
  const selectedEmbeddedPhoneNumber = embeddedPhoneNumbers.find(
    (phoneNumber) => phoneNumber.phoneNumberId === selectedEmbeddedPhoneNumberId
  );
  const embeddedSignupStep = isConnected
    ? 4
    : embeddedSetupId
      ? selectedEmbeddedPhoneNumberId && /^\d{6}$/.test(twoStepPin.trim())
        ? 3
        : selectedEmbeddedPhoneNumberId
          ? 3
          : 2
      : 1;

  useEffect(() => {
    if (!metaEmbeddedSignup?.enabled) {
      setFacebookSdkReady(false);
      return;
    }

    if (window.FB) {
      window.FB.init({
        appId: metaEmbeddedSignup.appId,
        autoLogAppEvents: true,
        cookie: true,
        xfbml: false,
        version: metaEmbeddedSignup.graphVersion
      });
      setFacebookSdkReady(true);
      return;
    }

    window.fbAsyncInit = () => {
      window.FB?.init({
        appId: metaEmbeddedSignup.appId,
        autoLogAppEvents: true,
        cookie: true,
        xfbml: false,
        version: metaEmbeddedSignup.graphVersion
      });
      setFacebookSdkReady(true);
    };

    const script = document.createElement("script");
    script.async = true;
    script.defer = true;
    script.crossOrigin = "anonymous";
    script.src = "https://connect.facebook.net/en_US/sdk.js";
    document.body.appendChild(script);

    return () => {
      window.fbAsyncInit = undefined;
    };
  }, [metaEmbeddedSignup]);

  function updateValue(field: keyof typeof values, nextValue: string) {
    setValues((current) => ({
      ...current,
      [field]: nextValue
    }));
    setFeedback(null);
  }

  function applyConnectedChannel(channel: {
    displayName?: string | null;
    phoneNumber?: string | null;
    phoneNumberId?: string | null;
    businessAccountId?: string | null;
  }) {
    setValues((current) => ({
      ...current,
      connectionName:
        getPreferredWhatsAppChannelLabel({
          displayName: channel.displayName,
          phoneNumber: channel.phoneNumber,
          fallbackLabel: current.connectionName
        }) ?? current.connectionName,
      phoneNumber: channel.phoneNumber?.trim() || current.phoneNumber,
      phoneNumberId: channel.phoneNumberId?.trim() || current.phoneNumberId,
      businessAccountId: channel.businessAccountId?.trim() || current.businessAccountId,
      accessToken: "",
      webhookVerifyToken: ""
    }));
  }

  function handleTestConnection() {
    setFeedback(null);
    setIsTestingConnection(true);
    void fetch("/api/integrations/meta/test-connection", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        channelId
      })
    })
      .then(async (response) => {
        const payload = (await response.json().catch(() => null)) as
          | {
              error?: string;
              phoneNumber?: {
                displayPhoneNumber?: string | null;
                verifiedName?: string | null;
              };
            }
          | null;

        if (!response.ok) {
          setFeedbackTone("error");
          setFeedback(payload?.error ?? "Unable to test the Meta connection.");
          return;
        }

        setFeedbackTone("success");
        setFeedback(
          `Meta connection is healthy for ${payload?.phoneNumber?.displayPhoneNumber || payload?.phoneNumber?.verifiedName || values.phoneNumberId}.`
        );
      })
      .catch(() => {
        setFeedbackTone("error");
        setFeedback("Unable to test the Meta connection.");
      })
      .finally(() => {
        setIsTestingConnection(false);
      });
  }

  function handleConnect() {
    if (!isComplete) {
      setFeedbackTone("error");
      setFeedback("The connection cannot be saved until all required fields are filled.");
      return;
    }

    setFeedback(null);
    startTransition(async () => {
      const response = await fetch(`/api/settings/whatsapp?channelId=${encodeURIComponent(channelId)}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          action: "save-cloud",
          channelId,
          connectionName: values.connectionName,
          accessToken: values.accessToken,
          phoneNumberId: values.phoneNumberId,
          businessAccountId: values.businessAccountId,
          phoneNumber: values.phoneNumber,
          webhookVerifyToken: values.webhookVerifyToken
        })
      });

      const payload = (await response.json().catch(() => null)) as { error?: string } | null;

      if (!response.ok) {
        setFeedbackTone("error");
        setFeedback(payload?.error ?? "Unable to save WhatsApp Cloud credentials.");
        return;
      }

      setFeedbackTone("success");
      setFeedback("WhatsApp Cloud credentials saved. Meta webhook traffic can use /api/webhooks/meta/whatsapp.");
      setHasServerManagedConnection(true);
      applyConnectedChannel({
        displayName: values.connectionName,
        phoneNumber: values.phoneNumber,
        phoneNumberId: values.phoneNumberId,
        businessAccountId: values.businessAccountId
      });
    });
  }

  function handleEmbeddedSignup() {
    if (!metaEmbeddedSignup?.enabled) {
      setFeedbackTone("error");
      setFeedback("Meta Embedded Signup is not configured yet.");
      return;
    }

    if (!window.FB) {
      setFeedbackTone("error");
      setFeedback("Facebook SDK is still loading. Try again in a moment.");
      return;
    }

    setFeedback(null);
    setIsEmbeddedSignupPending(true);
    window.FB.login(
      (response) => {
        const code = response.authResponse?.code?.trim() || "";
        if (!code) {
          setFeedbackTone("error");
          setFeedback("Meta signup was cancelled or did not return an authorization code.");
          setIsEmbeddedSignupPending(false);
          return;
        }

        void fetch("/api/integrations/meta/embedded-signup/callback", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            code,
            workspaceId,
            channelId,
            connectionName: values.connectionName
          })
        })
          .then(async (signupResponse) => {
            const payload = (await signupResponse.json().catch(() => null)) as
              | {
                  error?: string;
                  setupId?: string;
                  phoneNumbers?: EmbeddedSignupPhoneNumber[];
                  channel?: {
                    displayName?: string | null;
                    phoneNumber?: string | null;
                    phoneNumberId?: string | null;
                    businessAccountId?: string | null;
                  };
                }
              | null;

            if (!signupResponse.ok || !payload?.setupId || !payload?.phoneNumbers?.length) {
              setFeedbackTone("error");
              setFeedback(payload?.error ?? "Unable to finish Meta Embedded Signup.");
              return;
            }

            setEmbeddedSetupId(payload.setupId);
            setEmbeddedPhoneNumbers(payload.phoneNumbers);
            setSelectedEmbeddedPhoneNumberId(payload.phoneNumbers[0]?.phoneNumberId ?? "");
            setTwoStepPin("");
            setFeedbackTone("success");
            setFeedback("Facebook connected. Choose the WhatsApp phone number to activate for this channel.");
          })
          .catch(() => {
            setFeedbackTone("error");
            setFeedback("Unable to finish Meta Embedded Signup.");
          })
          .finally(() => {
            setIsEmbeddedSignupPending(false);
          });
      },
      {
        config_id: metaEmbeddedSignup.configId,
        response_type: "code",
        override_default_response_type: true,
        extras: {
          feature: "whatsapp_embedded_signup"
        }
      }
    );
  }

  function handleFinalizeEmbeddedSignup() {
    if (!embeddedSetupId || !selectedEmbeddedPhoneNumberId || !/^\d{6}$/.test(twoStepPin.trim())) {
      setFeedbackTone("error");
      setFeedback("Choose a phone number and enter a valid 6-digit PIN before completing setup.");
      return;
    }

    setFeedback(null);
    setIsFinalizingEmbeddedSignup(true);
    void fetch("/api/integrations/meta/embedded-signup/callback", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        setupId: embeddedSetupId,
        workspaceId,
        channelId,
        phoneNumberId: selectedEmbeddedPhoneNumberId,
        pin: twoStepPin,
        connectionName: values.connectionName
      })
    })
      .then(async (response) => {
        const payload = (await response.json().catch(() => null)) as
          | {
              error?: string;
              channel?: {
                displayName?: string | null;
                phoneNumber?: string | null;
                phoneNumberId?: string | null;
                businessAccountId?: string | null;
              };
            }
          | null;

        if (!response.ok || !payload?.channel) {
          setFeedbackTone("error");
          setFeedback(payload?.error ?? "Unable to complete WhatsApp Cloud setup.");
          return;
        }

        applyConnectedChannel(payload.channel);
        setHasServerManagedConnection(true);
        setEmbeddedSetupId(null);
        setEmbeddedPhoneNumbers([]);
        setSelectedEmbeddedPhoneNumberId("");
        setTwoStepPin("");
        setFeedbackTone("success");
        setFeedback(
          `Connected ${payload.channel.phoneNumber || payload.channel.displayName || payload.channel.phoneNumberId || "your Meta WhatsApp sender"} through Facebook.`
        );
      })
      .catch(() => {
        setFeedbackTone("error");
        setFeedback("Unable to complete WhatsApp Cloud setup.");
      })
      .finally(() => {
        setIsFinalizingEmbeddedSignup(false);
      });
  }

  return (
    <div className="wa-setup-stack">
      <article className="content-card settings-dark-panel wa-setup-card">
        <div className="wa-step-header">
          <div>
            <span className="wa-step-kicker">Step 2</span>
            <h2>Connect WhatsApp Business API</h2>
            <p>Use Facebook login to authorize the selected channel and let Connexa save the Cloud API sender automatically.</p>
          </div>
        </div>

        <div className="wa-facebook-connect-panel">
          <div className="wa-facebook-connect-copy">
            <span className="wa-step-kicker">Recommended</span>
            <strong>Connect with Facebook</strong>
            <p>
              Authorize Meta Embedded Signup once. Connexa will exchange the login code server-side, retrieve the WhatsApp sender details, and store the token for this channel.
            </p>
          </div>
          <button
            className="button button-primary"
            disabled={facebookButtonDisabled}
            onClick={handleEmbeddedSignup}
            type="button"
          >
            {facebookButtonLabel}
          </button>
        </div>

        <div className="wa-cloud-setup-guide">
          <div className={`wa-cloud-setup-step${embeddedSignupStep >= 1 ? " active" : ""}`}>
            <span>1</span>
            <div>
              <strong>Connect with Facebook</strong>
              <p>
                {embeddedSetupId || isConnected
                  ? "Facebook authorization completed."
                  : "Grant Connexa access to your WhatsApp Business Account."}
              </p>
            </div>
          </div>

          <div className={`wa-cloud-setup-step${embeddedSignupStep >= 2 ? " active" : ""}`}>
            <span>2</span>
            <div>
              <strong>Choose phone number</strong>
              {embeddedPhoneNumbers.length ? (
                <select
                  className="control-select"
                  onChange={(event) => setSelectedEmbeddedPhoneNumberId(event.target.value)}
                  value={selectedEmbeddedPhoneNumberId}
                >
                  {embeddedPhoneNumbers.map((phoneNumber) => (
                    <option key={phoneNumber.phoneNumberId} value={phoneNumber.phoneNumberId}>
                      {phoneNumber.displayPhoneNumber ||
                        phoneNumber.verifiedName ||
                        phoneNumber.phoneNumberId}
                      {phoneNumber.businessName ? ` - ${phoneNumber.businessName}` : ""}
                    </option>
                  ))}
                </select>
              ) : (
                <p>Waiting for Step 1 to be completed.</p>
              )}
            </div>
          </div>

          <div className={`wa-cloud-setup-step${embeddedSignupStep >= 3 ? " active" : ""}`}>
            <span>3</span>
            <div>
              <strong>Enter two-step verification PIN</strong>
              {embeddedSetupId ? (
                <input
                  className="control-input"
                  inputMode="numeric"
                  maxLength={6}
                  onChange={(event) => setTwoStepPin(event.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="6-digit PIN"
                  type="password"
                  value={twoStepPin}
                />
              ) : (
                <p>Waiting for Step 1 to be completed.</p>
              )}
            </div>
          </div>

          <div className={`wa-cloud-setup-step${isConnected ? " active" : ""}`}>
            <span>4</span>
            <div>
              <strong>Done</strong>
              <p>
                {isConnected
                  ? "WhatsApp Cloud API setup is complete for this channel."
                  : selectedEmbeddedPhoneNumber
                    ? `Ready to connect ${selectedEmbeddedPhoneNumber.displayPhoneNumber || selectedEmbeddedPhoneNumber.verifiedName || selectedEmbeddedPhoneNumber.phoneNumberId}.`
                    : "Complete the previous steps first."}
              </p>
            </div>
            <button
              className="button button-primary"
              disabled={!embeddedSetupId || !selectedEmbeddedPhoneNumberId || !/^\d{6}$/.test(twoStepPin.trim()) || isFinalizingEmbeddedSignup}
              onClick={handleFinalizeEmbeddedSignup}
              type="button"
            >
              {isFinalizingEmbeddedSignup ? "Completing..." : "Done"}
            </button>
          </div>
        </div>

        {!metaEmbeddedSignup?.enabled ? (
          <HelpNotice title="Facebook connection is not configured">
            Connect with Facebook needs Meta app ID, app secret, config ID, redirect URI, and webhook verify token
            from either platform admin settings or server environment variables before it can complete.
          </HelpNotice>
        ) : null}

        {isConnected || hasSavedAccessToken ? (
          <div className="wa-cloud-connection-summary">
            <div>
              <span className="wa-step-kicker">Connected sender</span>
              <strong>{values.phoneNumber || values.connectionName || "WhatsApp Cloud sender"}</strong>
              <p>
                {values.phoneNumberId ? `Phone number ID ${values.phoneNumberId}` : "Phone number ID saved server-side"}
                {values.businessAccountId ? ` · Business account ${values.businessAccountId}` : ""}
              </p>
            </div>
            <span className="wa-cloud-status-pill">Connected</span>
          </div>
        ) : null}

        <div className="wa-manual-setup-shell">
          <button
            className="button button-secondary"
            onClick={() => setShowManualSetup((current) => !current)}
            type="button"
          >
            {showManualSetup ? "Hide manual setup" : "Advanced manual setup"}
          </button>

          {showManualSetup ? (
            <>
              <div className="wa-form-grid">
                <label className="control-block">
                  <span className="control-label">Connection Name</span>
                  <input
                    className="control-input"
                    onChange={(event) => updateValue("connectionName", event.target.value)}
                    placeholder="Main support account"
                    value={values.connectionName}
                  />
                </label>

                <label className="control-block">
                  <span className="control-label">Access Token</span>
                  <input
                    className="control-input"
                    onChange={(event) => updateValue("accessToken", event.target.value)}
                    placeholder="EAAG..."
                    type="password"
                    value={values.accessToken}
                  />
                  <span className="wa-field-helper">
                    {hasSavedAccessToken
                      ? `A token is already saved for this channel. Enter a new token only if you want to rotate it.`
                      : "Use the permanent token generated for the production app and phone number."}
                  </span>
                </label>

                <label className="control-block">
                  <span className="control-label">Phone Number ID</span>
                  <input
                    className="control-input"
                    onChange={(event) => updateValue("phoneNumberId", event.target.value)}
                    placeholder="123456789012345"
                    value={values.phoneNumberId}
                  />
                  <span className="wa-field-helper">This identifies the specific WhatsApp sender profile inside your Meta app.</span>
                </label>

                <label className="control-block">
                  <span className="control-label">Business Account ID</span>
                  <input
                    className="control-input"
                    onChange={(event) => updateValue("businessAccountId", event.target.value)}
                    placeholder="987654321098765"
                    value={values.businessAccountId}
                  />
                  <span className="wa-field-helper">Use the WhatsApp Business Account ID tied to the approved sender.</span>
                </label>

                <label className="control-block">
                  <span className="control-label">Display Phone Number</span>
                  <input
                    className="control-input"
                    onChange={(event) => updateValue("phoneNumber", event.target.value)}
                    placeholder="60123456789"
                    value={values.phoneNumber}
                  />
                  <span className="wa-field-helper">Optional, but recommended so the inbox shows the sender number clearly.</span>
                </label>

                <label className="control-block">
                  <span className="control-label">Webhook Verify Token</span>
                  <input
                    className="control-input"
                    onChange={(event) => updateValue("webhookVerifyToken", event.target.value)}
                    placeholder="connexa-verify-token"
                    type="password"
                    value={values.webhookVerifyToken}
                  />
                  <span className="wa-field-helper">
                    {hasSavedVerifyToken
                      ? "A webhook verify token is already stored for this channel. Enter a new one only if you need to rotate it."
                      : "This should match the verification token configured in your webhook subscription."}
                  </span>
                </label>
              </div>

              <HelpNotice title="Security note" tone="accent">
                Keep API credentials server-side only. Store them encrypted and never expose tokens in browser logs,
                client bundles, or support screenshots.
              </HelpNotice>
            </>
          ) : null}
        </div>

        {feedback ? (
          <div className={feedbackTone === "success" ? "form-success" : "form-error"}>{feedback}</div>
        ) : null}

        <div className="wa-form-actions">
          <button className="button button-secondary" onClick={onBack} type="button">
            Back
          </button>
          <button
            className="button button-primary"
            disabled={!showManualSetup || !isComplete || isPending}
            onClick={handleConnect}
            type="button"
          >
            {isPending ? "Saving..." : "Save manual credentials"}
          </button>
        </div>
      </article>
    </div>
  );
}
