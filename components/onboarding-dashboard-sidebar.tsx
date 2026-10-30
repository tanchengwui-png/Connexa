import { ConnexaLogo } from "@/components/connexa-logo";

type OnboardingDashboardSidebarProps = {
  packageName?: string | null;
  trialDaysLeft?: number | null;
};

const navigation = [
  { label: "Home", href: "/workspace", icon: "home" },
  { label: "Inbox", href: "/inbox", icon: "inbox" },
  { label: "Contacts", href: "/contacts", icon: "contacts" },
  { label: "Automations", href: "/automation-rules", icon: "automation" },
  { label: "Campaigns", href: "/campaigns", icon: "campaigns" },
  { label: "Analytics", href: "/workspace", icon: "analytics" }
] as const;

export function OnboardingDashboardSidebar({
  packageName,
  trialDaysLeft
}: OnboardingDashboardSidebarProps) {
  return (
    <aside className="onboarding-dashboard-sidebar">
      <div className="onboarding-dashboard-brand">
        <ConnexaLogo dark href="/workspace" priority />
      </div>

      <nav aria-label="Workspace" className="onboarding-dashboard-nav">
        {navigation.map((item, index) => (
          <a
            className={`onboarding-dashboard-nav-link${index === 0 ? " active" : ""}`}
            href={item.href}
            key={`${item.label}-${index}`}
          >
            <SidebarIcon name={item.icon} />
            <span>{item.label}</span>
          </a>
        ))}
      </nav>

      <div className="onboarding-dashboard-nav-divider" />

      <a className="onboarding-dashboard-nav-link" href="/account-settings">
        <SidebarIcon name="settings" />
        <span>Settings</span>
      </a>

      <div className="onboarding-dashboard-plan">
        <div className="onboarding-dashboard-plan-heading">
          <span className="onboarding-dashboard-plan-icon" aria-hidden="true">♛</span>
          <div>
            <strong>{packageName || "Pro Plan"}</strong>
            <span>
              {trialDaysLeft ? `${trialDaysLeft} day${trialDaysLeft === 1 ? "" : "s"} left in trial` : "Workspace plan active"}
            </span>
          </div>
        </div>
        <div className="onboarding-dashboard-plan-track"><span /></div>
        <a href="/packages">View Plan</a>
      </div>
    </aside>
  );
}

function SidebarIcon({ name }: { name: typeof navigation[number]["icon"] | "settings" }) {
  const common = {
    fill: "none",
    height: 22,
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 1.8,
    viewBox: "0 0 24 24",
    width: 22
  };

  if (name === "home") return <svg aria-hidden="true" {...common}><path d="m3 11 9-8 9 8" /><path d="M5 10v10h14V10" /><path d="M9 20v-6h6v6" /></svg>;
  if (name === "inbox") return <svg aria-hidden="true" {...common}><path d="M4 5h16v13H8l-4 3Z" /><path d="M8 10h8M8 14h5" /></svg>;
  if (name === "contacts") return <svg aria-hidden="true" {...common}><circle cx="9" cy="8" r="3" /><path d="M3 20v-2a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v2" /><path d="M16 4a3 3 0 0 1 0 6M18 13a4 4 0 0 1 3 4v2" /></svg>;
  if (name === "automation") return <svg aria-hidden="true" {...common}><path d="m13 2-8 12h7l-1 8 8-12h-7Z" /></svg>;
  if (name === "campaigns") return <svg aria-hidden="true" {...common}><path d="m3 11 18-8-7 18-3-7Z" /><path d="m11 14 4-4" /></svg>;
  if (name === "analytics") return <svg aria-hidden="true" {...common}><path d="M4 20V10h4v10M10 20V4h4v16M16 20v-7h4v7" /></svg>;
  return <svg aria-hidden="true" {...common}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.1A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.1A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.1A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.14.39.35.73.6 1 .3.3.7.44 1.1.4h.1v4h-.1a1.7 1.7 0 0 0-1.7.6Z" /></svg>;
}
