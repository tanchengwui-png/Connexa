import { DashboardShell } from "@/components/dashboard-shell";
import { MediaLibraryManager } from "@/components/media-library-manager";
import { getMediaLibraryData } from "@/lib/media-library";

export default async function MediaLibraryPage() {
  const data = await getMediaLibraryData();

  return (
    <DashboardShell currentPath="/media-library">
      <section className="hero">
        <div>
          <span className="badge">Media library</span>
          <h2>Centralize the images, voice notes, and videos that automation can reuse.</h2>
          <p className="muted">
            Upload approved WhatsApp media once here. Automation rules will pick from this library instead of uploading files inline.
          </p>
        </div>
      </section>

      <MediaLibraryManager assets={data.assets} limits={data.limits} />
    </DashboardShell>
  );
}
