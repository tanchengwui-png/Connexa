import { ContactsDirectory } from "@/components/contacts-directory";
import { DashboardShell } from "@/components/dashboard-shell";
import { getContactsData } from "@/lib/contacts";

type ContactsPageProps = {
  searchParams?: Promise<{
    q?: string;
    page?: string;
    pageSize?: string;
    tags?: string | string[];
    tag?: string | string[];
    ownerId?: string | string[];
    ownerIds?: string | string[];
    assignee?: string | string[];
    assigneeIds?: string | string[];
  }>;
};

export default async function ContactsPage({ searchParams }: ContactsPageProps) {
  const params = searchParams ? await searchParams : undefined;
  const { agents, contacts, search, pagination } = await getContactsData({
    search: params?.q,
    tags: normalizeQueryList(params?.tags, params?.tag),
    ownerIds: normalizeQueryList(params?.ownerIds, params?.ownerId, params?.assigneeIds, params?.assignee),
    page: params?.page ? Number.parseInt(params.page, 10) : undefined,
    pageSize: params?.pageSize ? Number.parseInt(params.pageSize, 10) : undefined
  });

  return (
    <DashboardShell currentPath="/contacts">
      <section className="contacts-workspace">
        <div className="contacts-mainpane">
          <section className="contacts-grid contacts-grid-single">
            <ContactsDirectory
              agents={agents}
              contacts={contacts}
              pagination={pagination}
              search={search}
            />
          </section>
        </div>
      </section>
    </DashboardShell>
  );
}

function normalizeQueryList(...values: Array<string | string[] | undefined>) {
  return Array.from(
    new Set(
      values
        .flatMap((value) => (Array.isArray(value) ? value : value ? [value] : []))
        .flatMap((value) => value.split(","))
        .map((value) => value.trim())
        .filter(Boolean)
    )
  );
}
