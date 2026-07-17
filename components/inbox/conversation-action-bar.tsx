"use client";

import { useRef, useState } from "react";
import {
  AssignIcon,
  MuteIcon,
  MoreIcon,
  SnoozeIcon,
  StatusIcon,
  TagIcon
} from "@/components/inbox/icons";
import { PortalDropdown } from "@/components/inbox/portal-dropdown";
import type { InboxAgent, InboxCurrentAgent, InboxSelectedConversation } from "@/components/inbox/types";

type ConversationActionBarProps = {
  agents: InboxAgent[];
  currentAgent: InboxCurrentAgent;
  isMuteSupported: boolean;
  onAddTag: (tag?: string) => void;
  onSetMute: (duration: "8h" | "1w" | "always" | null) => void;
  onSnoozeConversation: () => void;
  onTakeOverConversation: () => void;
  onUpdateConversation: (updates: {
    status?: "OPEN" | "PENDING" | "CLOSED";
    assigneeId?: string | null;
    teammateIds?: string[];
    snoozedUntil?: string | null;
    snoozeReason?: string | null;
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
  currentAgent,
  isMuteSupported,
  onAddTag,
  onSetMute,
  onSnoozeConversation,
  onTakeOverConversation,
  onUpdateConversation,
  selectedConversation
}: ConversationActionBarProps) {
  const assignButtonRef = useRef<HTMLButtonElement | null>(null);
  const muteButtonRef = useRef<HTMLButtonElement | null>(null);
  const statusButtonRef = useRef<HTMLButtonElement | null>(null);
  const tagButtonRef = useRef<HTMLButtonElement | null>(null);
  const moreButtonRef = useRef<HTMLButtonElement | null>(null);
  const [openMenu, setOpenMenu] = useState<"assign" | "more" | "mute" | "status" | "tag" | null>(null);
  const canTakeOverConversation = Boolean(selectedConversation.assigneeId && selectedConversation.assigneeId !== currentAgent.id);

  return (
    <div className="inbox-thread-actions">
      {canTakeOverConversation ? (
        <button className="inbox-action-button" onClick={onTakeOverConversation} type="button">
          <AssignIcon />
          <span>Take over</span>
          <strong>{selectedConversation.assignee}</strong>
        </button>
      ) : null}

      <button
        className="inbox-action-button"
        onClick={() => setOpenMenu((current) => (current === "assign" ? null : "assign"))}
        ref={assignButtonRef}
        type="button"
      >
        <AssignIcon />
        <span>Primary owner</span>
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
        onClick={onSnoozeConversation}
        type="button"
      >
        <SnoozeIcon />
        <span>Reminder</span>
        <strong>{selectedConversation.isSnoozed ? "Active" : "Set"}</strong>
      </button>

      {isMuteSupported ? (
        <button
          className="inbox-action-button"
          onClick={() => setOpenMenu((current) => (current === "mute" ? null : "mute"))}
          ref={muteButtonRef}
          type="button"
        >
          <MuteIcon />
          <span>Mute</span>
          <strong>{selectedConversation.isMuted ? "On" : "Off"}</strong>
        </button>
      ) : null}

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
            <strong>Assignment</strong>
            <span>Set one primary owner and add supporting teammates.</span>
          </div>
          <div className="inbox-menu-section-label">Primary owner</div>
          <button
            className={`inbox-menu-item${selectedConversation.assigneeId ? "" : " active"}`}
            onClick={() => {
              onUpdateConversation({ assigneeId: null });
              setOpenMenu(null);
            }}
            type="button"
          >
            <span>No primary owner</span>
          </button>
          {agents.map((agent) => (
            <button
              className={`inbox-menu-item${selectedConversation.assigneeId === agent.id ? " active" : ""}`}
              key={agent.id}
              onClick={() => {
                onUpdateConversation({
                  assigneeId: agent.id,
                  teammateIds: selectedConversation.teammateIds.filter((id) => id !== agent.id)
                });
                setOpenMenu(null);
              }}
              type="button"
            >
              <span>{agent.name}</span>
            </button>
          ))}

          <div className="inbox-menu-section-label">Supporting teammates</div>
          {agents.map((agent) => {
            const isActive = selectedConversation.teammateIds.includes(agent.id);
            return (
              <button
                className={`inbox-menu-item${isActive ? " active" : ""}`}
                key={`teammate-${agent.id}`}
                onClick={() => {
                  if (selectedConversation.assigneeId === agent.id) {
                    return;
                  }
                  const nextTeammateIds = isActive
                    ? selectedConversation.teammateIds.filter((id) => id !== agent.id)
                    : [...selectedConversation.teammateIds, agent.id];
                  onUpdateConversation({ teammateIds: nextTeammateIds });
                }}
                type="button"
              >
                <span>{agent.name}</span>
              </button>
            );
          })}
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
        anchorRef={muteButtonRef}
        className="inbox-portal-menu"
        matchTriggerWidth
        onClose={() => setOpenMenu(null)}
        open={openMenu === "mute"}
      >
        <div className="inbox-menu-panel">
          <div className="inbox-menu-panel-head">
            <strong>{selectedConversation.isMuted ? "Mute settings" : "Mute conversation"}</strong>
            <span>Personal WhatsApp only. Syncs back into the inbox in realtime.</span>
          </div>
          <button
            className="inbox-menu-item"
            onClick={() => {
              onSetMute("8h");
              setOpenMenu(null);
            }}
            type="button"
          >
            <span>Mute for 8 hours</span>
          </button>
          <button
            className="inbox-menu-item"
            onClick={() => {
              onSetMute("1w");
              setOpenMenu(null);
            }}
            type="button"
          >
            <span>Mute for 1 week</span>
          </button>
          <button
            className="inbox-menu-item"
            onClick={() => {
              onSetMute("always");
              setOpenMenu(null);
            }}
            type="button"
          >
            <span>Mute always</span>
          </button>
          {selectedConversation.isMuted ? (
            <button
              className="inbox-menu-item"
              onClick={() => {
                onSetMute(null);
                setOpenMenu(null);
              }}
              type="button"
            >
              <span>Unmute conversation</span>
            </button>
          ) : null}
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
            <span>Secondary controls for this thread.</span>
          </div>
          <button
            className="inbox-menu-item"
            onClick={() => {
              onSnoozeConversation();
              setOpenMenu(null);
            }}
            type="button"
          >
            <span>{selectedConversation.isSnoozed ? "Edit snooze reminder" : "Set snooze reminder"}</span>
          </button>
          {selectedConversation.isSnoozed ? (
            <button
              className="inbox-menu-item"
              onClick={() => {
                onUpdateConversation({ snoozedUntil: null, snoozeReason: null });
                setOpenMenu(null);
              }}
              type="button"
            >
              <span>Unsnooze conversation</span>
            </button>
          ) : null}
        </div>
      </PortalDropdown>
    </div>
  );
}
