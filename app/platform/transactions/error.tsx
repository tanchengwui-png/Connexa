"use client";

import { PlatformAdminShell } from "@/components/platform-admin-shell";
import { getPlatformAdminNavItems } from "@/lib/platform-admin-nav";

export default function PlatformTransactionsError({
  error,
  reset
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <main className="connexa-dark-shell connexa-public-shell">
      <PlatformAdminShell
        adminEmail="Platform owner"
        currentKey="transactions"
        description="Transaction history could not be loaded."
        items={getPlatformAdminNavItems()}
        title="Transaction history"
      >
        <section className="content-card settings-dark-panel platform-transactions-panel">
          <div className="settings-dark-panel-head">
            <div>
              <span>API error</span>
              <h2>Unable to load transaction history</h2>
              <p>{error.message || "Refresh the page or try again later."}</p>
            </div>
            <button className="button button-secondary" onClick={reset} type="button">
              Try again
            </button>
          </div>
        </section>
      </PlatformAdminShell>
    </main>
  );
}
