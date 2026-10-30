import Link from "next/link";
import { DashboardShell } from "@/components/dashboard-shell";
import { ChevronLeftIcon } from "@/components/inbox/icons";
import { requireCurrentAgent } from "@/lib/auth/current-user";
import { getBillingPageDataForPage } from "@/lib/billing-management";
import { BillingDetailsForm } from "@/components/billing-details-form";

export default async function BillingDetailsPage() {
  const agent = await requireCurrentAgent();
  const billing = await getBillingPageDataForPage(agent.workspaceId, agent.name, agent.email);
  return <DashboardShell currentPath="/account-settings/billing">
    <div className="subscriber-billing-shell billing-details-page">
      <header className="subscriber-billing-header"><div className="subscriber-billing-header-content"><span>Subscriber billing</span><h1>Billing details</h1><p>Update the billing information used for invoices, receipts, and payment confirmations.</p><Link className="button button-secondary subscriber-billing-back-link" href="/account-settings/billing"><ChevronLeftIcon />Back to billing</Link></div></header>
      {agent.role === "MANAGER" ? <BillingDetailsForm profile={billing.profile} /> : <p className="form-error">Only workspace managers can update billing details.</p>}
    </div>
  </DashboardShell>;
}
