import type { InboxFilterKey, InboxSummary } from "@/components/inbox/types";

type WorkspaceHeaderProps = {
  activeFilter: InboxFilterKey;
  canSimulateInbound?: boolean;
  isDetailsVisible?: boolean;
  onToggleDetails?: () => void;
  onOpenSimulateInbound?: () => void;
  totalConversations: number;
  unreadConversations: number;
  summary: InboxSummary;
};

const FILTER_COPY: Record<InboxFilterKey, string> = {
  all: "All live conversations across the shared inbox.",
  hot: "Priority conversations that need operator attention now.",
  mine: "Threads currently assigned to you.",
  unassigned: "Threads waiting for ownership.",
  unread: "Unread work that still needs triage."
};

export function WorkspaceHeader({
  activeFilter,
  canSimulateInbound = false,
  isDetailsVisible = true,
  onToggleDetails,
  onOpenSimulateInbound,
  summary,
  totalConversations,
  unreadConversations
}: WorkspaceHeaderProps) {
  return (
    <div className="inbox-workspace-header">
      <div className="inbox-workspace-header-copy">
        <span className="badge connexa-public-badge">Shared Inbox</span>
        <h2 className="inbox-title">Customer conversations</h2>
        <p className="muted inbox-topbar-copy">{FILTER_COPY[activeFilter]}</p>
      </div>

      <div className="inbox-topbar-side">
        {canSimulateInbound || onToggleDetails ? (
          <div className="inbox-topbar-actions">
            {onToggleDetails ? (
              <button className="button button-secondary compact-button" onClick={onToggleDetails} type="button">
                {isDetailsVisible ? "Hide details" : "Show details"}
              </button>
            ) : null}
            {canSimulateInbound ? (
              <button className="button button-secondary compact-button" onClick={onOpenSimulateInbound} type="button">
                Simulate inbound
              </button>
            ) : null}
          </div>
        ) : null}
        <div className="inbox-topbar-meta">
          <span className="inbox-topbar-count">{totalConversations} conversations</span>
          <span className="inbox-topbar-count">{unreadConversations} unread</span>
          <span className="inbox-topbar-count">{summary.unassigned} unassigned</span>
          <span className="inbox-topbar-count">{summary.pending} pending</span>
        </div>
      </div>
    </div>
  );
}
