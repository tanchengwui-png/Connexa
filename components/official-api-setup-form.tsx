"use client";

import { useState } from "react";
import { HelpNotice } from "@/components/help-notice";

type OfficialApiSetupFormProps = {
  connectionName: string;
  onBack: () => void;
};

export function OfficialApiSetupForm({
  connectionName,
  onBack
}: OfficialApiSetupFormProps) {
  const [values, setValues] = useState({
    connectionName,
    accessToken: "",
    phoneNumberId: "",
    businessAccountId: "",
    webhookVerifyToken: ""
  });
  const [feedback, setFeedback] = useState<string | null>(null);
  const [feedbackTone, setFeedbackTone] = useState<"success" | "error">("success");

  const isComplete = Object.values(values).every((value) => value.trim().length > 0);

  function updateValue(field: keyof typeof values, nextValue: string) {
    setValues((current) => ({
      ...current,
      [field]: nextValue
    }));
    setFeedback(null);
  }

  function handleTestConnection() {
    if (!isComplete) {
      setFeedbackTone("error");
      setFeedback("Fill in all API fields before testing the connection.");
      return;
    }

    setFeedbackTone("success");
    setFeedback("Connection payload looks complete. Hook the test button to a backend validator next.");
  }

  function handleConnect() {
    if (!isComplete) {
      setFeedbackTone("error");
      setFeedback("The connection cannot be saved until all required fields are filled.");
      return;
    }

    setFeedbackTone("success");
    setFeedback("API setup is ready for backend submission. Wire the Connect action to your credential-save endpoint.");
  }

  return (
    <div className="wa-setup-stack">
      <article className="content-card settings-dark-panel wa-setup-card">
        <div className="wa-step-header">
          <div>
            <span className="wa-step-kicker">Step 2</span>
            <h2>Setup Connection</h2>
            <p>Use your Meta WhatsApp Business credentials to create a long-term production connection.</p>
          </div>
          <button className="button button-secondary" onClick={handleTestConnection} type="button">
            Test Connection
          </button>
        </div>

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
              value={values.accessToken}
            />
            <span className="wa-field-helper">Use the permanent token generated for the production app and phone number.</span>
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
            <span className="control-label">Webhook Verify Token</span>
            <input
              className="control-input"
              onChange={(event) => updateValue("webhookVerifyToken", event.target.value)}
              placeholder="connexa-verify-token"
              value={values.webhookVerifyToken}
            />
            <span className="wa-field-helper">This should match the verification token configured in your webhook subscription.</span>
          </label>
        </div>

        <HelpNotice title="Security note" tone="accent">
          Keep API credentials server-side only. Store them encrypted and never expose tokens in browser logs,
          client bundles, or support screenshots.
        </HelpNotice>

        {feedback ? (
          <div className={feedbackTone === "success" ? "form-success" : "form-error"}>{feedback}</div>
        ) : null}

        <div className="wa-form-actions">
          <button className="button button-secondary" onClick={onBack} type="button">
            Back
          </button>
          <button
            className="button button-primary"
            disabled={!isComplete}
            onClick={handleConnect}
            type="button"
          >
            Connect
          </button>
        </div>
      </article>
    </div>
  );
}
