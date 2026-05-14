import Link from "next/link";
import { ReactNode } from "react";
import { PlatformLogoutButton } from "@/components/platform-logout-button";

type PlatformAdminNavItem = {
  key: string;
  title: string;
  description: string;
  href?: string;
  status: "live" | "planned";
};

type PlatformAdminShellProps = {
  adminEmail: string;
  currentKey: string;
  items: PlatformAdminNavItem[];
  title: string;
  description: string;
  children: ReactNode;
};

export function PlatformAdminShell({
  adminEmail,
  currentKey,
  items,
  title,
  description,
  children
}: PlatformAdminShellProps) {
  return (
    <div className="platform-admin-layout">
      <aside className="content-card platform-admin-sidebar">
        <div className="platform-admin-sidebar-head">
          <span className="badge connexa-public-badge">Platform owner</span>
          <div>
            <h2>Platform operations</h2>
            <p>Use this shell for owner-level delivery, checkout, and operational controls.</p>
          </div>
        </div>

        <nav aria-label="Platform settings" className="platform-admin-nav">
          {items.map((item) => {
            const isActive = item.key === currentKey;
            const className = `platform-admin-nav-item${isActive ? " active" : ""}${item.status === "planned" ? " planned" : ""}`;

            const content = (
              <>
                <div>
                  <strong>{item.title}</strong>
                  <p>{item.description}</p>
                </div>
                <span className={`platform-admin-nav-pill ${item.status}`}>{item.status === "live" ? "Live" : "Planned"}</span>
              </>
            );

            return item.href ? (
              <Link className={className} href={item.href} key={item.key}>
                {content}
              </Link>
            ) : (
              <div aria-disabled="true" className={className} key={item.key}>
                {content}
              </div>
            );
          })}
        </nav>

        <div className="platform-admin-sidebar-foot">
          <div className="platform-admin-sidebar-session">
            <span>Signed in as</span>
            <strong>{adminEmail}</strong>
            <p>Platform-only session. Workspace manager authentication stays separate.</p>
          </div>
          <div className="platform-admin-sidebar-actions">
            <PlatformLogoutButton />
          </div>
        </div>
      </aside>

      <section className="platform-admin-content">
        <header className="settings-dark-hero platform-admin-hero">
          <div className="settings-dark-copy">
            <h1>{title}</h1>
            <p>{description}</p>
          </div>
        </header>

        {children}
      </section>
    </div>
  );
}
