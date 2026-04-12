type QueueEmptyStateProps = {
  description: string;
  title: string;
};

export function QueueEmptyState({ description, title }: QueueEmptyStateProps) {
  return (
    <div className="inbox-queue-empty">
      <div className="inbox-empty-illustration" aria-hidden="true" />
      <strong>{title}</strong>
      <p className="muted">{description}</p>
    </div>
  );
}
