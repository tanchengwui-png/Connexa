type CountBadgeProps = {
  children: string;
};

export function CountBadge({ children }: CountBadgeProps) {
  return <span className="inbox-count-badge">{children}</span>;
}
