import { ConversationActionBar } from "@/components/inbox/conversation-action-bar";
import { StatusChip } from "@/components/inbox/status-chip";
import { TagChip } from "@/components/inbox/tag-chip";
import type { InboxAgent, InboxCurrentAgent, InboxSelectedConversation } from "@/components/inbox/types";

type ActiveConversationHeaderProps = {
  agents: InboxAgent[];
  currentAgent: InboxCurrentAgent;
  onAddTag: (tag?: string) => void;
  onSnoozeConversation: () => void;
  onTakeOverConversation: () => void;
  onUpdateConversation: (updates: {
    status?: "OPEN" | "PENDING" | "CLOSED";
    assigneeId?: string | null;
    teammateIds?: string[];
    snoozedUntil?: string | null;
  }) => void;
  selectedConversation: NonNullable<InboxSelectedConversation>;
};

export function ActiveConversationHeader({
  agents,
  currentAgent,
  onAddTag,
  onSnoozeConversation,
  onTakeOverConversation,
  onUpdateConversation,
  selectedConversation
}: ActiveConversationHeaderProps) {
  const automationSummary = getAutomationSummary(selectedConversation);

  return (
    <div className="inbox-thread-top">
      <div className="inbox-thread-primary">
        <div className="whatsapp-thread-avatar">
          {selectedConversation.photoUrl ? (
            <img
              alt=""
              className="chatbox-avatar-image"
              src={`/api/conversations/${selectedConversation.id}/avatar`}
            />
          ) : (
            selectedConversation.contactName.slice(0, 1).toUpperCase()
          )}
        </div>
          <div className="inbox-thread-primary-copy">
            <div className="inbox-thread-name-row">
              <h3 className="card-title">{selectedConversation.contactName}</h3>
              <StatusChip>{selectedConversation.status}</StatusChip>
            </div>
            <div className="inbox-thread-subline">
              {selectedConversation.isGroup ? null : <span>{selectedConversation.phone}</span>}
              <span>Primary owner: {selectedConversation.assignee}</span>
              <span>
                Team: {selectedConversation.teammates.length ? selectedConversation.teammates.map((teammate) => teammate.name).join(", ") : "None"}
              </span>
              {selectedConversation.scheduledCount ? (
                <a className="inbox-scheduled-link" href={`/scheduled-messages?conversationId=${selectedConversation.id}`}>
                  {selectedConversation.scheduledCount} scheduled
                  {selectedConversation.nextScheduledAt ? ` · next ${selectedConversation.nextScheduledAt}` : ""}
                </a>
              ) : null}
              <a className="inbox-scheduled-link" href={`/message-logs?conversationId=${selectedConversation.id}`}>
                Message logs
              </a>
              {selectedConversation.tags.length ? <span>{selectedConversation.tags.length} labels</span> : null}
            </div>
            {automationSummary ? (
              <div className="inbox-thread-chip-row">
                <TagChip tone={automationSummary.tone}>{automationSummary.label}</TagChip>
                <span className="inbox-thread-automation-copy">{automationSummary.detail}</span>
                {automationSummary.linkHref ? (
                  <a className="inbox-scheduled-link" href={automationSummary.linkHref}>
                    {automationSummary.linkLabel}
                  </a>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

      <ConversationActionBar
        agents={agents}
        currentAgent={currentAgent}
        onAddTag={onAddTag}
        onSnoozeConversation={onSnoozeConversation}
        onTakeOverConversation={onTakeOverConversation}
        onUpdateConversation={onUpdateConversation}
        selectedConversation={selectedConversation}
      />
    </div>
  );
}

function getAutomationSummary(selectedConversation: NonNullable<InboxSelectedConversation>) {
  const automation = selectedConversation.automation;

  if (!automation) {
    return null;
  }

  const pausedUntilIso = automation.automationPausedUntilIso;
  const nextScheduledAtIso = selectedConversation.nextScheduledAtIso;
  const isPaused =
    Boolean(pausedUntilIso) && new Date(pausedUntilIso as string).getTime() > Date.now();
  const hasScheduledReply =
    Boolean(nextScheduledAtIso) && new Date(nextScheduledAtIso as string).getTime() > Date.now();
  const ruleLabel = automation.lastMatchedRuleName?.trim() || "Automation rule";
  const flowStepLabel = automation.activeFlowStep ? formatAutomationStepLabel(automation.activeFlowStep) : null;

  if (isPaused) {
    return {
      tone: "status" as const,
      label: "Automation paused",
      detail: hasScheduledReply
        ? `Resumes ${automation.automationPausedUntil} and the next auto reply is scheduled for ${selectedConversation.nextScheduledAt}.`
        : `Resumes ${automation.automationPausedUntil}. Human takeover or cooldown is still active.`,
      linkHref: selectedConversation.scheduledCount
        ? `/scheduled-messages?conversationId=${selectedConversation.id}`
        : null,
      linkLabel: selectedConversation.scheduledCount ? "Open scheduled queue" : null
    };
  }

  if (hasScheduledReply) {
    return {
      tone: "default" as const,
      label: "Next auto reply queued",
      detail: `${ruleLabel} is scheduled to send the next automated reply at ${selectedConversation.nextScheduledAt}.`,
      linkHref: `/scheduled-messages?conversationId=${selectedConversation.id}`,
      linkLabel: "Open scheduled queue"
    };
  }

  if (automation.isIdle) {
    return {
      tone: "default" as const,
      label: "Workflow idle",
      detail: automation.lastAutoReplyAt
        ? `${ruleLabel} has been waiting for the contact's reply since ${automation.lastAutoReplyAt}.`
        : `${ruleLabel} has been waiting for the contact's reply for a while.`,
      linkHref: null,
      linkLabel: null
    };
  }

  if (automation.activeFlowStep) {
    return {
      tone: "default" as const,
      label: "Waiting for customer reply",
      detail: flowStepLabel
        ? automation.lastAutoReplyAt
          ? `${ruleLabel} is waiting for the contact's next reply at ${flowStepLabel} since ${automation.lastAutoReplyAt}.`
          : `${ruleLabel} is waiting for the contact's next reply at ${flowStepLabel}.`
        : automation.lastAutoReplyAt
          ? `${ruleLabel} is waiting for the contact's next reply since ${automation.lastAutoReplyAt}.`
          : `${ruleLabel} is waiting for the contact's next reply.`,
      linkHref: null,
      linkLabel: null
    };
  }

  if (automation.lastAutoReplyAt) {
    return {
      tone: "default" as const,
      label: "Last automated reply",
      detail: `${ruleLabel} last replied on ${automation.lastAutoReplyAt}.`,
      linkHref: null,
      linkLabel: null
    };
  }

  return null;
}

function formatAutomationStepLabel(stepId: string) {
  const normalized = stepId.trim();

  if (!normalized) {
    return null;
  }

  if (looksLikeInternalAutomationId(normalized)) {
    return null;
  }

  return normalized
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function looksLikeInternalAutomationId(value: string) {
  return /^[a-f0-9]{24,}$/i.test(value) || /^cm[a-z0-9]{20,}$/i.test(value);
}
