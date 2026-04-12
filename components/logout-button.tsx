"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function LogoutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleLogout() {
    setPending(true);

    await fetch("/api/auth/logout", {
      method: "POST"
    });

    router.push("/login");
    router.refresh();
  }

  return (
    <button className="button button-secondary" disabled={pending} onClick={handleLogout} type="button">
      {pending ? "Signing out..." : "Log out"}
    </button>
  );
}
