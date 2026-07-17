import type { ReactNode } from "react";

type MorePageIntroProps = {
  badge: string;
  title: string;
  description: string;
  children?: ReactNode;
};

export function MorePageIntro({ badge, title, description, children }: MorePageIntroProps) {
  return (
    <section className={`more-page-intro${children ? " has-side" : ""}`}>
      <div className="more-page-intro-copy">
        <span className="badge">{badge}</span>
        <h2>{title}</h2>
        <p className="muted">{description}</p>
      </div>
      {children ? <div className="more-page-intro-side">{children}</div> : null}
    </section>
  );
}
