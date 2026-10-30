import { CountBadge } from "@/components/inbox/count-badge";

type InboxQueueHeaderProps = {
  helperText: string;
  isFiltered: boolean;
  loadedCount: number;
  title: string;
  totalCount: number;
  visibleCount: number;
};

export function InboxQueueHeader({
  helperText,
  isFiltered,
  loadedCount,
  title,
  totalCount,
  visibleCount
}: InboxQueueHeaderProps) {
  const countLabel = isFiltered
    ? `${visibleCount} matching · ${loadedCount} of ${totalCount} loaded`
    : `Showing ${loadedCount} of ${totalCount} conversations`;

  return (
    <div className="inbox-panel-head inbox-list-head">
      <div className="inbox-list-title-block">
        <h3 className="card-title">{title}</h3>
        {helperText ? <p className="muted">{helperText}</p> : null}
      </div>
      <CountBadge>{countLabel}</CountBadge>
    </div>
  );
}
