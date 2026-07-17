import { ConnexaLogo } from "@/components/connexa-logo";
import { DashboardNotifications } from "@/components/dashboard-notifications";
import { DashboardTopbarNav } from "@/components/dashboard-topbar-nav";
import { DashboardTopbarControls } from "@/components/dashboard-topbar-controls";
import { getCurrentAgent, getCurrentAgentMemberships } from "@/lib/auth/current-user";
import { getCurrentSubscriptionOverview } from "@/lib/billing-management";
import { getAgentInboxNotificationSoundsMuted } from "@/lib/inbox-notification-preferences";

type DashboardTopbarProps = {
  currentPath: string;
};

export async function DashboardTopbar({ currentPath }: DashboardTopbarProps) {
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
    <header className="dashboard-topbar">
      <div className="dashboard-topbar-main">
        <div className="dashboard-topbar-primary">
          <div className="dashboard-topbar-brand">
            <div className="dashboard-topbar-brand-logo">
              <ConnexaLogo dark href="/" />
            </div>
          </div>

          <nav aria-label="Global" className="dashboard-topbar-secondary">
            <DashboardTopbarNav currentPath={currentPath} items={TOPBAR_NAV_ITEMS} />
          </nav>

          <div className="dashboard-topbar-session">
            <div className="dashboard-topbar-actions">
              <span className="dashboard-topbar-online">Online</span>
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
  { type: "link", label: "Overview", href: "/workspace" },
  { type: "link", label: "Inbox", href: "/inbox" },
  {
    type: "group",
    label: "Messages",
    items: [
      { label: "Scheduled", href: "/scheduled-messages" },
      { label: "Message Logs", href: "/message-logs" },
      { label: "Quick Replies", href: "/quick-replies" },
      { label: "Media Library", href: "/media-library" }
    ]
  },
  {
    type: "group",
    label: "CRM",
    items: [
      { label: "Contacts", href: "/contacts" },
      { label: "Leads", href: "/leads" },
      { label: "Calendar", href: "/calendar" },
      { label: "Team", href: "/team" }
    ]
  },
  { type: "link", label: "Campaigns", href: "/campaigns" },
  {
    type: "group",
    label: "More",
    items: [
      { label: "Automation", href: "/automation-rules" },
      { label: "Account Setting", href: "/account-settings" }
    ]
  }
] as const;
