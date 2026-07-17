"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";
import { disableInboxBrowserPushSubscription } from "@/lib/inbox-browser-notifications-client";

type WorkspaceMembership = {
  agentId: string;
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
  role: string;
  isCurrent: boolean;
};

type DashboardTopbarControlsProps = {
  memberships: WorkspaceMembership[];
  planStatus: {
    tone: "active" | "expired";
    text: string;
  } | null;
  roleLabel: string;
  userName: string;
  workspaceName: string;
};

export function DashboardTopbarControls({
  memberships,
  planStatus,
  roleLabel,
  userName,
  workspaceName
}: DashboardTopbarControlsProps) {
  const router = useRouter();
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);

  useEffect(() => {
    if (!isMenuOpen) {
      return undefined;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isMenuOpen]);

  const handleSignOut = async () => {
    setIsSigningOut(true);

    await disableInboxBrowserPushSubscription().catch(() => false);
    await fetch("/api/auth/logout", {
      method: "POST"
    });

    router.push("/login");
    router.refresh();
  };

  return (
    <div className={`dashboard-topbar-profile${isMenuOpen ? " open" : ""}`} ref={menuRef}>
      <button
        aria-expanded={isMenuOpen}
        aria-haspopup="menu"
        className="dashboard-topbar-profile-trigger"
        onClick={() => setIsMenuOpen((current) => !current)}
        type="button"
      >
        <span aria-hidden="true" className="dashboard-topbar-avatar">
          {userName.slice(0, 1).toUpperCase()}
        </span>
        <span className="dashboard-topbar-usercard">
          <strong>{userName}</strong>
          <span className="dashboard-topbar-user-subtle">{roleLabel}</span>
        </span>
        <ChevronDownGlyph />
      </button>

      {isMenuOpen ? (
        <div aria-label="User menu" className="dashboard-topbar-profile-menu" role="menu">
          <div className="dashboard-topbar-profile-meta">
            <strong>{userName}</strong>
            <span>{workspaceName}</span>
            <span>{roleLabel}</span>
          </div>

          <div className="dashboard-topbar-workspace-section">
            <div className="dashboard-topbar-workspace-head">
              <strong>Workspace</strong>
              <span>Switch active workspace</span>
            </div>
            <WorkspaceSwitcher memberships={memberships} variant="menu" />
          </div>

          {planStatus ? (
            <div className={`dashboard-topbar-plan-status dashboard-topbar-menu-plan-status is-${planStatus.tone}`}>
              {planStatus.text}
            </div>
          ) : null}

          <a className="dashboard-topbar-menu-link" href="/account-settings" role="menuitem">
            <UserGlyph />
            <span>Account</span>
          </a>
          <a className="dashboard-topbar-menu-link" href="/packages" role="menuitem">
            <PackageGlyph />
            <span>Plan</span>
          </a>
          <a className="dashboard-topbar-menu-link" href="/account-settings/billing" role="menuitem">
            <BillingGlyph />
            <span>Billing &amp; Subscription</span>
          </a>
          <button
            className="button button-secondary dashboard-topbar-menu-logout"
            disabled={isSigningOut}
            onClick={() => void handleSignOut()}
            role="menuitem"
            type="button"
          >
            <LogoutGlyph />
            <span>{isSigningOut ? "Signing out..." : "Sign Out"}</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ChevronDownGlyph() {
  return (
    <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="16">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function UserGlyph() {
  return (
    <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="16">
      <path d="M20 21a8 8 0 0 0-16 0" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function PackageGlyph() {
  return (
    <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="16">
      <path d="m7.5 4.27 9 5.15" />
      <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <path d="m3.3 7 8.7 5 8.7-5" />
      <path d="M12 22V12" />
    </svg>
  );
}

function BillingGlyph() {
  return (
    <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="16">
      <rect height="14" rx="2" width="20" x="2" y="5" />
      <path d="M2 10h20" />
      <path d="M7 15h1" />
      <path d="M11 15h2" />
    </svg>
  );
}

function LogoutGlyph() {
  return (
    <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="16">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  );
}
