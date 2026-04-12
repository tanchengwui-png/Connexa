"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { INBOX_LAYERS } from "@/components/inbox/layers";

type ToastTone = "success" | "error";

type ToastOptions = {
  title: string;
  description?: string;
  tone?: ToastTone;
  durationMs?: number;
};

type ToastItem = ToastOptions & {
  id: string;
};

type ToastContextValue = {
  showToast: (options: ToastOptions) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [isMounted, setIsMounted] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timeoutIds = useRef<Record<string, number>>({});

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));

    const timeoutId = timeoutIds.current[id];
    if (timeoutId) {
      window.clearTimeout(timeoutId);
      delete timeoutIds.current[id];
    }
  }, []);

  const showToast = useCallback(
    ({ durationMs = 3200, tone = "success", ...options }: ToastOptions) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      setToasts((current) => [...current, { id, tone, durationMs, ...options }]);
      timeoutIds.current[id] = window.setTimeout(() => dismissToast(id), durationMs);
    },
    [dismissToast]
  );

  useEffect(() => {
    return () => {
      Object.values(timeoutIds.current).forEach((timeoutId) => window.clearTimeout(timeoutId));
      timeoutIds.current = {};
    };
  }, []);

  const contextValue = useMemo(
    () => ({
      showToast,
      success: (title: string, description?: string) => showToast({ title, description, tone: "success" }),
      error: (title: string, description?: string) => showToast({ title, description, tone: "error" })
    }),
    [showToast]
  );

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      {isMounted
        ? createPortal(
            <div className="app-toast-stack" style={{ zIndex: INBOX_LAYERS.modal + 10 }}>
              {toasts.map((toast) => (
                <div className={`app-toast app-toast-${toast.tone}`} key={toast.id} role="status">
                  <div className="app-toast-copy">
                    <strong>{toast.title}</strong>
                    {toast.description ? <p>{toast.description}</p> : null}
                  </div>
                  <button
                    aria-label="Dismiss notification"
                    className="app-toast-dismiss"
                    onClick={() => dismissToast(toast.id)}
                    type="button"
                  >
                    x
                  </button>
                </div>
              ))}
            </div>,
            document.body
          )
        : null}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);

  if (!context) {
    throw new Error("useToast must be used inside ToastProvider.");
  }

  return context;
}
