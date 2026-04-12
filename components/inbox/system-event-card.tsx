type SystemEventCardProps = {
  label: string;
  meta: string;
};

export function SystemEventCard({ label, meta }: SystemEventCardProps) {
  return (
    <div className="timeline-event">
      <strong>{label}</strong>
      <span>{meta}</span>
    </div>
  );
}
