import { DashboardTopbar } from "@/components/dashboard-topbar";
import { requireCurrentAgent } from "@/lib/auth/current-user";
import {
  activateFreeTrialAfterVerification,
  getCurrentSubscriptionOverview,
  getSubscriberBillingOverviewForPage
} from "@/lib/billing-management";
import { redirect } from "next/navigation";

type DashboardShellProps = {
  currentPath: string;
  children: React.ReactNode;
};

export async function DashboardShell({
  currentPath,
  children
}: DashboardShellProps) {
  const agent = await requireCurrentAgent();
  await activateFreeTrialAfterVerification(agent.id);
  const subscription = await getCurrentSubscriptionOverview(agent.workspaceId);
  const billingOverview =
    subscription?.status === "TRIAL" && currentPath !== "/account-settings/billing"
      ? await getSubscriberBillingOverviewForPage(agent.workspaceId, 1, 5)
      : null;
  if (subscription?.isExpired && currentPath !== "/account-settings/billing") {
    redirect("/account-settings/billing?expired=1");
  }
  const isInboxLayout = currentPath === "/inbox";
  const trialInvoice = billingOverview?.documents.find((document) => document.source === "invoice" && document.payable) ?? null;

  return (
    <div className={`shell shell-topbar${isInboxLayout ? " shell-inbox" : ""}`}>
      <DashboardTopbar currentPath={currentPath} />
      <main className={`app-main${isInboxLayout ? " app-main-inbox" : ""}`}>
        {currentPath !== "/account-settings/billing" && billingOverview && billingOverview.summary.openInvoices > 0 && trialInvoice ? (
          <section className="subscriber-payment-reminder account-payment-reminder">
            <span className="subscriber-section-label">Account reminder</span>
            <div className="panel-row dashboard-payment-reminder-row">
              <div className="dashboard-payment-reminder-copy">
                <h2>Package payment is still pending</h2>
                <p>
                  Your billing access remains available until {formatReminderDateTime(trialInvoice.dueDateIso)}.{" "}
                  {formatReminderTimeLeft(trialInvoice.dueDateIso)} left to pay before access is restricted.
                </p>
              </div>
              <a className="button button-primary dashboard-payment-reminder-button" href="/account-settings/billing">
                View my plan
              </a>
            </div>
          </section>
        ) : null}
        {children}
      </main>
    </div>
  );
}

function formatReminderDateTime(value: string | null) {
  if (!value) {
    return "the due date";
  }

  return `${new Intl.DateTimeFormat("en-MY", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kuala_Lumpur"
  }).format(new Date(value))} (GMT+8)`;
}

function formatReminderTimeLeft(value: string | null) {
  if (!value) {
    return "Time";
  }

  const remainingMs = new Date(value).getTime() - Date.now();
  if (remainingMs <= 0) {
    return "0 hours";
  }
  if (remainingMs < 86_400_000) {
    const hoursLeft = Math.max(1, Math.ceil(remainingMs / 3_600_000));
    return `${hoursLeft} hour${hoursLeft === 1 ? "" : "s"}`;
  }
  const daysLeft = Math.ceil(remainingMs / 86_400_000);
  return `${daysLeft} day${daysLeft === 1 ? "" : "s"}`;
}
