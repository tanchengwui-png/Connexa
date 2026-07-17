"use client";

import { FormEvent, useState } from "react";

type PlatformMetaSettingsFormProps = {
  initialValues: {
    metaAppId: string;
    metaConfigId: string;
    metaGraphVersion: string;
    metaRedirectUri: string;
    metaAppSecretConfigured: boolean;
    metaWebhookVerifyTokenConfigured: boolean;
    metaEmbeddedSignupConfigured: boolean;
  };
};

export function PlatformMetaSettingsForm({ initialValues }: PlatformMetaSettingsFormProps) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    setError(null);

    const formData = new FormData(event.currentTarget);
    const response = await fetch("/api/platform/meta-settings", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        metaAppId: String(formData.get("metaAppId") ?? ""),
        metaAppSecret: String(formData.get("metaAppSecret") ?? ""),
        metaConfigId: String(formData.get("metaConfigId") ?? ""),
        metaGraphVersion: String(formData.get("metaGraphVersion") ?? "v23.0"),
        metaRedirectUri: String(formData.get("metaRedirectUri") ?? ""),
        metaWebhookVerifyToken: String(formData.get("metaWebhookVerifyToken") ?? "")
      })
    });

    const data = (await response.json().catch(() => null)) as { error?: string } | null;

    if (!response.ok) {
      setError(data?.error ?? "Unable to save Meta settings.");
      setPending(false);
      return;
    }

    setMessage("Meta Embedded Signup settings saved.");
    setPending(false);
  }

  return (
    <section className="content-card settings-dark-panel platform-settings-form-panel">
      <div className="card-header settings-dark-panel-head">
        <div className="platform-settings-header-copy">
          <span className="platform-settings-header-eyebrow">
            {initialValues.metaEmbeddedSignupConfigured ? "Meta ready" : "Meta needs attention"}
          </span>
          <h3 className="card-title">Meta WhatsApp Embedded Signup</h3>
          <p className="muted">
            Save the Facebook app, config, redirect, and webhook values here if you want to manage them in Connexa.
            If the same values are already set in server environment variables, this screen is optional.
          </p>
        </div>
      </div>

      <form className="availability-settings-form platform-settings-workspace" onSubmit={handleSubmit}>
        <div className="platform-settings-status-strip">
          <article className="platform-settings-status-pill">
            <span>App ID</span>
            <strong>{initialValues.metaAppId ? "Configured" : "Missing"}</strong>
            <p>Used by the browser SDK initialization.</p>
          </article>

          <article className="platform-settings-status-pill">
            <span>App secret</span>
            <strong>{initialValues.metaAppSecretConfigured ? "Configured" : "Missing"}</strong>
            <p>Server-side OAuth code exchange only.</p>
          </article>

          <article className="platform-settings-status-pill">
            <span>Webhook token</span>
            <strong>{initialValues.metaWebhookVerifyTokenConfigured ? "Configured" : "Missing"}</strong>
            <p>Used for Meta webhook verification fallback.</p>
          </article>
        </div>

        <div className="platform-settings-columns full-width">
          <section className="availability-settings-section">
            <div className="availability-settings-section-head">
              <strong>Embedded Signup credentials</strong>
              <p className="table-subtle">
                These values drive the Connect with Facebook button shown on the WhatsApp Cloud API setup screen when
                you are not supplying them through server environment variables.
              </p>
            </div>

            <div className="platform-settings-field-grid compact">
              <label className="control-block">
                <span className="control-label">Meta app ID</span>
                <input className="control-input" defaultValue={initialValues.metaAppId} name="metaAppId" type="text" />
              </label>

              <label className="control-block">
                <span className="control-label">Meta config ID</span>
                <input
                  className="control-input"
                  defaultValue={initialValues.metaConfigId}
                  name="metaConfigId"
                  type="text"
                />
              </label>

              <label className="control-block">
                <span className="control-label">Graph version</span>
                <input
                  className="control-input"
                  defaultValue={initialValues.metaGraphVersion}
                  name="metaGraphVersion"
                  placeholder="v23.0"
                  type="text"
                />
              </label>

              <label className="control-block platform-settings-field-span-2">
                <span className="control-label">Redirect URI</span>
                <input
                  className="control-input"
                  defaultValue={initialValues.metaRedirectUri}
                  name="metaRedirectUri"
                  placeholder="https://connexa-stg.recurvos.com/settings/whatsapp"
                  type="text"
                />
              </label>

              <label className="control-block platform-settings-field-span-2">
                <span className="control-label">Meta app secret</span>
                <input
                  className="control-input"
                  name="metaAppSecret"
                  placeholder={
                    initialValues.metaAppSecretConfigured
                      ? "Leave blank to keep current app secret"
                      : "Enter Meta app secret"
                  }
                  type="password"
                />
              </label>

              <label className="control-block platform-settings-field-span-2">
                <span className="control-label">Meta webhook verify token</span>
                <input
                  className="control-input"
                  name="metaWebhookVerifyToken"
                  placeholder={
                    initialValues.metaWebhookVerifyTokenConfigured
                      ? "Leave blank to keep current webhook verify token"
                      : "Enter Meta webhook verify token"
                  }
                  type="password"
                />
              </label>
            </div>

            <p className="table-subtle">
              Secrets stay server-side only. Workspace users will never receive the app secret or webhook token in
              API responses.
            </p>
          </section>
        </div>

        <div className="platform-settings-actions">
          <div className="platform-settings-feedback">
            {message ? <p className="table-subtle">{message}</p> : null}
            {error ? <p className="form-error">{error}</p> : null}
          </div>

          <div className="panel-row">
            <button className="button button-primary" disabled={pending} type="submit">
              {pending ? "Saving..." : "Save Meta settings"}
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}
