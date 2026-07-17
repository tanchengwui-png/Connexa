import { redirect } from "next/navigation";
import { ConnexaLogo } from "@/components/connexa-logo";
import { PlatformLoginForm } from "@/components/platform-login-form";
import { getCurrentPlatformAdmin } from "@/lib/platform-auth/current-user";
import { resolvePlatformAuthState } from "@/lib/platform-auth/session";
import { getSessionExpiryMessage } from "@/lib/session-timeout";

export default async function PlatformLoginPage(props: {
  searchParams?: Promise<{ reason?: string | string[] }>;
}) {
  const admin = await getCurrentPlatformAdmin();
  const searchParams = await props.searchParams;
  const authState = await resolvePlatformAuthState({ mode: "page" });

  if (admin) {
    redirect("/platform");
  }

  if (authState.status === "restore_required") {
    redirect("/api/platform/auth/session/restore?returnTo=%2Fplatform");
  }

  const sessionMessage = getSessionExpiryMessage(searchParams?.reason);

  return (
    <main className="connexa-dark-shell connexa-public-shell metrica-login-shell">
      <section className="metrica-login-layout">
        <aside className="metrica-login-side">
          <ConnexaLogo priority />

          <div className="metrica-login-copy">
            <span className="metrica-kicker metrica-kicker-platform-owner">Platform owner</span>
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
            <ConnexaLogo centered />
          </div>

          <div className="metrica-login-card-header">
            <span className="metrica-login-card-kicker metrica-login-card-kicker-platform-admin">Platform admin</span>
            <h2>Owner Access</h2>
            <p>Sign in with the platform owner account.</p>
          </div>

          <PlatformLoginForm sessionMessage={sessionMessage} />
        </section>
      </section>
    </main>
  );
}
