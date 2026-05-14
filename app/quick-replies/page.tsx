import { DashboardShell } from "@/components/dashboard-shell";
import { QuickRepliesManager } from "@/components/quick-replies-manager";
import { getQuickRepliesData } from "@/lib/quick-replies";

export default async function QuickRepliesPage() {
  const { quickReplies, summary, categories, mediaAssets } = await getQuickRepliesData();

  return (
    <DashboardShell currentPath="/quick-replies">
      <section className="hero">
        <div>
          <span className="badge">Quick replies</span>
          <h2>Keep common replies fast, consistent, and close to the queue.</h2>
          <p className="muted">
            Templates reduce typing friction and keep handoffs, welcome replies, and
            repeated support answers consistent across the team.
          </p>
        </div>
      </section>

      <section className="metrics-grid">
        <article className="content-card metric-card">
          <div className="metric-label">Total replies</div>
          <div className="metric-value">{summary.total}</div>
          <div className="table-subtle">Reusable templates available to the workspace</div>
        </article>
        <article className="content-card metric-card">
          <div className="metric-label">Replies with media</div>
          <div className="metric-value">{summary.withMedia}</div>
          <div className="table-subtle">Templates that include shared media attachments</div>
        </article>
      </section>

      <QuickRepliesManager categories={categories} mediaAssets={mediaAssets} quickReplies={quickReplies} />
    </DashboardShell>
  );
}
