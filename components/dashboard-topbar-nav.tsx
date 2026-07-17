"use client";

import { useEffect, useRef, useState } from "react";

type NavLinkItem = {
  type: "link";
  label: string;
  href: string;
};

type NavGroupItem = {
  type: "group";
  label: string;
  items: ReadonlyArray<{
    label: string;
    href: string;
  }>;
};

type TopbarNavItem = NavLinkItem | NavGroupItem;

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
            className={`dashboard-topbar-link${currentPath === item.href ? " active" : ""}`}
            href={item.href}
            key={item.href}
          >
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

function ChevronDownGlyph() {
  return (
    <svg
      aria-hidden="true"
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
