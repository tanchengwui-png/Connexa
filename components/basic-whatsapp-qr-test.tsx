"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { BasicWhatsAppQrStatus } from "@/lib/basic-whatsapp-qr-test";

const EMPTY_STATUS: BasicWhatsAppQrStatus = {
  state: "idle",
  message: "Starting the basic QR test…",
  qrCodeDataUrl: null,
  startedAt: null,
  qrAt: null,
  qrDisappearedAt: null,
  scanDetectedAt: null,
  authenticatedAt: null,
  connectedAt: null,
  readyAt: null,
  socketState: null,
  hasSynced: null,
  whatsappWebVersion: null,
  chromiumVersion: null,
  browserUserAgent: null,
  timeline: [],
  diagnostics: [],
  updatedAt: new Date(0).toISOString(),
  error: null
};

export function BasicWhatsAppQrTest({ initialStatus = EMPTY_STATUS }: { initialStatus?: BasicWhatsAppQrStatus }) {
  const [status, setStatus] = useState(initialStatus);
  const [requestPending, setRequestPending] = useState(false);
  const isResetting = requestPending || status.state === "resetting";
  const pollingIntervalMs = status.state === "ready"
    ? 5_000
    : ["failed", "disconnected", "ended"].includes(status.state)
      ? null
      : 1_000;

  const refreshStatus = useCallback(async () => {
    const response = await fetch("/api/test/whatsapp-basic", { cache: "no-store" }).catch(() => null);
    if (!response?.ok) return;
    const payload = (await response.json()) as { status: BasicWhatsAppQrStatus };
    setStatus(payload.status);
  }, []);

  const start = useCallback(async (reset: boolean) => {
    setRequestPending(true);
    setStatus((current) => ({
      ...current,
      state: "resetting",
      qrCodeDataUrl: null,
      message: reset ? "Ending the previous test session…" : "Starting one basic Chromium client…",
      error: null
    }));
    try {
      await fetch("/api/test/whatsapp-basic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reset })
      });
      await refreshStatus();
    } finally {
      setRequestPending(false);
    }
  }, [refreshStatus]);

  useEffect(() => {
    if (pollingIntervalMs === null) return;
    const timer = window.setInterval(() => void refreshStatus(), pollingIntervalMs);
    return () => window.clearInterval(timer);
  }, [pollingIntervalMs, refreshStatus]);

  const timings = useMemo(() => {
    const started = status.startedAt ? new Date(status.startedAt).getTime() : null;
    const qr = status.qrAt ? new Date(status.qrAt).getTime() : null;
    const qrDisappeared = status.qrDisappearedAt ? new Date(status.qrDisappearedAt).getTime() : null;
    const scanDetected = status.scanDetectedAt ? new Date(status.scanDetectedAt).getTime() : null;
    const authenticated = status.authenticatedAt ? new Date(status.authenticatedAt).getTime() : null;
    const connected = status.connectedAt ? new Date(status.connectedAt).getTime() : null;
    const ready = status.readyAt ? new Date(status.readyAt).getTime() : null;
    return {
      startToQr: started && qr ? `${((qr - started) / 1000).toFixed(2)}s` : "—",
      qrToDisappear: qr && qrDisappeared ? `${((qrDisappeared - qr) / 1000).toFixed(2)}s` : "—",
      scanToAuthenticated: scanDetected && authenticated ? `${((authenticated - scanDetected) / 1000).toFixed(2)}s` : "—",
      scanToConnected: scanDetected && connected ? `${((connected - scanDetected) / 1000).toFixed(2)}s` : "—",
      authenticatedToReady: authenticated && ready ? `${((ready - authenticated) / 1000).toFixed(2)}s` : "—"
    };
  }, [status]);

  async function endTest() {
    setRequestPending(true);
    try {
      const response = await fetch("/api/test/whatsapp-basic", { method: "DELETE" });
      const payload = (await response.json()) as { status: BasicWhatsAppQrStatus };
      setStatus(payload.status);
    } finally {
      setRequestPending(false);
    }
  }

  return (
    <main className="basic-wa-test-page">
      <section className="basic-wa-test-card">
        <header className="basic-wa-test-header">
          <div>
            <span>Isolated test</span>
            <h1>Basic WhatsApp QR Login</h1>
            <p>One client, one Chromium process, one QR. No channel, sender API, database sync, or chat import.</p>
          </div>
          <Link href="/settings/whatsapp">Back to WhatsApp settings</Link>
        </header>

        <div className="basic-wa-test-layout">
          <div className="basic-wa-test-qr">
            {status.qrCodeDataUrl ? (
              <img alt="Basic WhatsApp test QR code" src={status.qrCodeDataUrl} />
            ) : (
              <div className={`basic-wa-test-placeholder state-${status.state}`}>
                <span aria-hidden="true">{status.state === "ready" ? "✓" : status.state === "failed" ? "!" : "…"}</span>
                <strong>{status.message}</strong>
              </div>
            )}
          </div>

          <div className="basic-wa-test-status" aria-live="polite">
            <span className={`basic-wa-test-state state-${status.state}`}>{status.state}</span>
            <h2>{status.message}</h2>
            {status.error ? <p className="basic-wa-test-error">{status.error}</p> : null}
            <ol>
              <li>Open WhatsApp on the phone.</li>
              <li>Open Linked Devices.</li>
              <li>Scan this QR code.</li>
              <li>Watch this panel change immediately to “authenticating”.</li>
            </ol>
            <dl className="basic-wa-test-runtime">
              <div><dt>Socket</dt><dd>{status.socketState ?? "waiting"}</dd></div>
              <div><dt>Synced</dt><dd>{status.hasSynced === null ? "waiting" : status.hasSynced ? "yes" : "no"}</dd></div>
              <div><dt>WhatsApp Web</dt><dd>{status.whatsappWebVersion ?? "waiting"}</dd></div>
              <div><dt>Chromium</dt><dd>{status.chromiumVersion ?? "waiting"}</dd></div>
            </dl>
            <div className="basic-wa-test-actions">
              <button disabled={isResetting} onClick={() => void start(true)} type="button">
                {isResetting ? "Working…" : "New QR — end old test session"}
              </button>
              <button className="danger" disabled={isResetting} onClick={() => void endTest()} type="button">
                End test session
              </button>
            </div>
          </div>
        </div>

        <dl className="basic-wa-test-timings">
          <div><dt>Start → QR</dt><dd>{timings.startToQr}</dd></div>
          <div><dt>QR → disappears</dt><dd>{timings.qrToDisappear}</dd></div>
          <div><dt>Scan → authenticated</dt><dd>{timings.scanToAuthenticated}</dd></div>
          <div><dt>Scan → connected</dt><dd>{timings.scanToConnected}</dd></div>
          <div><dt>Authenticated → ready</dt><dd>{timings.authenticatedToReady}</dd></div>
        </dl>

        <section className="basic-wa-test-evidence">
          <div>
            <h2>Handshake timeline</h2>
            {status.timeline.length ? (
              <ol>
                {status.timeline.slice(-20).map((item, index) => (
                  <li key={`${item.at}-${item.event}-${index}`}>
                    <time>{new Date(item.at).toLocaleTimeString()}</time>
                    <strong>{item.event.replaceAll("_", " ")}</strong>
                    {item.detail ? <span>{item.detail}</span> : null}
                  </li>
                ))}
              </ol>
            ) : <p>No handshake events captured yet.</p>}
          </div>
          <div>
            <h2>Browser diagnostics</h2>
            {status.diagnostics.length ? (
              <ol>
                {status.diagnostics.slice(-12).map((item, index) => (
                  <li key={`${item.at}-${item.kind}-${index}`}>
                    <time>{new Date(item.at).toLocaleTimeString()}</time>
                    <strong>{item.kind.replaceAll("_", " ")}</strong>
                    <span>{item.detail}</span>
                  </li>
                ))}
              </ol>
            ) : <p>No console, request, or WebSocket failures captured.</p>}
          </div>
          <details>
            <summary>Browser user agent</summary>
            <code>{status.browserUserAgent ?? "waiting"}</code>
          </details>
        </section>
      </section>
    </main>
  );
}
