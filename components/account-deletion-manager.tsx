"use client";

import { useState } from "react";

export function AccountDeletionManager() {
  const [action, setAction] = useState<"delete_all_data" | "delete_account" | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const label = action === "delete_all_data" ? "Delete all data?" : "Delete your account?";

  async function confirm() {
    if (!action) return;
    setPending(true); setError(null);
    const response = await fetch(action === "delete_all_data" ? "/api/account/delete-data" : "/api/account/delete", { method: "POST" });
    const data = (await response.json()) as { error?: string; request?: { status?: string } };
    setPending(false);
    if (!response.ok) { setError(data.error ?? "Unable to confirm the deletion request."); return; }
    if (data.request?.status !== "completed") { setError("The deletion is still being processed. Please refresh before trying again."); return; }
    setMessage(action === "delete_all_data" ? "Your workspace data was deleted and linked WhatsApp sessions were disconnected." : "Your account deletion request has been completed.");
    setAction(null);
  }

  return <section className="content-card settings-dark-panel subscriber-settings-card subscriber-deletion-section">
    <div className="card-header settings-dark-panel-head"><div><h2 className="card-title">Data and Account Deletion</h2><p className="muted">These permanent actions require final confirmation.</p></div></div>
    {message ? <p className="form-success" role="status">{message}</p> : null}
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    <div className="subscriber-deletion-options"><div><h3>Delete All Data</h3><p>Permanently delete the data associated with your account while keeping the account available.</p><button className="button button-secondary" onClick={() => setAction("delete_all_data")} type="button">Delete All Data</button></div><div><h3>Delete Account</h3><p>Permanently delete your account and handle associated data according to the account-deletion policy.</p><button className="button button-danger" onClick={() => setAction("delete_account")} type="button">Delete Account</button></div></div>
    {action ? <div className="payment-confirmation-overlay" role="presentation"><section aria-labelledby="data-deletion-dialog-title" aria-modal="true" className="payment-confirmation-dialog" role="dialog"><div className="payment-confirmation-header"><h2 id="data-deletion-dialog-title">{label}</h2><button aria-label="Close deletion confirmation" className="payment-confirmation-close" disabled={pending} onClick={() => setAction(null)} type="button">×</button></div><p className="payment-confirmation-description">{action === "delete_all_data" ? "This permanently deletes operational workspace data and disconnects every linked WhatsApp session. You will need to link WhatsApp again before messaging can resume. Your account remains available, while records required for billing, legal, security, and compliance reasons may be retained." : "This permanently deletes your account, disconnects every linked WhatsApp session, and removes access. Associated data is deleted or retained according to the applicable retention policy. This cannot be undone."}</p><div className="payment-confirmation-actions"><button className="button button-secondary" disabled={pending} onClick={() => setAction(null)} type="button">Cancel</button><button className="button button-primary" disabled={pending} onClick={() => void confirm()} type="button">{pending ? "Confirming..." : action === "delete_all_data" ? "Confirm Data Deletion" : "Confirm Account Deletion"}</button></div></section></div> : null}
  </section>;
}
