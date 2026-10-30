"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type ReactNode } from "react";
import { AccountSecurityCard } from "@/components/account-security-card";
import {
  WorkspacePackageUpgradeCard,
  type UpgradeInvoice,
  type WorkspacePackageOption
} from "@/components/workspace-package-upgrade-card";
import type { PackageBillingPeriod } from "@/lib/package-pricing";

type UsageMetric = {
  label: string;
  current: number;
  limit: number | null;
};

type AccountSettingsDashboardProps = {
  workspaceName: string;
  isSubscriptionExpired: boolean;
  subscriptionExpiresAtLabel: string | null;
  renewHref: string;
  isSetupComplete: boolean;
  workspaceStatus: string;
  planLabel: string;
  numberUsageLabel: string;
  maskedPhone: string;
  whatsappStatus: string;
  inboxReadiness: string;
  workerStatus: string;
  runtimeStatus: string;
  lastSyncLabel: string;
  profileName: string;
  sessionOwner: string;
  latestSyncIssue: string;
  verificationState: string;
  importedSummary: string;
  initialBillingPeriod: PackageBillingPeriod;
  packageOptions: WorkspacePackageOption[];
  packageInvoices: UpgradeInvoice[];
  packageUpgradeStatus: "success" | "failed" | "pending" | null;
  usage: UsageMetric[];
};

const TABS = ["overview", "whatsapp", "billing", "usage", "security"] as const;
type Tab = (typeof TABS)[number];

const TAB_LABELS: Record<Tab, string> = {
  overview: "Overview",
  whatsapp: "WhatsApp",
  billing: "Billing",
  usage: "Usage",
  security: "Security"
};

export function AccountSettingsDashboard(props: AccountSettingsDashboardProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selected = searchParams?.get("tab");
  const activeTab: Tab = TABS.includes(selected as Tab) ? (selected as Tab) : "overview";
  const [isChecklistOpen, setIsChecklistOpen] = useState(false);

  function selectTab(tab: Tab) {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    if (tab === "overview") params.delete("tab");
    else params.set("tab", tab);
    router.replace(`/account-settings${params.size ? `?${params.toString()}` : ""}`, { scroll: false });
  }

  return <div className="account-settings-dashboard">
    <header className="account-settings-page-header">
      <div>
        <p className="account-settings-breadcrumb">Settings <span aria-hidden="true">/</span> Account</p>
        <h1>Account settings</h1>
        <p>Manage your workspace, billing, integrations, security, and usage.</p>
      </div>
      <div className="account-settings-header-summary" aria-label="Workspace summary">
        <span><StatusDot tone={props.isSubscriptionExpired ? "warning" : "success"} />{props.isSubscriptionExpired ? "Subscription status" : "Workspace status"}: <strong>{props.isSubscriptionExpired ? "Expired" : props.workspaceStatus}</strong></span>
        <span>Current plan: <strong>{props.planLabel}</strong></span>
        <Link className="button button-primary" href={props.isSubscriptionExpired ? props.renewHref : "/account-settings/billing"}>{props.isSubscriptionExpired ? "Renew subscription" : "Manage subscription"}</Link>
      </div>
    </header>

    {props.isSubscriptionExpired ? <section className="account-settings-expired-alert" role="alert"><div><StatusDot tone="warning" /><strong>Your subscription has expired.</strong><p>Renew your subscription to restore workspace features.{props.subscriptionExpiresAtLabel ? ` Expired on ${props.subscriptionExpiresAtLabel}.` : ""}</p></div><Link className="button button-primary" href={props.renewHref}>Renew subscription</Link></section> : props.isSetupComplete ? <div className="account-settings-success" role="status"><StatusDot /> <strong>Workspace setup complete</strong></div> : null}

    <div aria-label="Account settings sections" className="account-settings-tabs" role="tablist">
      {TABS.map((tab) => <button aria-controls={`account-settings-${tab}`} aria-selected={activeTab === tab} className={activeTab === tab ? "active" : ""} id={`account-settings-tab-${tab}`} key={tab} onClick={() => selectTab(tab)} role="tab" type="button">{TAB_LABELS[tab]}</button>)}
    </div>

    <section aria-labelledby={`account-settings-tab-${activeTab}`} className="account-settings-tab-panel" id={`account-settings-${activeTab}`} role="tabpanel">
      {activeTab === "overview" ? <Overview {...props} isChecklistOpen={isChecklistOpen} onChecklistToggle={() => setIsChecklistOpen((open) => !open)} onSelectTab={selectTab} /> : null}
      {activeTab === "whatsapp" ? <WhatsAppPanel {...props} /> : null}
      {activeTab === "billing" ? <BillingPanel {...props} /> : null}
      {activeTab === "usage" ? <UsagePanel isSubscriptionExpired={props.isSubscriptionExpired} usage={props.usage} /> : null}
      {activeTab === "security" ? <AccountSecurityCard /> : null}
    </section>
  </div>;
}

