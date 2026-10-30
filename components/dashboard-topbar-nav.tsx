"use client";

import { useEffect, useRef, useState } from "react";

type NavLinkItem = {
  type: "link";
  label: string;
  href: string;
  icon?: DashboardNavIconName;
};

type NavGroupItem = {
  type: "group";
  label: string;
  icon?: DashboardNavIconName;
  items: ReadonlyArray<{
    label: string;
    href: string;
  }>;
};

type TopbarNavItem = NavLinkItem | NavGroupItem;
type DashboardNavIconName = "home" | "inbox" | "contacts" | "automation" | "campaigns" | "analytics" | "settings";

export function DashboardTopbarNav({
  currentPath,
  items
}: {
  currentPath: string;
  items: ReadonlyArray<TopbarNavItem>;
}) {
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const navRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!navRef.current?.contains(event.target as Node)) {
        setOpenGroup(null);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenGroup(null);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return (
    <div className="dashboard-topbar-nav" ref={navRef}>
      {items.map((item) =>
        item.type === "link" ? (
          <a
            className={`dashboard-topbar-link${isLinkActive(currentPath, item.href) ? " active" : ""}`}
            href={item.href}
            key={item.href}
          >
            {item.icon ? <DashboardNavIcon name={item.icon} /> : null}
            {item.label}
          </a>
        ) : (
          <div
            className={`dashboard-topbar-dropdown${isGroupActive(currentPath, item.items) ? " active" : ""}${openGroup === item.label ? " open" : ""}`}
            key={item.label}
            onMouseEnter={() => setOpenGroup(item.label)}
            onMouseLeave={() => setOpenGroup((current) => (current === item.label ? null : current))}
          >
            <button
              aria-expanded={openGroup === item.label}
              className={`dashboard-topbar-link dashboard-topbar-link-button${isGroupActive(currentPath, item.items) ? " active" : ""}${openGroup === item.label ? " active" : ""}`}
              onClick={() =>
                setOpenGroup((current) => (current === item.label ? null : item.label))
              }
              type="button"
            >
              {item.icon ? <DashboardNavIcon name={item.icon} /> : null}
              <span>{item.label}</span>
              <ChevronDownGlyph />
            </button>
            <div className="dashboard-topbar-dropdown-menu">
              {item.items.map((entry) => (
                <a
                  className={`dashboard-topbar-dropdown-item${currentPath === entry.href ? " active" : ""}`}
                  href={entry.href}
                  key={entry.href}
                  onClick={() => setOpenGroup(null)}
                >
                  <span>{entry.label}</span>
                </a>
              ))}
            </div>
          </div>
        )
      )}
    </div>
  );
}

function isGroupActive(currentPath: string, items: ReadonlyArray<{ href: string }>) {
  return items.some((item) => item.href === currentPath);
}

function isLinkActive(currentPath: string, href: string) {
  return currentPath === href || (currentPath === "/onboarding" && href === "/workspace");
}

function ChevronDownGlyph() {
  return (
    <svg
      aria-hidden="true"
      className="dashboard-topbar-chevron"
      fill="none"
      height="14"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="14"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function DashboardNavIcon({ name }: { name: DashboardNavIconName }) {
  const common = {
    fill: "none",
    height: 18,
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 1.8,
    viewBox: "0 0 24 24",
    width: 18
  };

  if (name === "home") return <svg aria-hidden="true" className="dashboard-topbar-nav-icon" {...common}><path d="m3 11 9-8 9 8" /><path d="M5 10v10h14V10" /><path d="M9 20v-6h6v6" /></svg>;
  if (name === "inbox") return <svg aria-hidden="true" className="dashboard-topbar-nav-icon" {...common}><path d="M4 5h16v13H8l-4 3Z" /><path d="M8 10h8M8 14h5" /></svg>;
  if (name === "contacts") return <svg aria-hidden="true" className="dashboard-topbar-nav-icon" {...common}><circle cx="9" cy="8" r="3" /><path d="M3 20v-2a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v2" /><path d="M16 4a3 3 0 0 1 0 6M18 13a4 4 0 0 1 3 4v2" /></svg>;
  if (name === "automation") return <svg aria-hidden="true" className="dashboard-topbar-nav-icon" {...common}><path d="m13 2-8 12h7l-1 8 8-12h-7Z" /></svg>;
  if (name === "campaigns") return <svg aria-hidden="true" className="dashboard-topbar-nav-icon" {...common}><path d="m3 11 18-8-7 18-3-7Z" /><path d="m11 14 4-4" /></svg>;
  if (name === "analytics") return <svg aria-hidden="true" className="dashboard-topbar-nav-icon" {...common}><path d="M4 20V10h4v10M10 20V4h4v16M16 20v-7h4v7" /></svg>;
  return <svg aria-hidden="true" className="dashboard-topbar-nav-icon" {...common}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.1A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.1A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.1A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.14.39.35.73.6 1 .3.3.7.44 1.1.4h.1v4h-.1a1.7 1.7 0 0 0-1.7.6Z" /></svg>;
}
