type TagChipProps = {
  children: string;
  onRemove?: () => void;
  tone?: "default" | "hot" | "owner" | "channel" | "status" | "unassigned";
};

export function TagChip({ children, onRemove, tone = "default" }: TagChipProps) {
  return (
    <span className={`inbox-tag-chip tone-${tone}${onRemove ? " removable" : ""}`}>
      <span>{children}</span>
      {onRemove ? (
        <button
          aria-label={`Remove tag ${children}`}
          className="inbox-tag-chip-remove"
          onClick={onRemove}
          type="button"
        >
          ×
        </button>
      ) : null}
    </span>
  );
}