function Overview(props: AccountSettingsDashboardProps & { isChecklistOpen: boolean; onChecklistToggle: () => void; onSelectTab: (tab: Tab) => void }) {
  const rows: Array<{ icon: IconName; title: string; description: string; tab?: Tab; href?: string }> = [
    { icon: "settings", title: "General workspace settings", description: `Manage ${props.workspaceName} and account preferences.`, href: "/account-settings/data-and-account" },
    { icon: "whatsapp", title: "WhatsApp connection and inbox readiness", description: props.isSubscriptionExpired ? `${props.whatsappStatus} · Messaging unavailable until renewal` : `${props.whatsappStatus} · ${props.inboxReadiness}`, tab: "whatsapp" },
    { icon: "card", title: "Billing and subscription", description: props.isSubscriptionExpired ? "Subscription expired — renew to restore workspace access." : `${props.planLabel} plan and payment requests.`, tab: "billing" },
    { icon: "chart", title: "Usage and limits", description: "Review workspace capacity and usage.", tab: "usage" },
    { icon: "lock", title: "Password and security", description: "Update your password and account security.", tab: "security" }
  ];
  return <div className="account-settings-overview">
    <div className="account-settings-summary-grid">
      <SummaryCard icon="card" label={props.isSubscriptionExpired ? "Subscription" : "Current plan"} title={props.isSubscriptionExpired ? "Expired" : props.planLabel} detail={props.isSubscriptionExpired ? (props.subscriptionExpiresAtLabel ? `Expired on ${props.subscriptionExpiresAtLabel}` : "Renew to restore workspace features") : props.numberUsageLabel} tone={props.isSubscriptionExpired ? "warning" : undefined} />
      <SummaryCard icon="pulse" label="Workspace status" title={props.workspaceStatus} detail={props.isSubscriptionExpired ? "Workspace access is limited" : props.inboxReadiness} tone={props.isSubscriptionExpired ? "warning" : "success"} />
      <SummaryCard icon="whatsapp" label="WhatsApp" title={props.whatsappStatus} detail={props.isSubscriptionExpired ? `${props.maskedPhone} · Messaging unavailable until renewal` : props.maskedPhone} tone={props.whatsappStatus === "Connected" ? "success" : undefined} />
    </div>
    <section className="account-settings-checklist">
      <button aria-expanded={props.isChecklistOpen} className="account-settings-checklist-trigger" onClick={props.onChecklistToggle} type="button"><span><StatusDot /> <strong>Workspace setup — {props.isSetupComplete ? "Complete" : "In progress"}</strong><small>{props.isSetupComplete ? "Workspace setup complete" : "Review the remaining setup items"}</small></span><span>{props.isChecklistOpen ? "Hide checklist" : "View checklist"} <Chevron /></span></button>
      {props.isChecklistOpen ? <ul><li><StatusDot />Choose a package <strong>Completed</strong></li><li><StatusDot />Connect WhatsApp <strong>{props.whatsappStatus === "Connected" ? "Completed" : "Needs setup"}</strong></li><li><StatusDot />Check inbox readiness <strong>{props.inboxReadiness === "Ready for inbox use" ? "Completed" : "Review"}</strong></li><li><StatusDot />Review usage <strong>Completed</strong></li></ul> : null}
    </section>
    <section aria-labelledby="account-settings-list-heading" className="account-settings-list"><h2 id="account-settings-list-heading">Settings</h2>{rows.map((row) => row.href ? <Link className="account-settings-row" href={row.href} key={row.title}><Icon name={row.icon} /><RowCopy {...row} /><Chevron /></Link> : <button className="account-settings-row" key={row.title} onClick={() => props.onSelectTab(row.tab!)} type="button"><Icon name={row.icon} /><RowCopy {...row} /><Chevron /></button>)}</section>
  </div>;
}

