import type { ReactNode } from "react";

type MorePageIntroProps = {
  badge: string;
  title: string;
  description: string;
  children?: ReactNode;
  headingAs?: "h1" | "h2";
};

export function MorePageIntro({ badge, title, description, children, headingAs: Heading = "h2" }: MorePageIntroProps) {
  return (
    <section className={`more-page-intro${children ? " has-side" : ""}`}>
      <div className="more-page-intro-copy">
        <span className="badge">{badge}</span>
        <Heading>{title}</Heading>
        <p className="muted">{description}</p>
      </div>
      {children ? <div className="more-page-intro-side">{children}</div> : null}
    </section>
  );
}
