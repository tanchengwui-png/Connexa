"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

type AuthenticationNotice = {
  channelId: string;
  kind: "authenticating" | "error";
  lastError: string | null;
  updatedAt: string;
  workspaceId: string;
};

type WhatsAppConnectionEvent = {
  channelId?: string;
  connectionStatus?: string;
  lastError?: string | null;
  updatedAt?: string;
  workspaceId?: string;
};

const CONNECTED_STATUSES = new Set(["CONNECTED", "READY", "SYNCING_HISTORY"]);
const FAILED_STATUSES = new Set(["AUTH_FAILED", "ERROR", "REAUTH_REQUIRED"]);
const NOTICE_MAX_AGE_MS = 15 * 60 * 1000;

export function WhatsAppAuthenticationNotice({ workspaceId }: { workspaceId: string }) {
  const storageKey = `connexa:whatsapp-authentication:${workspaceId}`;
  const noticeRef = useRef<AuthenticationNotice | null>(null);
  const [notice, setNotice] = useState<AuthenticationNotice | null>(null);

  const applyNotice = useCallback((next: AuthenticationNotice | null) => {
    noticeRef.current = next;
    setNotice(next);
    try {
      if (next) {
        window.sessionStorage.setItem(storageKey, JSON.stringify(next));
      } else {
        window.sessionStorage.removeItem(storageKey);
      }
    } catch {
      // The realtime stream still works when browser storage is unavailable.
    }
  }, [storageKey]);

  useEffect(() => {
    noticeRef.current = null;
    setNotice(null);
    try {
      const raw = window.sessionStorage.getItem(storageKey);
      if (!raw) return;
      const saved = JSON.parse(raw) as AuthenticationNotice;
      const savedAt = new Date(saved.updatedAt).getTime();
      if (
        saved.workspaceId === workspaceId &&
        saved.channelId &&
        (saved.kind === "authenticating" || saved.kind === "error") &&
        Number.isFinite(savedAt) &&
        Date.now() - savedAt <= NOTICE_MAX_AGE_MS
      ) {
        noticeRef.current = saved;
        setNotice(saved);
      } else {
        window.sessionStorage.removeItem(storageKey);
      }
    } catch {}
  }, [storageKey, workspaceId]);

  const trackedChannelId = notice?.channelId ?? null;

  useEffect(() => {
    const query = trackedChannelId ? `?channelId=${encodeURIComponent(trackedChannelId)}` : "";
    const eventSource = new EventSource(`/api/inbox/events${query}`);

    const handleConnection = (message: MessageEvent<string>) => {
      let event: WhatsAppConnectionEvent;
      try {
        event = JSON.parse(message.data) as WhatsAppConnectionEvent;
      } catch {
        return;
      }

      if (
        event.workspaceId !== workspaceId ||
        !event.channelId ||
        !event.connectionStatus ||
        !event.updatedAt
      ) {
        return;
      }

      const current = noticeRef.current;
      if (current?.channelId === event.channelId) {
        const currentVersion = new Date(current.updatedAt).getTime();
        const eventVersion = new Date(event.updatedAt).getTime();
        if (Number.isFinite(currentVersion) && Number.isFinite(eventVersion) && eventVersion < currentVersion) {
          return;
        }
      }

      if (event.connectionStatus === "AUTHENTICATED") {
        applyNotice({
          channelId: event.channelId,
          kind: "authenticating",
          lastError: null,
          updatedAt: event.updatedAt,
          workspaceId
        });
        return;
      }

      if (CONNECTED_STATUSES.has(event.connectionStatus)) {
        if (current?.channelId === event.channelId) {
          applyNotice(null);
        }
        return;
      }

      if (FAILED_STATUSES.has(event.connectionStatus) && current?.channelId === event.channelId) {
        applyNotice({
          channelId: event.channelId,
          kind: "error",
          lastError: event.lastError?.trim() || "WhatsApp could not complete authentication. Please try scanning again.",
          updatedAt: event.updatedAt,
          workspaceId
        });
      }
    };

    eventSource.addEventListener("whatsapp:connection", handleConnection as EventListener);
    return () => {
      eventSource.removeEventListener("whatsapp:connection", handleConnection as EventListener);
      eventSource.close();
    };
  }, [applyNotice, trackedChannelId, workspaceId]);

  if (!notice) return null;

  if (notice.kind === "error") {
    return (
      <aside aria-live="assertive" className="whatsapp-auth-notice whatsapp-auth-notice-error" role="alert">
        <span aria-hidden="true" className="whatsapp-auth-notice-icon">!</span>
        <div className="whatsapp-auth-notice-copy">
          <strong>WhatsApp authentication needs attention</strong>
          <span>{notice.lastError}</span>
        </div>
        <Link className="whatsapp-auth-notice-action" href={`/settings/whatsapp?channelId=${encodeURIComponent(notice.channelId)}`}>
          Manage connection
        </Link>
        <button
          aria-label="Dismiss WhatsApp authentication message"
          className="whatsapp-auth-notice-dismiss"
          onClick={() => applyNotice(null)}
          type="button"
        >
          ×
        </button>
      </aside>
    );
  }

  return (
    <aside aria-live="polite" className="whatsapp-auth-notice" role="status">
      <span aria-hidden="true" className="whatsapp-auth-notice-spinner" />
      <div className="whatsapp-auth-notice-copy">
        <strong>QR accepted. WhatsApp is authenticating…</strong>
        <span>You can continue using Connexa. Login will finish in the background.</span>
      </div>
    </aside>
  );
}