function WhatsAppPanel(props: AccountSettingsDashboardProps) {
  const subscriptionAccess = props.isSubscriptionExpired ? "Unavailable until renewal" : "Available";
  return <section className="account-settings-section"><div className="account-settings-section-head"><div><h2>WhatsApp connection</h2><p>{props.isSubscriptionExpired ? "Your connection is shown below; inbox messaging is unavailable while the subscription is expired." : "Manage your connected number and inbox readiness."}</p></div><span className="account-settings-status"><StatusDot tone={props.isSubscriptionExpired ? "warning" : "success"} />{props.whatsappStatus}</span></div><dl className="account-settings-definition-grid"><Definition label="Number" value={props.maskedPhone} /><Definition label="Connection" value={props.whatsappStatus} /><Definition label="Subscription access" value={subscriptionAccess} /><Definition label="Inbox" value={props.inboxReadiness} /><Definition label="Worker" value={props.workerStatus} /><Definition label="Last synchronization" value={props.lastSyncLabel} /></dl><div className="account-settings-actions">{props.isSubscriptionExpired ? <Link className="button button-primary" href={props.renewHref}>Renew subscription</Link> : <><Link className="button button-primary" href="/inbox">Open inbox</Link><Link className="button button-secondary" href="/settings/whatsapp">Manage connection</Link></>}</div><details className="account-settings-advanced"><summary>Advanced diagnostics</summary><dl className="account-settings-definition-grid"><Definition label="Runtime state" value={props.runtimeStatus} /><Definition label="Profile" value={props.profileName} /><Definition label="Connected by" value={props.sessionOwner} /><Definition label="Imported history" value={props.importedSummary} /><Definition label="Live traffic" value={props.verificationState} /><Definition label="Latest sync issue" value={props.latestSyncIssue} /></dl></details></section>;
}

function BillingPanel(props: AccountSettingsDashboardProps) {
  if (props.isSubscriptionExpired) return <div className="account-settings-billing"><section className="account-settings-section"><div className="account-settings-section-head"><div><h2>Subscription recovery</h2><p>{props.planLabel} · Subscription expired{props.subscriptionExpiresAtLabel ? ` on ${props.subscriptionExpiresAtLabel}` : ""}</p></div><Link className="button button-primary" href={props.renewHref}>Renew subscription</Link></div><dl className="account-settings-billing-facts"><Definition label="Previous plan" value={props.planLabel} /><Definition label="Billing details" value="Manage your billing contact and payment details" /><Definition label="Invoices and requests" value="View invoices and package payment requests" /></dl><div className="account-settings-actions"><Link className="button button-secondary" href="/account-settings/billing">View payment requests or invoices</Link><Link className="button button-secondary" href="/account-settings/billing/details">Billing details</Link></div></section></div>;
  return <div className="account-settings-billing"><section className="account-settings-section"><div className="account-settings-section-head"><div><h2>Current plan</h2><p>{props.planLabel} · Current workspace subscription</p></div><Link className="button button-primary" href="/account-settings/billing">Manage plan</Link></div><dl className="account-settings-billing-facts"><Definition label="Number capacity" value={props.numberUsageLabel} /><Definition label="Billing details" value="Manage your billing contact and payment details" /><Definition label="Payment requests" value="View invoices and package payment requests" /></dl><div className="account-settings-actions"><Link className="button button-secondary" href="/account-settings/billing">View payment requests or invoices</Link><Link className="button button-secondary" href="/account-settings/billing/details">Billing details</Link></div></section><details className="account-settings-advanced"><summary>Compare plans</summary><WorkspacePackageUpgradeCard currentPackageLabel={props.planLabel} feedbackStatus={props.packageUpgradeStatus} initialBillingPeriod={props.initialBillingPeriod} initialInvoices={props.packageInvoices} options={props.packageOptions} /></details></div>;
}

