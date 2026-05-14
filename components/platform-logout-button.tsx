"use client";

export function PlatformLogoutButton() {
  async function handleLogout() {
    await fetch("/api/platform/auth/logout", {
      method: "POST"
    });

    window.location.href = "/platform/login";
  }

  return (
    <button className="button button-secondary" onClick={handleLogout} type="button">
      Log out
    </button>
  );
}
