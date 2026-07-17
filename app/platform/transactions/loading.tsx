import { PlatformAdminShell } from "@/components/platform-admin-shell";
import { getPlatformAdminNavItems } from "@/lib/platform-admin-nav";

export default function PlatformTransactionsLoading() {
  return (
    <main className="connexa-dark-shell connexa-public-shell">
      <PlatformAdminShell
        adminEmail="Loading..."
        currentKey="transactions"
        description="Loading transaction history."
        items={getPlatformAdminNavItems()}
        title="Transaction history"
      >
        <div className="platform-page-stack platform-transactions-page">
          <section className="content-card settings-dark-panel platform-transactions-panel">
            <p className="table-subtle">Loading transactions...</p>
          </section>
        </div>
      </PlatformAdminShell>
    </main>
  );
}