function UsagePanel({ isSubscriptionExpired, usage }: { isSubscriptionExpired: boolean; usage: UsageMetric[] }) {
  return <section className="account-settings-section"><div className="account-settings-section-head"><div><h2>Usage and limits</h2><p>{isSubscriptionExpired ? "Usage shown reflects the most recently available workspace data." : "Track your current workspace capacity."}</p></div></div><div className="account-settings-usage-list">{usage.map((metric) => <UsageRow key={metric.label} metric={metric} />)}</div></section>;
}

function UsageRow({ metric }: { metric: UsageMetric }) {
  const percentage = metric.limit === null ? 0 : metric.limit > 0 ? Math.min(100, Math.round((metric.current / metric.limit) * 100)) : metric.current > 0 ? 100 : 0;
  const tone = percentage >= 100 ? "limit" : percentage >= 90 ? "high" : percentage >= 75 ? "warning" : "";
  return <div className="account-settings-usage-row"><div><strong>{metric.label}</strong><span>{metric.current.toLocaleString()} / {metric.limit === null ? "Unlimited" : metric.limit.toLocaleString()}</span></div><div className="account-settings-progress"><progress aria-label={`${metric.label}: ${percentage}% used`} max={100} value={percentage} /><span className={tone}>{percentage}% used</span></div></div>;
}

function SummaryCard({ icon, label, title, detail, tone }: { icon: IconName; label: string; title: string; detail: string; tone?: "success" | "warning" }) { return <article className="account-settings-summary-card"><Icon name={icon} /><div><span>{label}</span><strong>{title}</strong><p className={tone ?? ""}>{tone ? <><StatusDot tone={tone} /> </> : null}{detail}</p></div></article>; }
function Definition({ label, value }: { label: string; value: string }) { return <div><dt>{label}</dt><dd>{value}</dd></div>; }
function RowCopy({ title, description }: { title: string; description: string }) { return <span><strong>{title}</strong><small>{description}</small></span>; }
function StatusDot({ tone = "success" }: { tone?: "success" | "warning" }) { return <i aria-hidden="true" className={`account-settings-status-dot${tone === "warning" ? " warning" : ""}`} />; }
function Chevron() { return <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 24 24" width="18"><path d="m9 18 6-6-6-6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" /></svg>; }
type IconName = "settings" | "whatsapp" | "card" | "chart" | "lock" | "pulse";
function Icon({ name }: { name: IconName }) { const paths: Record<IconName, ReactNode> = { settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.1 2.1-.06-.06A1.7 1.7 0 0 0 15.76 19a1.7 1.7 0 0 0-1 1.55V21h-3v-.09A1.7 1.7 0 0 0 10.24 19a1.7 1.7 0 0 0-1.88.34l-.06.06-2.1-2.1.06-.06A1.7 1.7 0 0 0 6.6 15a1.7 1.7 0 0 0-1.55-1H5v-3h.05A1.7 1.7 0 0 0 6.6 9a1.7 1.7 0 0 0-.34-1.88L6.2 7.06l2.1-2.1.06.06A1.7 1.7 0 0 0 10.24 5a1.7 1.7 0 0 0 1-1.55V3h3v.45A1.7 1.7 0 0 0 15.76 5a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.1 2.1-.06.06A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 1.55 1H21v3h-.05A1.7 1.7 0 0 0 19.4 15Z" /></>, whatsapp: <path d="M20 11.5A8 8 0 0 1 8.3 18.6L4 20l1.4-4.1A8 8 0 1 1 20 11.5Zm-11.3-3c.1 2 2.7 4.6 4.7 4.7.5 0 1.6-1.1 1.5-1.5-.1-.2-.8-.6-1-.6s-.5.4-.8.4c-.6 0-1.7-1.1-1.7-1.7 0-.3.4-.6.4-.8 0-.2-.5-.9-.6-1-.4-.1-1.5 1-1.5 1.5Z" />, card: <><rect height="14" rx="2" width="18" x="3" y="5" /><path d="M3 10h18M7 15h3" /></>, chart: <><path d="M4 19V5M4 19h16" /><path d="m7 15 4-4 3 2 5-6" /></>, lock: <><rect height="10" rx="2" width="14" x="5" y="11" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>, pulse: <path d="M3 12h4l2-5 4 10 2-5h6" /> }; return <span aria-hidden="true" className="account-settings-icon"><svg fill="none" viewBox="0 0 24 24">{paths[name]}</svg></span>; }
