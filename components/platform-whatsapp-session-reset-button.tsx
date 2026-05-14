"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useConfirmation } from "@/components/confirmation-provider";
import { useToast } from "@/components/toast-provider";

type PlatformWhatsAppSessionResetButtonProps = {
  workspaceId: string;
  workspaceName: string;
  disabled?: boolean;
};

export function PlatformWhatsAppSessionResetButton({
  workspaceId,
  workspaceName,
  disabled = false
}: PlatformWhatsAppSessionResetButtonProps) {
  const router = useRouter();
  const { confirm } = useConfirmation();
  const toast = useToast();
  const [pending, setPending] = useState(false);

  async function handleReset() {
    const approved = await confirm({
      title: "Reset WhatsApp session?",
      description: `This removes the saved WhatsApp Web session for ${workspaceName} and forces a fresh QR login.`,
      confirmLabel: "Reset session",
      cancelLabel: "Keep session",
      tone: "danger"
    });

    if (!approved) {
      return;
    }

    setPending(true);

    try {
      const response = await fetch("/api/platform/whatsapp/reset", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ workspaceId })
      });
      const data = (await response.json().catch(() => null)) as {
        error?: string;
        ok?: boolean;
        workspaceName?: string;
      } | null;

      if (!response.ok) {
        throw new Error(data?.error ?? "Unable to reset the WhatsApp session.");
      }

      const successMessage = `${data?.workspaceName ?? workspaceName} must reconnect by scanning a fresh QR code.`;
      toast.success("WhatsApp session reset", successMessage);
      router.refresh();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to reset the WhatsApp session.";
      toast.error("WhatsApp reset failed", message);
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      className="button button-secondary"
      disabled={disabled || pending}
      onClick={handleReset}
      type="button"
    >
      {pending ? "Resetting..." : "Reset session"}
    </button>
  );
}
