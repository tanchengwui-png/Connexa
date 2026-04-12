import { CountBadge } from "@/components/inbox/count-badge";

type InboxQueueHeaderProps = {
  helperText: string;
  title: string;
  visibleCount: number;
};

export function InboxQueueHeader({ helperText, title, visibleCount }: InboxQueueHeaderProps) {
  return (
    <div className="inbox-panel-head inbox-list-head">
      <div className="inbox-list-title-block">
        <h3 className="card-title">{title}</h3>
        <p className="muted">{helperText}</p>
      </div>
      <CountBadge>{`${visibleCount} visible`}</CountBadge>
    </div>
  );
}
