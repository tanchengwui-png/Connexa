import { DashboardShell } from "@/components/dashboard-shell";
import { MediaLibraryManager } from "@/components/media-library-manager";
import { MorePageIntro } from "@/components/more-page-intro";
import { getMediaLibraryData } from "@/lib/media-library";

export default async function MediaLibraryPage() {
  const data = await getMediaLibraryData();

  return (
    <DashboardShell currentPath="/media-library">
      <div className="more-page-stack">
        <MorePageIntro
          badge="Media library"
          title="Store approved WhatsApp media in one operational library."
          description="Keep reusable images, videos, audio, and documents easy to upload, review, and attach across automation and quick-reply workflows."
        />
        <MediaLibraryManager assets={data.assets} limits={data.limits} />
      </div>
    </DashboardShell>
  );
}
