import { DashboardShell } from "@/components/dashboard-shell";
import { QuickReplyEditor } from "@/components/quick-reply-editor";
import { getQuickReplyEditorData } from "@/lib/quick-replies";

export default async function NewQuickReplyPage() {
  const { quickReplies, categories, mediaAssets } = await getQuickReplyEditorData();

  return (
    <DashboardShell currentPath="/quick-replies">
      <QuickReplyEditor
        categories={categories}
        mediaAssets={mediaAssets}
        mode="create"
        quickReplies={quickReplies}
      />
    </DashboardShell>
  );
}
