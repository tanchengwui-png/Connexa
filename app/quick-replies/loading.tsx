import { DashboardShell } from "@/components/dashboard-shell";

export default function QuickRepliesLoading() {
  return (
    <DashboardShell currentPath="/quick-replies">
      <div className="more-page-stack">
        <section className="auth-page-hero auth-page-hero-compact">
          <div className="auth-page-hero-copy">
            <span className="auth-page-kicker">Quick replies</span>
            <h2>Quick Reply Library</h2>
            <p>Loading quick replies...</p>
          </div>
        </section>
        <section className="content-card quick-replies-list-empty">
          <strong>Preparing quick reply data</strong>
          <span>Loading the shared library, categories, and editor data.</span>
        </section>
      </div>
    </DashboardShell>
  );
}
