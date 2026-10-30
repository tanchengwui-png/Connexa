import Link from "next/link";
import { DashboardShell } from "@/components/dashboard-shell";
import { ChevronLeftIcon } from "@/components/inbox/icons";
import { AccountDeletionManager } from "@/components/account-deletion-manager";
import { requireCurrentAgent } from "@/lib/auth/current-user";

export default async function DataAndAccountPage() {
  await requireCurrentAgent();
  return <DashboardShell currentPath="/account-settings/billing">
    <div className="subscriber-billing-shell">
      <header className="subscriber-billing-header"><div className="subscriber-billing-header-content"><span>Account settings</span><h1>Data and account</h1><p>Manage your account data and permanent account actions.</p><Link className="button button-secondary subscriber-billing-back-link" href="/account-settings/billing"><ChevronLeftIcon />Back to billing</Link></div></header>
      <AccountDeletionManager />
    </div>
  </DashboardShell>;
}
