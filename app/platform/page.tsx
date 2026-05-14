import { PlatformAdminShell } from "@/components/platform-admin-shell";
import { PlatformDatabaseResetCard } from "@/components/platform-database-reset-card";
import { PlatformSmtpSettingsForm } from "@/components/platform-smtp-settings-form";
import { getPlatformAdminNavItems } from "@/lib/platform-admin-nav";
import { requireCurrentPlatformAdmin } from "@/lib/platform-auth/current-user";
import { getPlatformConfigForAdmin } from "@/lib/platform-config";

export default async function PlatformPage() {
  const [admin, config] = await Promise.all([requireCurrentPlatformAdmin(), getPlatformConfigForAdmin()]);

  return (
    <main className="connexa-dark-shell connexa-public-shell">
      <PlatformAdminShell
        adminEmail={admin.email}
        currentKey="email"
        description="Control outbound email delivery and package checkout activation from one platform owner console."
        items={getPlatformAdminNavItems()}
        title="Delivery, checkout, and workflow timeout settings should live in one operational screen."
      >
        <PlatformSmtpSettingsForm adminEmail={admin.email} initialValues={config} />
        <PlatformDatabaseResetCard />
      </PlatformAdminShell>
    </main>
  );
}
