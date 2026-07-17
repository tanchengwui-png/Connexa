"use client";

import { FormEvent, useRef, useState } from "react";
import {
  convertSessionTimeoutToMinutes,
  splitSessionTimeoutForDisplay,
  type SessionTimeoutUnit
} from "@/lib/session-timeout";

type PlatformSmtpSettingsFormProps = {
  initialValues: {
    smtpHost: string;
    smtpPort: number;
    smtpSecure: boolean;
    smtpUser: string;
    smtpFrom: string;
    supportEmail: string;
    emailBrandName: string;
    emailBrandTagline: string;
    smtpPassConfigured: boolean;
    billplzApiKey: string;
    billplzXSignatureKey: string;
    billplzCollectionId: string;
    billplzSandbox: boolean;
    automationWorkflowIdleHours: number;
    automationWorkflowExpireHours: number;
    freeTrialDurationDays: number;
    expiredAccountCleanupDays: number;
    sessionTimeoutMinutes: number;
    rememberMeTimeoutMinutes: number;
    billplzConfigured: boolean;
    billplzApiKeyConfigured: boolean;
    billplzXSignatureKeyConfigured: boolean;
  };
  adminEmail: string;
};

export function PlatformSmtpSettingsForm({ initialValues, adminEmail }: PlatformSmtpSettingsFormProps) {
  const initialSessionTimeout = splitSessionTimeoutForDisplay(initialValues.sessionTimeoutMinutes);
  const initialRememberTimeout = splitSessionTimeoutForDisplay(initialValues.rememberMeTimeoutMinutes);
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, setPending] = useState(false);
  const [testPending, setTestPending] = useState(false);
  const [billplzTestPending, setBillplzTestPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sessionTimeoutValue, setSessionTimeoutValue] = useState(String(initialSessionTimeout.value));
  const [sessionTimeoutUnit, setSessionTimeoutUnit] = useState<SessionTimeoutUnit>(initialSessionTimeout.unit);
  const [rememberTimeoutValue, setRememberTimeoutValue] = useState(String(initialRememberTimeout.value));
  const [rememberTimeoutUnit, setRememberTimeoutUnit] = useState<SessionTimeoutUnit>(initialRememberTimeout.unit);
  const smtpReady =
    Boolean(initialValues.smtpHost) &&
    Boolean(initialValues.smtpUser) &&
    Boolean(initialValues.smtpFrom) &&
    Boolean(initialValues.supportEmail) &&
    initialValues.smtpPassConfigured;
  const billplzReady =
    Boolean(initialValues.billplzCollectionId) &&
    initialValues.billplzApiKeyConfigured &&
    initialValues.billplzXSignatureKeyConfigured;
  const overallReady = smtpReady && billplzReady;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    setError(null);

    const formData = new FormData(event.currentTarget);
    const response = await fetch("/api/platform/settings", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        smtpHost: String(formData.get("smtpHost") ?? ""),
        smtpPort: Number(formData.get("smtpPort") ?? 587),
        smtpSecure: formData.get("smtpSecure") === "on",
        smtpUser: String(formData.get("smtpUser") ?? ""),
        smtpPass: String(formData.get("smtpPass") ?? ""),
        smtpFrom: String(formData.get("smtpFrom") ?? ""),
        supportEmail: String(formData.get("supportEmail") ?? ""),
        emailBrandName: String(formData.get("emailBrandName") ?? ""),
        emailBrandTagline: String(formData.get("emailBrandTagline") ?? ""),
        billplzApiKey: String(formData.get("billplzApiKey") ?? ""),
        billplzXSignatureKey: String(formData.get("billplzXSignatureKey") ?? ""),
        billplzCollectionId: String(formData.get("billplzCollectionId") ?? ""),
        billplzSandbox: formData.get("billplzSandbox") === "on",
        automationWorkflowIdleHours: Number(formData.get("automationWorkflowIdleHours") ?? 24),
        automationWorkflowExpireHours: Number(formData.get("automationWorkflowExpireHours") ?? 72),
        freeTrialDurationDays: Number(formData.get("freeTrialDurationDays") ?? 14),
        expiredAccountCleanupDays: Number(formData.get("expiredAccountCleanupDays") ?? 60),
        sessionTimeoutMinutes: convertSessionTimeoutToMinutes(
          Number(sessionTimeoutValue || 0),
          sessionTimeoutUnit
        ),
        rememberMeTimeoutMinutes: convertSessionTimeoutToMinutes(
          Number(rememberTimeoutValue || 0),
          rememberTimeoutUnit
        )
      })
    });

    const data = (await response.json()) as { error?: string };

    if (!response.ok) {
      setError(data.error ?? "Unable to save SMTP settings.");
      setPending(false);
      return;
    }

    setMessage("Platform settings saved.");
    setPending(false);
  }

  async function handleTestEmail() {
    setTestPending(true);
    setMessage(null);
    setError(null);

    const response = await fetch("/api/platform/test-email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        to: adminEmail
      })
    });

    const data = (await response.json()) as { error?: string };

    if (!response.ok) {
      setError(data.error ?? "Unable to send test email.");
      setTestPending(false);
      return;
    }

    setMessage(`Test email sent to ${adminEmail}.`);
    setTestPending(false);
  }

  async function handleTestBillplz() {
    const form = formRef.current;

    if (!form) {
      setError("Billplz form is not ready yet.");
      return;
    }

    setBillplzTestPending(true);
    setMessage(null);
    setError(null);

    const formData = new FormData(form);
    const response = await fetch("/api/platform/test-billplz", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        billplzApiKey: String(formData.get("billplzApiKey") ?? ""),
        billplzXSignatureKey: String(formData.get("billplzXSignatureKey") ?? ""),
        billplzCollectionId: String(formData.get("billplzCollectionId") ?? ""),
        billplzSandbox: formData.get("billplzSandbox") === "on"
      })
    });

    const data = (await response.json()) as {
      error?: string;
      collection?: { id: string; title: string; status: string };
      xSignatureConfigured?: boolean;
      sandbox?: boolean;
    };

    if (!response.ok) {
      setError(data.error ?? "Unable to test Billplz connection.");
      setBillplzTestPending(false);
      return;
    }

    setMessage(
      `Billplz connection verified${data.sandbox ? " in sandbox" : ""}: collection ${data.collection?.id ?? ""}${
        data.collection?.title ? ` (${data.collection.title})` : ""
      } is ${data.collection?.status ?? "available"}${data.xSignatureConfigured ? "." : ". X signature key is still missing."}`
    );
    setBillplzTestPending(false);
  }

  return (
    <section className="content-card settings-dark-panel platform-settings-form-panel">
      <div className="card-header settings-dark-panel-head">
        <div className="platform-settings-header-copy">
          <span className="platform-settings-header-eyebrow">
            {overallReady ? "Platform ready" : "Platform needs attention"}
          </span>
          <h3 className="card-title">Platform settings</h3>
          <p className="muted">
            Keep delivery, checkout, and workflow inactivity policy in one place so configuration status and the
            editable controls stay together.
          </p>
        </div>
      </div>

      <form className="availability-settings-form platform-settings-workspace" onSubmit={handleSubmit} ref={formRef}>
        <div className="platform-settings-status-shell">
          <div className="platform-settings-status-copy">
            <span className="platform-settings-header-eyebrow">
              {overallReady ? "Platform ready" : "Platform needs attention"}
            </span>
            <strong>Platform settings</strong>
            <p>
              Keep delivery, checkout, and workflow inactivity policy in one place so configuration status and the
              editable controls stay together.
            </p>
          </div>

          <div className="platform-settings-status-strip">
            <article className="platform-settings-status-pill">
              <span>SMTP</span>
              <strong>{smtpReady ? "Ready" : "Incomplete"}</strong>
              <p>
                {smtpReady
                  ? "Email delivery is configured."
                  : "Add host, sender, support email, and password."}
              </p>
            </article>

            <article className="platform-settings-status-pill">
              <span>Billplz</span>
              <strong>{billplzReady ? "Ready" : "Incomplete"}</strong>
              <p>
                {billplzReady
                  ? "Checkout can create and validate bills."
                  : "Add API key, X signature key, and collection ID."}
              </p>
            </article>

            <article className="platform-settings-status-pill">
              <span>Workflow timeout</span>
              <strong>
                {initialValues.automationWorkflowIdleHours}h idle · {initialValues.automationWorkflowExpireHours}h expire
              </strong>
              <p>Global fallback when a waiting step has no specific timeout.</p>
            </article>

            <article className="platform-settings-status-pill">
              <span>Session policy</span>
              <strong>
                {formatSessionTimeoutSummary(initialSessionTimeout)} idle ·{" "}
                {formatSessionTimeoutSummary(initialRememberTimeout)} remember me
              </strong>
              <p>Idle sessions renew from activity. Remember me stays fixed until its original expiry.</p>
            </article>
          </div>
        </div>

        <div className="platform-settings-columns full-width platform-settings-primary-grid">
          <section className="availability-settings-section platform-settings-section-card">
            <div className="availability-settings-section-head">
              <strong>SMTP server and sender</strong>
              <p className="table-subtle">
                Keep transport, sender identity, and support mailbox together so email setup can be
                verified in one pass.
              </p>
            </div>

            <div className="platform-settings-field-grid compact">
              <label className="control-block platform-settings-field-span-2">
                <span className="control-label">SMTP host</span>
                <input className="control-input" defaultValue={initialValues.smtpHost} name="smtpHost" type="text" />
              </label>

              <label className="control-block">
                <span className="control-label">SMTP port</span>
                <input
                  className="control-input"
                  defaultValue={String(initialValues.smtpPort)}
                  name="smtpPort"
                  type="number"
                />
              </label>

              <label className="auth-checkbox platform-settings-checkbox-card">
                <input defaultChecked={initialValues.smtpSecure} name="smtpSecure" type="checkbox" />
                <span>Use secure SMTP</span>
              </label>

              <label className="control-block">
                <span className="control-label">SMTP user</span>
                <input className="control-input" defaultValue={initialValues.smtpUser} name="smtpUser" type="text" />
              </label>

              <label className="control-block">
                <span className="control-label">SMTP password</span>
                <input
                  className="control-input"
                  name="smtpPass"
                  placeholder={
                    initialValues.smtpPassConfigured
                      ? "Leave blank to keep current password"
                      : "Enter SMTP password"
                  }
                  type="password"
                />
              </label>

              <label className="control-block">
                <span className="control-label">From address</span>
                <input className="control-input" defaultValue={initialValues.smtpFrom} name="smtpFrom" type="text" />
              </label>

              <label className="control-block">
                <span className="control-label">Support email</span>
                <input
                  className="control-input"
                  defaultValue={initialValues.supportEmail}
                  name="supportEmail"
                  type="text"
                />
              </label>
            </div>
          </section>

          <section className="availability-settings-section platform-settings-section-card">
            <div className="availability-settings-section-head">
              <strong>Branding and Billplz checkout</strong>
              <p className="table-subtle">
                Buyer-facing mail copy and checkout credentials live together because they support the same
                public onboarding flow.
              </p>
            </div>

            <div className="platform-settings-field-grid">
              <label className="control-block">
                <span className="control-label">Brand name</span>
                <input
                  className="control-input"
                  defaultValue={initialValues.emailBrandName}
                  name="emailBrandName"
                  type="text"
                />
              </label>

              <label className="control-block">
                <span className="control-label">Brand tagline</span>
                <input
                  className="control-input"
                  defaultValue={initialValues.emailBrandTagline}
                  name="emailBrandTagline"
                  type="text"
                />
              </label>

              <label className="control-block platform-settings-field-span-2">
                <span className="control-label">Billplz API key</span>
                <input
                  className="control-input"
                  name="billplzApiKey"
                  placeholder={
                    initialValues.billplzApiKeyConfigured
                      ? "Leave blank to keep current API key"
                      : "Enter Billplz API key"
                  }
                  type="password"
                />
              </label>

              <label className="control-block platform-settings-field-span-2">
                <span className="control-label">Billplz X signature key</span>
                <input
                  className="control-input"
                  name="billplzXSignatureKey"
                  placeholder={
                    initialValues.billplzXSignatureKeyConfigured
                      ? "Leave blank to keep current X signature key"
                      : "Recommended for redirect and callback validation"
                  }
                  type="password"
                />
              </label>

              <label className="control-block">
                <span className="control-label">Billplz collection ID</span>
                <input
                  className="control-input"
                  defaultValue={initialValues.billplzCollectionId}
                  name="billplzCollectionId"
                  placeholder="Collection used for package payments"
                  type="text"
                />
              </label>

              <label className="auth-checkbox platform-settings-checkbox-card">
                <input defaultChecked={initialValues.billplzSandbox} name="billplzSandbox" type="checkbox" />
                <span>Use Billplz sandbox endpoint</span>
              </label>
            </div>

            <p className="table-subtle">
              Package checkout will create a Billplz bill and redirect the buyer to Billplz before workspace
              access is granted.
            </p>
          </section>

          <section className="availability-settings-section platform-settings-section-card">
            <div className="availability-settings-section-head">
              <strong>Login session timeout</strong>
              <p className="table-subtle">
                Applies to workspace and platform admin logins. Idle timeout renews from activity. Remember me timeout stays fixed from the original login.
              </p>
            </div>

            <div className="platform-settings-field-grid compact">
              <label className="control-block">
                <span className="control-label">Idle session timeout</span>
                <input
                  className="control-input"
                  min="1"
                  onChange={(event) => setSessionTimeoutValue(event.target.value)}
                  type="number"
                  value={sessionTimeoutValue}
                />
              </label>

              <label className="control-block">
                <span className="control-label">Unit</span>
                <select
                  className="control-input app-select"
                  onChange={(event) => setSessionTimeoutUnit(event.target.value as SessionTimeoutUnit)}
                  value={sessionTimeoutUnit}
                >
                  <option value="minutes">Minutes</option>
                  <option value="hours">Hours</option>
                  <option value="days">Days</option>
                </select>
              </label>

              <label className="control-block">
                <span className="control-label">Remember me timeout</span>
                <input
                  className="control-input"
                  min="1"
                  onChange={(event) => setRememberTimeoutValue(event.target.value)}
                  type="number"
                  value={rememberTimeoutValue}
                />
              </label>

              <label className="control-block">
                <span className="control-label">Unit</span>
                <select
                  className="control-input app-select"
                  onChange={(event) => setRememberTimeoutUnit(event.target.value as SessionTimeoutUnit)}
                  value={rememberTimeoutUnit}
                >
                  <option value="minutes">Minutes</option>
                  <option value="hours">Hours</option>
                  <option value="days">Days</option>
                </select>
              </label>

              <div className="platform-settings-timeout-hint">
                <strong>Session behavior</strong>
                <p>
                  Idle session timeout: users are logged out after this period of inactivity.
                </p>
                <p>
                  Remember me timeout: remembered devices can restore login until this period expires.
                </p>
              </div>
            </div>
          </section>

          <section className="availability-settings-section platform-settings-section-card">
            <div className="availability-settings-section-head">
              <strong>Subscription lifecycle</strong>
              <p className="table-subtle">
                New trials use the current duration. Existing subscriptions keep their original dates.
              </p>
            </div>

            <div className="platform-settings-field-grid compact">
              <label className="control-block">
                <span className="control-label">Free Trial Duration (Days)</span>
                <input
                  className="control-input"
                  defaultValue={String(initialValues.freeTrialDurationDays)}
                  min="1"
                  name="freeTrialDurationDays"
                  type="number"
                />
              </label>

              <label className="control-block">
                <span className="control-label">Auto Cleanup Expired Accounts After (Days)</span>
                <input
                  className="control-input"
                  defaultValue={String(initialValues.expiredAccountCleanupDays)}
                  min="1"
                  name="expiredAccountCleanupDays"
                  type="number"
                />
              </label>
            </div>
          </section>

          <section className="availability-settings-section platform-settings-section-card">
            <div className="availability-settings-section-head">
              <strong>Automation workflow inactivity</strong>
              <p className="table-subtle">
                Set the global safety net for workflows waiting on customer replies when a step does not define its own timeout.
              </p>
            </div>

            <div className="platform-settings-field-grid compact">
              <label className="control-block">
                <span className="control-label">Idle after hours</span>
                <input
                  className="control-input"
                  defaultValue={String(initialValues.automationWorkflowIdleHours)}
                  min="1"
                  name="automationWorkflowIdleHours"
                  type="number"
                />
              </label>

              <label className="control-block">
                <span className="control-label">Expire after hours</span>
                <input
                  className="control-input"
                  defaultValue={String(initialValues.automationWorkflowExpireHours)}
                  min="2"
                  name="automationWorkflowExpireHours"
                  type="number"
                />
              </label>

              <div className="platform-settings-timeout-hint">
                <strong>Default behavior</strong>
                <p>
                  Use idle time to soften the UI state first, then expire later so old waiting workflows clear automatically and new inbound messages can start fresh automation again.
                </p>
              </div>
            </div>
          </section>
        </div>

        <div className="platform-settings-actions">
          <div className="platform-settings-feedback">
            {message ? <p className="table-subtle">{message}</p> : null}
            {error ? <p className="form-error">{error}</p> : null}
          </div>

          <div className="panel-row">
            <button className="button button-primary" disabled={pending} type="submit">
              {pending ? "Saving..." : "Save platform settings"}
            </button>

            <button className="button button-secondary" disabled={testPending} onClick={handleTestEmail} type="button">
              {testPending ? "Sending..." : "Send test email"}
            </button>

            <button
              className="button button-secondary"
              disabled={billplzTestPending}
              onClick={handleTestBillplz}
              type="button"
            >
              {billplzTestPending ? "Testing..." : "Test Billplz connection"}
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}

function formatSessionTimeoutSummary(value: { value: number; unit: SessionTimeoutUnit }) {
  const suffix = value.unit === "days" ? "d" : value.unit === "hours" ? "h" : "m";
  return `${value.value}${suffix}`;
}
