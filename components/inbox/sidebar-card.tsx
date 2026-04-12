import type { ReactNode } from "react";

type SidebarCardProps = {
  eyebrow: string;
  title: string;
  children: ReactNode;
  hideHeader?: boolean;
};

export function SidebarCard({ eyebrow, title, children, hideHeader = false }: SidebarCardProps) {
  return (
    <section className="inbox-detail-card">
      {hideHeader ? null : (
        <div className="inbox-detail-card-head">
          <span>{eyebrow}</span>
          <h3>{title}</h3>
        </div>
      )}
      {children}
    </section>
  );
}
