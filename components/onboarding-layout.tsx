import { ReactNode } from "react";

type OnboardingLayoutProps = {
  badge?: string;
  title: string;
  subtitle: string;
  children: ReactNode;
  sidebar: ReactNode;
};

export function OnboardingLayout({
  badge,
  title,
  subtitle,
  children,
  sidebar
}: OnboardingLayoutProps) {
  return (
    <section className="wa-onboarding-shell">
      <div className="wa-onboarding-main">
        <div className="wa-onboarding-header">
          {badge ? <span className="badge connexa-public-badge">{badge}</span> : null}
          <div className="wa-onboarding-copy">
            <h1>{title}</h1>
            <p>{subtitle}</p>
          </div>
        </div>

        <div className="wa-onboarding-body">{children}</div>
      </div>

      <aside className="wa-onboarding-sidebar">{sidebar}</aside>
    </section>
  );
}
