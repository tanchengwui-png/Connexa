import { DashboardShell } from "@/components/dashboard-shell";
import { MorePageIntro } from "@/components/more-page-intro";
import { QuickReplyList } from "@/components/quick-reply-list";
import { getQuickReplyListData } from "@/lib/quick-replies";

export default async function QuickRepliesPage() {
  const { quickReplies, categories, summary } = await getQuickReplyListData();

  return (
    <DashboardShell currentPath="/quick-replies">
      <div className="more-page-stack">
        <MorePageIntro
          badge="Quick replies"
          title="Keep the shared reply library clean, searchable, and reusable."
          description="Standardize saved replies, categories, shortcuts, and attached media so the team sends consistent WhatsApp responses with less manual editing."
        >
          <a className="button button-primary" href="/quick-replies/new">
            Create New Quick Reply
          </a>
        </MorePageIntro>
        <QuickReplyList categories={categories} quickReplies={quickReplies} summary={summary} />
      </div>
    </DashboardShell>
  );
}
