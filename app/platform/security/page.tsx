import { PlatformAdminShell } from "@/components/platform-admin-shell";
import { PlatformUserSecurityManager } from "@/components/platform-user-security-manager";
import { getPlatformAdminNavItems } from "@/lib/platform-admin-nav";
import { requireCurrentPlatformAdmin } from "@/lib/platform-auth/current-user";
import { getPlatformSecurityAdminView } from "@/lib/platform-security";

export default async function PlatformSecurityPage() {
  const [admin, securityView] = await Promise.all([
    requireCurrentPlatformAdmin(),
    getPlatformSecurityAdminView()
  ]);

  return (
    <main className="connexa-dark-shell connexa-public-shell">
      <PlatformAdminShell
        adminEmail={admin.email}
        currentKey="security"
        description="Review user access posture, inspect safe account details, and use reset-link delivery without ever exposing or setting passwords."
        items={getPlatformAdminNavItems()}
        title="User management and account security should stay auditable, least-privilege, and email-link driven."
      >
        <div className="platform-page-stack">
          <div className="platform-admin-toolbar">
            <div className="settings-dark-status-card platform-page-summary-card">
              <span>Current section</span>
              <strong>Security</strong>
              <p>Platform admins can inspect safe user records, trigger reset emails, and review account-security audit events here.</p>
            </div>
          </div>

          <PlatformUserSecurityManager
            resetAvailability={securityView.resetAvailability}
            users={securityView.users}
          />
        </div>
      </PlatformAdminShell>
    </main>
  );
}
