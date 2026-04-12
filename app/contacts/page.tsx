import { ContactCreateCard } from "@/components/contact-create-card";
import { ContactsDirectory } from "@/components/contacts-directory";
import { DashboardShell } from "@/components/dashboard-shell";
import { getContactsData } from "@/lib/contacts";

type ContactsPageProps = {
  searchParams?: Promise<{
    q?: string;
  }>;
};

export default async function ContactsPage({ searchParams }: ContactsPageProps) {
  const params = searchParams ? await searchParams : undefined;
  const { agents, contacts, summary, search } = await getContactsData(params?.q);

  return (
    <DashboardShell currentPath="/contacts">
      <section className="hero contacts-hero">
        <div>
          <span className="badge">Contacts</span>
          <h2>Keep customer identity, tags, and notes visible beyond the queue.</h2>
          <p className="muted">
            Searchable contacts make the inbox more useful by keeping customer context,
            hot-lead signals, and internal memory in the same operating layer.
          </p>
        </div>
      </section>

      <section className="metrics-grid contacts-metrics-grid contacts-metrics-grid-compact">
        <article className="content-card metric-card contacts-metric-card">
          <div className="metric-label">Total contacts</div>
          <div className="metric-value">{summary.total}</div>
          <div className="table-subtle">Directory visible to the workspace</div>
        </article>
        <article className="content-card metric-card contacts-metric-card">
          <div className="metric-label">Active</div>
          <div className="metric-value">{summary.active}</div>
          <div className="table-subtle">Available for inbox and note workflows</div>
        </article>
        <article className="content-card metric-card contacts-metric-card">
          <div className="metric-label">Hot leads</div>
          <div className="metric-value">{summary.hotLeads}</div>
          <div className="table-subtle">Marked for closer attention</div>
        </article>
        <article className="content-card metric-card contacts-metric-card">
          <div className="metric-label">Recent activity</div>
          <div className="metric-value">{summary.recentlyActive}</div>
          <div className="table-subtle">Interacted within the last 24 hours</div>
        </article>
      </section>

      <section className="contacts-workspace">
        <aside className="contacts-sidepane">
          <ContactCreateCard agents={agents} />
        </aside>

        <div className="contacts-mainpane">
          <section className="contacts-grid contacts-grid-single">
            <ContactsDirectory agents={agents} contacts={contacts} search={search} />
          </section>
        </div>
      </section>
    </DashboardShell>
  );
}
