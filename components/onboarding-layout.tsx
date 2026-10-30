import { ReactNode } from "react";

type OnboardingLayoutProps = {
  badge?: string;
  title: string;
  subtitle: string;
  children: ReactNode;
  sidebar: ReactNode;
  variant?: "guided" | "settings";
};

export function OnboardingLayout({
  badge,
  title,
  subtitle,
  children,
  sidebar,
  variant = "settings"
}: OnboardingLayoutProps) {
  return (
    <section className={`wa-onboarding-shell wa-onboarding-shell-${variant}`}>
      <div className="wa-onboarding-main">
        <div className="wa-onboarding-header">
          <div className="wa-onboarding-copy">
            {badge ? (
              <span className="wa-onboarding-breadcrumb">
                <span aria-hidden="true">‹</span>
                {badge}
              </span>
            ) : null}
            <h1>{title}</h1>
            <p>{subtitle}</p>
          </div>
          {variant === "guided" ? <OnboardingHeroVisual /> : null}
        </div>

        {variant === "guided" ? <div className="wa-onboarding-progress-band">{sidebar}</div> : null}
        <div className="wa-onboarding-body">{children}</div>
      </div>

      {variant === "settings" ? <aside className="wa-onboarding-sidebar">{sidebar}</aside> : null}
    </section>
  );
}

function OnboardingHeroVisual() {
  return (
    <div className="wa-onboarding-hero-visual" aria-hidden="true">
      <span className="wa-hero-note">Turn conversations<br />into growth</span>
      <div className="wa-hero-device">
        <div className="wa-hero-whatsapp">
          <svg fill="none" height="56" viewBox="0 0 64 64" width="56">
            <circle cx="32" cy="32" r="21" stroke="currentColor" strokeWidth="4" />
            <path d="M21 47l2.6-8A19 19 0 1 1 28 48.2L21 47Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="3" />
            <path d="M25 23c1.2-1.2 2.4-.6 3 .7l2 4c.4.9.2 1.7-.6 2.5l-1.3 1.2c1.7 3.8 4.5 6.6 8.4 8.3l1.1-1.5c.7-.8 1.5-1 2.4-.5l4.1 1.9c1.4.7 1.8 1.8.8 3.1-1.5 2-3.7 3.2-6.2 2.7-9-1.8-16.4-9.1-18-18-.4-1.8.7-3.3 2.3-4.4Z" fill="currentColor" />
          </svg>
        </div>
        <span className="wa-hero-message-line line-one" />
        <span className="wa-hero-message-line line-two" />
      </div>
      <ul className="wa-hero-benefits">
        <li>Customer support</li>
        <li>Marketing campaigns</li>
        <li>Automated workflows</li>
        <li>Shared team inbox</li>
      </ul>
    </div>
  );
}
