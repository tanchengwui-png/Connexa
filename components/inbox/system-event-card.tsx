type SystemEventCardProps = {
  label: string;
  meta: string;
  href?: string | null;
};

export function SystemEventCard({ label, meta, href = null }: SystemEventCardProps) {
  const content = (
    <>
      <strong>{label}</strong>
      <span>{meta}</span>
    </>
  );

  if (href) {
    return (
      <a className="timeline-event timeline-event-link" href={href}>
        {content}
      </a>
    );
  }

  return (
    <div className="timeline-event">
      {content}
    </div>
  );
}
