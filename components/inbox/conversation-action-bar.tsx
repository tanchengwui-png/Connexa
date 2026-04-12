"use client";

import { useRef, useState } from "react";
import {
  AssignIcon,
  MoreIcon,
  SnoozeIcon,
  StatusIcon,
  TagIcon
} from "@/components/inbox/icons";
import { PortalDropdown } from "@/components/inbox/portal-dropdown";
import type { InboxAgent, InboxSelectedConversation } from "@/components/inbox/types";

type ConversationActionBarProps = {
  agents: InboxAgent[];
  onAddTag: (tag?: string) => void;
  onSnooze: () => void;
  onUpdateConversation: (updates: {
    status?: "OPEN" | "PENDING" | "CLOSED";
    assigneeId?: string | null;
  }) => void;
  selectedConversation: NonNullable<InboxSelectedConversation>;
};

const TAG_SUGGESTIONS = ["whatsapp", "priority", "follow-up", "viewing", "quote sent"] as const;
const STATUS_OPTIONS = [
  ["OPEN", "Open"],
  ["PENDING", "Pending"],
  ["CLOSED", "Closed"]
] as const;

export function ConversationActionBar({
  agents,
  onAddTag,
  onSnooze,
  onUpdateConversation,
  selectedConversation
}: ConversationActionBarProps) {
  const assignButtonRef = useRef<HTMLButtonElement | null>(null);
  const statusButtonRef = useRef<HTMLButtonElement | null>(null);
  const tagButtonRef = useRef<HTMLButtonElement | null>(null);
  const moreButtonRef = useRef<HTMLButtonElement | null>(null);
  const [openMenu, setOpenMenu] = useState<"assign" | "more" | "status" | "tag" | null>(null);

  return (
    <div className="inbox-thread-actions">
      <button
        className="inbox-action-button"
        onClick={() => setOpenMenu((current) => (current === "assign" ? null : "assign"))}
        ref={assignButtonRef}
        type="button"
      >
        <AssignIcon />
        <span>Owner</span>
        <strong>{selectedConversation.assignee}</strong>
      </button>

      <button
        className="inbox-action-button"
        onClick={() => setOpenMenu((current) => (current === "status" ? null : "status"))}
        ref={statusButtonRef}
        type="button"
      >
        <StatusIcon />
        <span>Status</span>
        <strong>{selectedConversation.status}</strong>
      </button>

      <button
        className="inbox-action-button"
        onClick={() => setOpenMenu((current) => (current === "tag" ? null : "tag"))}
        ref={tagButtonRef}
        type="button"
      >
        <TagIcon />
        <span>Label</span>
      </button>

      <button
        className="inbox-action-button"
        onClick={onSnooze}
        type="button"
      >
        <SnoozeIcon />
        <span>{selectedConversation.snoozedUntil ? "Snooze" : "Later"}</span>
      </button>

      <button
        className="inbox-action-icon"
        onClick={() => setOpenMenu((current) => (current === "more" ? null : "more"))}
        ref={moreButtonRef}
        type="button"
      >
        <MoreIcon />
      </button>

      <PortalDropdown
        align="start"
        anchorRef={assignButtonRef}
        className="inbox-portal-menu"
        matchTriggerWidth
        onClose={() => setOpenMenu(null)}
        open={openMenu === "assign"}
      >
        <div className="inbox-menu-panel">
          <div className="inbox-menu-panel-head">
            <strong>Assign conversation</strong>
            <span>Ownership updates route this thread immediately.</span>
          </div>
          <button
            className={`inbox-menu-item${selectedConversation.assigneeId ? "" : " active"}`}
            onClick={() => {
              onUpdateConversation({ assigneeId: null });
              setOpenMenu(null);
            }}
            type="button"
          >
            <span>Unassigned</span>
          </button>
          {agents.map((agent) => (
            <button
              className={`inbox-menu-item${selectedConversation.assigneeId === agent.id ? " active" : ""}`}
              key={agent.id}
              onClick={() => {
                onUpdateConversation({ assigneeId: agent.id });
                setOpenMenu(null);
              }}
              type="button"
            >
              <span>{agent.name}</span>
            </button>
          ))}
        </div>
      </PortalDropdown>

      <PortalDropdown
        align="start"
        anchorRef={statusButtonRef}
        className="inbox-portal-menu"
        matchTriggerWidth
        onClose={() => setOpenMenu(null)}
        open={openMenu === "status"}
      >
        <div className="inbox-menu-panel">
          <div className="inbox-menu-panel-head">
            <strong>Update status</strong>
            <span>Move the thread between active states.</span>
          </div>
          {STATUS_OPTIONS.map(([value, label]) => (
            <button
              className={`inbox-menu-item${selectedConversation.status.toUpperCase() === value ? " active" : ""}`}
              key={value}
              onClick={() => {
                onUpdateConversation({ status: value });
                setOpenMenu(null);
              }}
              type="button"
            >
              <span>{label}</span>
            </button>
          ))}
        </div>
      </PortalDropdown>

      <PortalDropdown
        align="start"
        anchorRef={tagButtonRef}
        className="inbox-portal-menu"
        onClose={() => setOpenMenu(null)}
        open={openMenu === "tag"}
      >
        <div className="inbox-menu-panel">
          <div className="inbox-menu-panel-head">
            <strong>Apply tag</strong>
            <span>Use a quick label or create a custom tag.</span>
          </div>
          {TAG_SUGGESTIONS.map((tag) => (
            <button
              className={`inbox-menu-item${selectedConversation.tags.includes(tag) ? " active" : ""}`}
              key={tag}
              onClick={() => {
                onAddTag(tag);
                setOpenMenu(null);
              }}
              type="button"
            >
              <span>{tag}</span>
            </button>
          ))}
          <button
            className="inbox-menu-item"
            onClick={() => {
              onAddTag();
              setOpenMenu(null);
            }}
            type="button"
          >
            <span>Custom tag...</span>
          </button>
        </div>
      </PortalDropdown>

      <PortalDropdown
        align="end"
        anchorRef={moreButtonRef}
        className="inbox-portal-menu"
        onClose={() => setOpenMenu(null)}
        open={openMenu === "more"}
      >
        <div className="inbox-menu-panel">
          <div className="inbox-menu-panel-head">
            <strong>Conversation actions</strong>
            <span>Secondary actions for this thread.</span>
          </div>
          <button
            className="inbox-menu-item"
            onClick={() => {
              onSnooze();
              setOpenMenu(null);
            }}
            type="button"
          >
            <span>{selectedConversation.snoozedUntil ? "Edit snooze" : "Snooze conversation"}</span>
          </button>
        </div>
      </PortalDropdown>
    </div>
  );
}
