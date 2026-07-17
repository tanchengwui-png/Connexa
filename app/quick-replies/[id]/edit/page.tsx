import { notFound } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { QuickReplyEditor } from "@/components/quick-reply-editor";
import { getQuickReplyById, getQuickReplyEditorData } from "@/lib/quick-replies";

type EditQuickReplyPageProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function EditQuickReplyPage({ params }: EditQuickReplyPageProps) {
  const { id } = await params;
  const [{ quickReplies, categories, mediaAssets }, quickReply] = await Promise.all([
    getQuickReplyEditorData(),
    getQuickReplyById(id)
  ]);

  if (!quickReply) {
    notFound();
  }

  return (
    <DashboardShell currentPath="/quick-replies">
      <QuickReplyEditor
        categories={categories}
        initialReply={quickReply}
        mediaAssets={mediaAssets}
        mode="edit"
        quickReplies={quickReplies}
      />
    </DashboardShell>
  );
}
