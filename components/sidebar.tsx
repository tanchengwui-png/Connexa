import { ConnexaLogo } from "@/components/connexa-logo";
import { LogoutButton } from "@/components/logout-button";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";
import { getCurrentAgent, getCurrentAgentMemberships } from "@/lib/auth/current-user";

const workspaceNavItems = [
  { label: "Overview", href: "/workspace" },
  { label: "Inbox", href: "/inbox" },
  { label: "Scheduled", href: "/scheduled-messages" },
  { label: "Message Logs", href: "/message-logs" },
  { label: "Contacts", href: "/contacts" },
  { label: "Automation", href: "/automation-rules" },
  { label: "Campaigns", href: "/campaigns" },
  { label: "Leads", href: "/leads" },
  { label: "Calendar", href: "/calendar" }
];

const setupNavItems = [
  { label: "Team", href: "/team" },
  { label: "Quick Replies", href: "/quick-replies" },
  { label: "Media Library", href: "/media-library" },
  { label: "Account Setting", href: "/account-settings" }
];

type SidebarProps = {
  currentPath: string;
};

export async function Sidebar({ currentPath }: SidebarProps) {
  const [currentAgent, memberships] = await Promise.all([
    getCurrentAgent(),
    getCurrentAgentMemberships()
  ]);
  const currentMembership = memberships.find((membership) => membership.isCurrent) ?? memberships[0] ?? null;

  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <div className="brand">
          <ConnexaLogo dark href="/" />
          <div>
            <p className="sidebar-eyebrow">Admin console</p>
            <h1>Shared Inbox</h1>
            <p className="muted">Connexa workspace</p>
          </div>
        </div>

        <div className="sidebar-admin-card">
          <span className="sidebar-admin-label">Session</span>
          <div className="sidebar-session-head">
            <strong>{currentAgent?.name ?? "Workspace admin"}</strong>
            {currentMembership ? (
              <span className="sidebar-session-role-pill">{currentMembership.role.toLowerCase()}</span>
            ) : null}
          </div>
          <p className="muted">{currentAgent?.email ?? "No active session"}</p>
          {currentMembership ? (
            <div className="sidebar-session-meta">
              <div className="sidebar-session-meta-row">
                <span>Workspace</span>
                <strong>{currentMembership.workspaceName}</strong>
              </div>
            </div>
          ) : null}
          <WorkspaceSwitcher memberships={memberships} />
          <div className="sidebar-session-actions">
            <LogoutButton />
          </div>
        </div>
      </div>

      <nav aria-label="Primary" className="nav-group">
        {workspaceNavItems.map((item) => (
          <a
            className={`nav-link${currentPath === item.href ? " active" : ""}`}
            href={item.href}
            key={item.label}
          >
            <span>{item.label}</span>
          </a>
        ))}
      </nav>

      <div className="sidebar-nav-divider" aria-hidden="true" />

      <div className="sidebar-section-label">Setup</div>

      <nav aria-label="Setup" className="nav-group nav-group-setup">
        {setupNavItems.map((item) => (
          <a
            className={`nav-link${currentPath === item.href ? " active" : ""}`}
            href={item.href}
            key={item.label}
          >
            <span>{item.label}</span>
          </a>
        ))}
      </nav>
    </aside>
  );
}
