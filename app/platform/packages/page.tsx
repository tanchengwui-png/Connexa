import { PlatformAdminShell } from "@/components/platform-admin-shell";
import { PlatformPackagesForm } from "@/components/platform-packages-form";
import { getPlatformAdminNavItems } from "@/lib/platform-admin-nav";
import { requireCurrentPlatformAdmin } from "@/lib/platform-auth/current-user";

export default async function PlatformPackagesPage() {
  const admin = await requireCurrentPlatformAdmin();

  return (
    <main className="connexa-dark-shell connexa-public-shell">
      <PlatformAdminShell
        adminEmail={admin.email}
        currentKey="packages"
        description="Choose which packages appear publicly before workspace signup, then control per-package limits for contacts, outbound messages, automations, and campaigns."
        items={getPlatformAdminNavItems()}
        title="Package visibility should be controlled from platform admin."
      >
        <div className="platform-page-stack">
          <div className="platform-admin-toolbar">
            <div className="settings-dark-status-card platform-page-summary-card">
              <span>Current section</span>
              <strong>Packages</strong>
              <p>Visibility, ordering, and package-level feature caps for messaging, contacts, automations, and campaigns are managed from this screen.</p>
            </div>
          </div>

          <PlatformPackagesForm initialPackages={[]} />
        </div>
      </PlatformAdminShell>
    </main>
  );
}
