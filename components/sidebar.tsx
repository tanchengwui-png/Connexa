import { ConnexaLogo } from "@/components/connexa-logo";
import { LogoutButton } from "@/components/logout-button";

const navItems = [
  { label: "Inbox", tag: "Core", href: "/inbox" },
  { label: "Overview", tag: "Ops", href: "/workspace" },
  { label: "Contacts", href: "/contacts" },
  { label: "Quick Replies", href: "/quick-replies" },
  { label: "Automation", href: "/automation-rules" },
  { label: "Leads", href: "/leads" },
  { label: "Catalog", tag: "Assets", href: "/products" },
  { label: "Calendar", tag: "Ops", href: "/calendar" },
  { label: "Campaigns", href: "/campaigns" },
  { label: "Team", href: "/team" },
  { label: "Industry Setup", tag: "Setup", href: "/settings/industry" },
  { label: "Settings", href: "/settings" }
];

type SidebarProps = {
  currentPath: string;
};

export function Sidebar({ currentPath }: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <ConnexaLogo dark href="/" />
        <div>
          <h1>Shared Inbox</h1>
          <p className="muted">Connexa workspace</p>
        </div>
      </div>

      <div className="sidebar-section-label">Workspace</div>

      <nav aria-label="Primary" className="nav-group">
        {navItems.map((item) => (
          <a
            className={`nav-link${currentPath === item.href ? " active" : ""}`}
            href={item.href}
            key={item.label}
          >
            <span>{item.label}</span>
            {item.tag ? <span className="pill-muted">{item.tag}</span> : null}
          </a>
        ))}
      </nav>

      <div className="sidebar-card">
        <strong>Team workflow</strong>
        <p className="muted">
          Keep the inbox as the operational center, then use contacts, leads, and
          automation to support follow-up quality and team handoff.
        </p>
        <LogoutButton />
      </div>
    </aside>
  );
}
