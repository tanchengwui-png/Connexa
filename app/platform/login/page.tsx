import { redirect } from "next/navigation";
import { ConnexaLogo } from "@/components/connexa-logo";
import { PlatformLoginForm } from "@/components/platform-login-form";
import { getCurrentPlatformAdmin } from "@/lib/platform-auth/current-user";

export default async function PlatformLoginPage() {
  const admin = await getCurrentPlatformAdmin();

  if (admin) {
    redirect("/platform");
  }

  return (
    <main className="connexa-dark-shell connexa-public-shell metrica-login-shell">
      <section className="metrica-login-layout">
        <aside className="metrica-login-side">
          <ConnexaLogo dark priority />

          <div className="metrica-login-copy">
            <span className="metrica-kicker">Platform owner</span>
            <h1>Control platform email delivery from one locked-down page.</h1>
            <p>Use this login for platform SMTP, brand mail settings, and owner-level operational checks.</p>
          </div>

          <div className="metrica-login-visual" aria-hidden="true">
            <div className="metrica-login-orb orb-one" />
            <div className="metrica-login-orb orb-two" />
            <div className="metrica-login-orb orb-three" />
          </div>
        </aside>

        <section className="metrica-login-card">
          <div className="metrica-login-card-brand">
            <ConnexaLogo centered dark />
          </div>

          <div className="metrica-login-card-header">
            <span className="metrica-login-card-kicker">Platform admin</span>
            <h2>Owner Access</h2>
            <p>Sign in with the platform owner account.</p>
          </div>

          <PlatformLoginForm />
        </section>
      </section>
    </main>
  );
}
