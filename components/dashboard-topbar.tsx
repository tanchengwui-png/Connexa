import { ConnexaLogo } from "@/components/connexa-logo";
import { DashboardNotifications } from "@/components/dashboard-notifications";
import { DashboardTopbarNav } from "@/components/dashboard-topbar-nav";
import { DashboardTopbarControls } from "@/components/dashboard-topbar-controls";
import { getCurrentAgent, getCurrentAgentMemberships } from "@/lib/auth/current-user";
import { getCurrentSubscriptionOverview } from "@/lib/billing-management";
import { getAgentInboxNotificationSoundsMuted } from "@/lib/inbox-notification-preferences";

type DashboardTopbarProps = {
  billingReminder?: {
    href: string;
    label: string;
    title: string;
  } | null;
  currentPath: string;
  variant?: "default" | "onboarding";
};

export async function DashboardTopbar({ billingReminder, currentPath, variant = "default" }: DashboardTopbarProps) {
  const [currentAgent, memberships] = await Promise.all([
    getCurrentAgent(),
    getCurrentAgentMemberships()
  ]);
  const currentMembership = memberships.find((membership) => membership.isCurrent) ?? memberships[0] ?? null;
  const [subscription, inboxNotificationSoundsMuted] = currentAgent
    ? await Promise.all([
        getCurrentSubscriptionOverview(currentAgent.workspaceId),
        getAgentInboxNotificationSoundsMuted({
          agentId: currentAgent.id,
          workspaceId: currentAgent.workspaceId
        })
      ])
    : [null, false];

  return (
    <header className={`dashboard-topbar${variant === "onboarding" ? " dashboard-topbar-onboarding" : ""}`}>
      <div className="dashboard-topbar-main">
        <div className="dashboard-topbar-primary">
          {variant === "onboarding" ? (
            <label className="dashboard-onboarding-search">
              <svg aria-hidden="true" fill="none" height="18" stroke="currentColor" strokeLinecap="round" strokeWidth="2" viewBox="0 0 24 24" width="18">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              <input aria-label="Search workspace" placeholder="Search conversations, contacts, campaigns..." />
              <kbd>⌘ K</kbd>
            </label>
          ) : (
            <div className="dashboard-topbar-brand">
              <div className="dashboard-topbar-brand-logo">
                <ConnexaLogo dark href="/" />
              </div>
            </div>
          )}

          {variant === "default" ? (
            <nav aria-label="Global" className="dashboard-topbar-secondary">
              <DashboardTopbarNav currentPath={currentPath} items={TOPBAR_NAV_ITEMS} />
            </nav>
          ) : null}

          <div className="dashboard-topbar-session">
            <div className="dashboard-topbar-actions">
              <span className="dashboard-topbar-online">{variant === "onboarding" ? "All Systems Operational" : "Online"}</span>
              {billingReminder ? (
                <a
                  aria-label={billingReminder.title}
                  className="dashboard-topbar-billing-alert"
                  href={billingReminder.href}
                  title={billingReminder.title}
                >
                  <span aria-hidden="true" className="dashboard-topbar-billing-alert-dot" />
                  <span>{billingReminder.label}</span>
                </a>
              ) : null}
              <DashboardNotifications
                agentId={currentAgent?.id ?? null}
                initialInboxNotificationSoundsMuted={inboxNotificationSoundsMuted}
                workspaceId={currentAgent?.workspaceId ?? null}
              />
            </div>
            <DashboardTopbarControls
              memberships={memberships.map((membership) => ({
                agentId: membership.agentId,
                workspaceId: membership.workspaceId,
                workspaceName: membership.workspaceName,
                workspaceSlug: membership.workspaceSlug,
                role: membership.role,
                isCurrent: membership.isCurrent
              }))}
              planStatus={buildPlanStatus(subscription)}
              roleLabel={currentMembership?.role.toLowerCase() ?? "workspace admin"}
              userName={currentAgent?.name ?? "Workspace admin"}
              workspaceName={currentMembership?.workspaceName ?? "Connexa workspace"}
            />
          </div>
        </div>
      </div>
    </header>
  );
}

function buildPlanStatus(
  subscription: Awaited<ReturnType<typeof getCurrentSubscriptionOverview>>
) {
  if (!subscription?.packageName || !subscription.expiryDate) {
    return null;
  }

  if (subscription.isExpired) {
    return {
      tone: "expired" as const,
      text: `Your ${subscription.packageName} plan expired at '${formatPlanDateTime(subscription.expiryDate)}'`
    };
  }

  const remainingDays = Math.max(
    1,
    Math.ceil((subscription.expiryDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000))
  );
  return {
    tone: "active" as const,
    text: `${subscription.packageName} plan: ${remainingDays} day${remainingDays === 1 ? "" : "s"} left`
  };
}

function formatPlanDateTime(value: Date) {
  return new Intl.DateTimeFormat("en-MY", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(value);
}

const TOPBAR_NAV_ITEMS = [
  { type: "link", label: "Home", href: "/workspace", icon: "home" },
  { type: "link", label: "Inbox", href: "/inbox", icon: "inbox" },
  {
    type: "group",
    label: "Contacts",
    icon: "contacts",
    items: [
      { label: "All Contacts", href: "/contacts" },
      { label: "Leads", href: "/leads" },
      { label: "Team", href: "/team" }
    ]
  },
  { type: "link", label: "Automations", href: "/automation-rules", icon: "automation" },
  { type: "link", label: "Campaigns", href: "/campaigns", icon: "campaigns" },
  {
    type: "group",
    label: "Analytics",
    icon: "analytics",
    items: [
      { label: "Message Logs", href: "/message-logs" },
      { label: "Scheduled Messages", href: "/scheduled-messages" }
    ]
  },
  {
    type: "group",
    label: "Settings",
    icon: "settings",
    items: [
      { label: "Account Settings", href: "/account-settings" },
      { label: "Quick Replies", href: "/quick-replies" },
      { label: "Media Library", href: "/media-library" },
      { label: "Calendar", href: "/calendar" }
    ]
  }
] as const;
