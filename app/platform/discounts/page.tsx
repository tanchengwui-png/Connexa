import { PlatformAdminShell } from "@/components/platform-admin-shell";
import { PlatformDiscountsManager } from "@/components/platform-discounts-manager";
import { getPlatformAdminNavItems } from "@/lib/platform-admin-nav";
import { requireCurrentPlatformAdmin } from "@/lib/platform-auth/current-user";
import { getPlatformDiscountAdminView } from "@/lib/platform-discounts";

export default async function PlatformDiscountsPage() {
  const [admin, discounts] = await Promise.all([requireCurrentPlatformAdmin(), getPlatformDiscountAdminView()]);

  return (
    <main className="connexa-dark-shell connexa-public-shell">
      <PlatformAdminShell
        adminEmail={admin.email}
        currentKey="discounts"
        description="Generate and maintain package checkout discount codes from one platform owner screen."
        items={getPlatformAdminNavItems()}
        title="Discount codes should be easy to issue, inspect, and retire without touching package pricing."
      >
        <div className="platform-page-stack">
          <div className="platform-admin-toolbar">
            <div className="settings-dark-status-card platform-page-summary-card">
              <span>Current section</span>
              <strong>Discounts</strong>
              <p>Generate checkout codes, control expiry, and keep redemption history visible from one owner screen.</p>
            </div>
          </div>

          <PlatformDiscountsManager initialDiscounts={discounts} />
        </div>
      </PlatformAdminShell>
    </main>
  );
}
