"use client";

import React from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { INBOX_LAYERS } from "@/components/inbox/layers";

type ConfirmationOptions = {
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
};

type ConfirmationContextValue = {
  confirm: (options: ConfirmationOptions) => Promise<boolean>;
};

const ConfirmationContext = createContext<ConfirmationContextValue | null>(null);

export function ConfirmationProvider({ children }: { children: React.ReactNode }) {
  const [dialog, setDialog] = useState<(ConfirmationOptions & { isOpen: boolean }) | null>(null);
  const resolverRef = useRef<((value: boolean) => void) | null>(null);

  const close = useCallback((value: boolean) => {
    resolverRef.current?.(value);
    resolverRef.current = null;
    setDialog(null);
  }, []);

  const confirm = useCallback((options: ConfirmationOptions) => {
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
      setDialog({
        isOpen: true,
        ...options
      });
    });
  }, []);

  const contextValue = useMemo(() => ({ confirm }), [confirm]);

  useEffect(() => {
    if (!dialog) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [close, dialog]);

  return (
    <ConfirmationContext.Provider value={contextValue}>
      {children}
      {dialog && typeof document !== "undefined"
        ? createPortal(
            <div className="inbox-dialog-backdrop" onClick={() => close(false)} style={{ zIndex: INBOX_LAYERS.modal }}>
              <div
                aria-modal="true"
                className="inbox-dialog confirmation-dialog"
                onClick={(event) => event.stopPropagation()}
                role="dialog"
                style={{ zIndex: INBOX_LAYERS.modal + 1 }}
              >
                <div className="inbox-dialog-head">
                  <div>
                    <strong>{dialog.title}</strong>
                    <p>{dialog.description}</p>
                  </div>
                </div>
                <div className="inbox-dialog-actions">
                  <div className="inbox-dialog-actions-right">
                    <button className="inbox-dialog-secondary" onClick={() => close(false)} type="button">
                      {dialog.cancelLabel ?? "Cancel"}
                    </button>
                    <button
                      className={dialog.tone === "danger" ? "confirmation-dialog-danger" : "inbox-dialog-primary"}
                      onClick={() => close(true)}
                      type="button"
                    >
                      {dialog.confirmLabel ?? "Confirm"}
                    </button>
                  </div>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </ConfirmationContext.Provider>
  );
}

export function useConfirmation() {
  const context = useContext(ConfirmationContext);

  if (!context) {
    throw new Error("useConfirmation must be used inside ConfirmationProvider.");
  }

  return context;
}
