"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { disableInboxBrowserPushSubscription } from "@/lib/inbox-browser-notifications-client";

export function LogoutButton({ className = "" }: { className?: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleLogout() {
    setPending(true);

    await disableInboxBrowserPushSubscription().catch(() => false);
    await fetch("/api/auth/logout", {
      method: "POST"
    });

    router.push("/login");
    router.refresh();
  }

  return (
    <button className={`button button-secondary ${className}`.trim()} disabled={pending} onClick={handleLogout} type="button">
      {pending ? "Signing out..." : "Log out"}
    </button>
  );
}
