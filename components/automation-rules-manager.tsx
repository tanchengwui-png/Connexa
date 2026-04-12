"use client";

import { AutomationMatchType, AutomationTriggerType } from "@prisma/client";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useConfirmation } from "@/components/confirmation-provider";
import { useToast } from "@/components/toast-provider";
import { WorkflowLibraryDesigner } from "@/components/workflow-library-designer";
import { WorkflowTestPanel } from "@/components/workflow-test-panel";

type AutomationRulesManagerProps = {
  settings: {
    timezone: string;
    businessHoursEnabled: boolean;
    businessHours: Array<{ day: number; enabled: boolean; start: string; end: string; label?: string }>;
    awayReplyEnabled: boolean;
    awayReplyBody: string;
    awayReplyCooldownMinutes: number;
    humanTakeoverPauseMinutes: number;
    regexEnabled: boolean;
    decisionFlowEnabled: boolean;
    decisionFlowQuestion: string;
    decisionFlowYesKeywords: string;
    decisionFlowNoKeywords: string;
    decisionFlowYesReply: string;
    decisionFlowNoReply: string;
    decisionFlowFallbackReply: string;
    decisionFlowYesTags: string[];
    decisionFlowNoTags: string[];
    workflowFlowEnabled: boolean;
    activeWorkflowId: string | null;
    propertyFlowEnabled: boolean;
    propertyFlowPromptPurpose: string;
    propertyFlowPromptArea: string;
    propertyFlowPromptBudget: string;
    propertyFlowCompleteReply: string;
  };
  rules: Array<{
    id: string;
    name: string;
    triggerType: AutomationTriggerType;
    triggerLabel: string;
    matchType: AutomationMatchType;
    matchLabel: string;
    keyword: string | null;
    replyBody: string;
    addTags: string[];
    priority: number;
    cooldownMinutes: number;
    stopAfterMatch: boolean;
    businessHoursOnly: boolean;
    followUpDelayMinutes: number | null;
    followUpReplyBody: string | null;
    enabled: boolean;
  }>;
  jobs: Array<{
    id: string;
    status: string;
    runAtIso: string;
    runAtLabel: string;
    conversationId: string;
    contactName: string;
    ruleName: string;
    lastError: string | null;
    bodyPreview: string;
  }>;
  workflows: Array<{
    id: string;
    name: string;
    definitionJson: string;
    isActive: boolean;
    updatedAtIso: string;
  }>;
};

type AutomationTab = "rules" | "hours" | "workflow";

const EMPTY_RULE_FORM: {
  id: string | null;
  name: string;
  triggerType: AutomationTriggerType;
  matchType: AutomationMatchType;
  keyword: string;
  replyBody: string;
  addTags: string;
  priority: number;
  cooldownMinutes: number;
  stopAfterMatch: boolean;
  businessHoursOnly: boolean;
  followUpDelayMinutes: string;
  followUpReplyBody: string;
  enabled: boolean;
} = {
  id: null as string | null,
  name: "",
  triggerType: AutomationTriggerType.KEYWORD_MATCH,
  matchType: AutomationMatchType.CONTAINS,
  keyword: "",
  replyBody: "",
  addTags: "",
  priority: 100,
  cooldownMinutes: 360,
  stopAfterMatch: true,
  businessHoursOnly: false,
  followUpDelayMinutes: "",
  followUpReplyBody: "",
  enabled: true
};

const TABS: Array<{ id: AutomationTab; label: string; description: string }> = [
  { id: "workflow", label: "Workflow", description: "Graph-style multi-step flow" },
  { id: "rules", label: "Rules", description: "Welcome and keyword automation rules" },
  { id: "hours", label: "Hours", description: "Business hours, away reply, and pause" }
];

export function AutomationRulesManager({ settings, rules, jobs, workflows }: AutomationRulesManagerProps) {
  const router = useRouter();
  const { confirm } = useConfirmation();
  const { success, error: showError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<AutomationTab>("workflow");
  const [settingsForm, setSettingsForm] = useState(settings);
  const [ruleForm, setRuleForm] = useState(EMPTY_RULE_FORM);
  const [workflowList, setWorkflowList] = useState(workflows);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(
    settings.activeWorkflowId ?? workflows[0]?.id ?? null
  );
  const [selectedWorkflowStepId, setSelectedWorkflowStepId] = useState<string | null>(null);
  const [selectedWorkflowVariableKey, setSelectedWorkflowVariableKey] = useState<string | null>(null);
  const [expandedWorkflowVariableGroups, setExpandedWorkflowVariableGroups] = useState<string[]>([]);
  const [workflowContextMenu, setWorkflowContextMenu] = useState<{
    x: number;
    y: number;
    targetId: string;
    targetType: "start" | "action" | "question" | "end";
  } | null>(null);
  const workflowCanvasRef = useRef<HTMLDivElement | null>(null);

  const beginEditRule = (ruleId: string) => {
    const rule = rules.find((item) => item.id === ruleId);
    if (!rule) {
      return;
    }

    setRuleForm({
      id: rule.id,
      name: rule.name,
      triggerType: rule.triggerType,
      matchType: rule.matchType,
      keyword: rule.keyword ?? "",
      replyBody: rule.replyBody,
      addTags: rule.addTags.join(", "),
      priority: rule.priority,
      cooldownMinutes: rule.cooldownMinutes,
      stopAfterMatch: rule.stopAfterMatch,
      businessHoursOnly: rule.businessHoursOnly,
      followUpDelayMinutes: rule.followUpDelayMinutes ? `${rule.followUpDelayMinutes}` : "",
      followUpReplyBody: rule.followUpReplyBody ?? "",
      enabled: rule.enabled
    });
    setActiveTab("rules");
  };

  const resetRuleForm = () => {
    setRuleForm(EMPTY_RULE_FORM);
  };

  const saveSettings = (successTitle: string, successMessage: string) => {
    setError(null);
    startTransition(async () => {
      const response = await fetch("/api/automation-rules/settings", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(settingsForm)
      });

      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        const message = payload?.error ?? "Unable to save automation settings.";
        setError(message);
        showError("Automation settings not saved", message);
        return;
      }

      success(successTitle, successMessage);
      router.refresh();
    });
  };

  const createWorkflow = () => {
    setError(null);
    startTransition(async () => {
      const response = await fetch("/api/automation-workflows", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          name: `Workflow ${workflowList.length + 1}`
        })
      });

      const payload = (await response.json().catch(() => null)) as
        | { error?: string; workflow?: AutomationRulesManagerProps["workflows"][number] }
        | null;

      if (!response.ok || !payload?.workflow) {
        const message = payload?.error ?? "Unable to create workflow.";
        setError(message);
        showError("Workflow not created", message);
        return;
      }

      const nextWorkflow = { ...payload.workflow, isActive: false };
      setWorkflowList((current) => [nextWorkflow, ...current]);
      setSelectedWorkflowId(nextWorkflow.id);
      success("Workflow created", `${nextWorkflow.name} is ready.`);
    });
  };

  const saveSelectedWorkflow = () => {
    if (!selectedWorkflow) {
      return;
    }

    setError(null);
    startTransition(async () => {
      const response = await fetch(`/api/automation-workflows/${selectedWorkflow.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          name: selectedWorkflow.name,
          definitionJson: selectedWorkflow.definitionJson
        })
      });

      const payload = (await response.json().catch(() => null)) as
        | { error?: string; workflow?: AutomationRulesManagerProps["workflows"][number] }
        | null;

      if (!response.ok || !payload?.workflow) {
        const message = payload?.error ?? "Unable to save workflow.";
        setError(message);
        showError("Workflow not saved", message);
        return;
      }

      setWorkflowList((current) =>
        current.map((workflow) =>
          workflow.id === payload.workflow?.id
            ? { ...workflow, name: payload.workflow.name, definitionJson: payload.workflow.definitionJson }
            : workflow
        )
      );
      success("Workflow saved", `${payload.workflow.name} is ready for use.`);
    });
  };

  const setActiveWorkflow = (workflowId: string) => {
    setError(null);
    startTransition(async () => {
      const response = await fetch(`/api/automation-workflows/${workflowId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          isActive: true
        })
      });

      const payload = (await response.json().catch(() => null)) as
        | { error?: string; workflow?: AutomationRulesManagerProps["workflows"][number] }
        | null;

      if (!response.ok || !payload?.workflow) {
        const message = payload?.error ?? "Unable to activate workflow.";
        setError(message);
        showError("Workflow not activated", message);
        return;
      }

      setSettingsForm((current) => ({
        ...current,
        workflowFlowEnabled: true,
        activeWorkflowId: payload.workflow?.id ?? null
      }));
      setWorkflowList((current) =>
        current.map((workflow) => ({
          ...workflow,
          isActive: workflow.id === payload.workflow?.id
        }))
      );
      success("Workflow activated", `${payload.workflow.name} is now the runtime workflow.`);
    });
  };

  const deleteWorkflow = async (workflowId: string) => {
    const workflow = workflowList.find((item) => item.id === workflowId);
    const accepted = await confirm({
      title: "Delete workflow?",
      description: `This will permanently remove ${workflow?.name ?? "this workflow"}.`,
      confirmLabel: "Delete workflow",
      tone: "danger"
    });

    if (!accepted) {
      return;
    }

    setError(null);
    startTransition(async () => {
      const response = await fetch(`/api/automation-workflows/${workflowId}`, {
        method: "DELETE"
      });
      const payload = (await response.json().catch(() => null)) as
        | { error?: string; workflow?: AutomationRulesManagerProps["workflows"][number] }
        | null;

      if (!response.ok) {
        const message = payload?.error ?? "Unable to delete workflow.";
        setError(message);
        showError("Workflow not deleted", message);
        return;
      }

      setWorkflowList((current) => current.filter((item) => item.id !== workflowId));
      setSelectedWorkflowStepId(null);
      setSelectedWorkflowId(payload?.workflow?.id ?? null);
      setSettingsForm((current) => ({
        ...current,
        activeWorkflowId: payload?.workflow?.id ?? null
      }));
      success("Workflow deleted", `${workflow?.name ?? "Workflow"} has been removed.`);
    });
  };

  const saveRule = async () => {
    setError(null);

    const accepted = await confirm({
      title: ruleForm.id ? "Save automation rule?" : "Create automation rule?",
      description: ruleForm.id
        ? `This will update ${ruleForm.name || "this rule"} for future inbound matches.`
        : `This will add ${ruleForm.name || "a new automation rule"} to the workspace.`,
      confirmLabel: ruleForm.id ? "Save rule" : "Create rule"
    });

    if (!accepted) {
      return;
    }

    startTransition(async () => {
      const response = await fetch(ruleForm.id ? `/api/automation-rules/${ruleForm.id}` : "/api/automation-rules", {
        method: ruleForm.id ? "PATCH" : "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          name: ruleForm.name,
          triggerType: ruleForm.triggerType,
          matchType: ruleForm.matchType,
          keyword: ruleForm.keyword,
          replyBody: ruleForm.replyBody,
          addTags: ruleForm.addTags
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean),
          priority: Number(ruleForm.priority),
          cooldownMinutes: Number(ruleForm.cooldownMinutes),
          stopAfterMatch: ruleForm.stopAfterMatch,
          businessHoursOnly: ruleForm.businessHoursOnly,
          followUpDelayMinutes: ruleForm.followUpDelayMinutes ? Number(ruleForm.followUpDelayMinutes) : null,
          followUpReplyBody: ruleForm.followUpReplyBody || null,
          enabled: ruleForm.enabled
        })
      });

      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        const message = payload?.error ?? "Unable to save automation rule.";
        setError(message);
        showError("Automation rule not saved", message);
        return;
      }

      success(ruleForm.id ? "Rule updated" : "Rule created", `${ruleForm.name || "Automation rule"} is ready.`);
      resetRuleForm();
      router.refresh();
    });
  };

  const toggleRule = async (ruleId: string, enabled: boolean) => {
    const rule = rules.find((item) => item.id === ruleId);
    startTransition(async () => {
      const response = await fetch(`/api/automation-rules/${ruleId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ enabled })
      });

      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        const message = payload?.error ?? "Unable to update automation rule.";
        setError(message);
        showError("Automation rule not updated", message);
        return;
      }

      success(enabled ? "Rule enabled" : "Rule disabled", `${rule?.name ?? "Automation rule"} is now ${enabled ? "active" : "paused"}.`);
      router.refresh();
    });
  };

  const removeRule = async (ruleId: string) => {
    const rule = rules.find((item) => item.id === ruleId);
    const accepted = await confirm({
      title: "Delete automation rule?",
      description: `This will permanently remove ${rule?.name ?? "this rule"}.`,
      confirmLabel: "Delete rule",
      tone: "danger"
    });

    if (!accepted) {
      return;
    }

    startTransition(async () => {
      const response = await fetch(`/api/automation-rules/${ruleId}`, {
        method: "DELETE"
      });

      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        const message = payload?.error ?? "Unable to delete automation rule.";
        setError(message);
        showError("Automation rule not deleted", message);
        return;
      }

      if (ruleForm.id === ruleId) {
        resetRuleForm();
      }

      success("Rule deleted", `${rule?.name ?? "Automation rule"} has been removed.`);
      router.refresh();
    });
  };

  const renderRules = () => (
    <section className="automation-rule-columns">
      <article className="content-card">
        <div className="card-header">
          <div>
            <h3 className="card-title">{ruleForm.id ? "Edit rule" : "Create rule"}</h3>
            <p className="muted">Keep the core rule simple. Expand advanced options only when you need them.</p>
          </div>
          {ruleForm.id ? (
            <button className="inbox-search-tool" onClick={resetRuleForm} type="button">
              Cancel edit
            </button>
          ) : null}
        </div>

        <div className="lead-record-form-grid">
          <label className="lead-record-field">
            <span>Rule name</span>
            <input
              className="lead-record-input"
              onChange={(event) => setRuleForm((current) => ({ ...current, name: event.target.value }))}
              value={ruleForm.name}
            />
          </label>
          <label className="lead-record-field">
            <span>Trigger</span>
            <select
              className="lead-record-input app-select"
              onChange={(event) =>
                setRuleForm((current) => ({
                  ...current,
                  triggerType: event.target.value as AutomationTriggerType
                }))
              }
              value={ruleForm.triggerType}
            >
              <option value={AutomationTriggerType.KEYWORD_MATCH}>Keyword rule</option>
              <option value={AutomationTriggerType.WELCOME_MESSAGE}>Welcome message</option>
            </select>
          </label>
          <label className="lead-record-field">
            <span>Match type</span>
            <select
              className="lead-record-input app-select"
              onChange={(event) =>
                setRuleForm((current) => ({
                  ...current,
                  matchType: event.target.value as AutomationMatchType
                }))
              }
              value={ruleForm.matchType}
            >
              <option value={AutomationMatchType.CONTAINS}>Contains</option>
              <option value={AutomationMatchType.EXACT}>Exact</option>
              <option value={AutomationMatchType.REGEX}>Regex</option>
            </select>
          </label>
          {ruleForm.triggerType === AutomationTriggerType.KEYWORD_MATCH ? (
            <label className="lead-record-field">
              <span>Keyword / pattern</span>
              <input
                className="lead-record-input"
                onChange={(event) => setRuleForm((current) => ({ ...current, keyword: event.target.value }))}
                value={ruleForm.keyword}
              />
            </label>
          ) : (
            <div className="automation-rule-note">
              <strong>Welcome rule</strong>
              <span>Runs on the first inbound message of a new conversation.</span>
            </div>
          )}
          <label className="lead-record-field lead-record-field-wide">
            <span>Reply body</span>
            <textarea
              className="lead-record-input lead-record-textarea"
              onChange={(event) => setRuleForm((current) => ({ ...current, replyBody: event.target.value }))}
              value={ruleForm.replyBody}
            />
          </label>
          <label className="lead-record-field lead-record-field-wide">
            <span>Tags to add</span>
            <input
              className="lead-record-input"
              onChange={(event) => setRuleForm((current) => ({ ...current, addTags: event.target.value }))}
              placeholder="Rawang, buyer, high intent"
              value={ruleForm.addTags}
            />
          </label>
        </div>

        <details className="automation-advanced-block">
          <summary>Advanced options</summary>
          <div className="lead-record-form-grid">
            <label className="lead-record-field">
              <span>Priority</span>
              <input
                className="lead-record-input"
                min={1}
                onChange={(event) =>
                  setRuleForm((current) => ({ ...current, priority: Number(event.target.value) || 100 }))
                }
                type="number"
                value={ruleForm.priority}
              />
            </label>
            <label className="lead-record-field">
              <span>Cooldown (minutes)</span>
              <input
                className="lead-record-input"
                min={0}
                onChange={(event) =>
                  setRuleForm((current) => ({ ...current, cooldownMinutes: Number(event.target.value) || 0 }))
                }
                type="number"
                value={ruleForm.cooldownMinutes}
              />
            </label>
            <label className="lead-record-field">
              <span>Follow-up delay (minutes)</span>
              <input
                className="lead-record-input"
                min={0}
                onChange={(event) =>
                  setRuleForm((current) => ({ ...current, followUpDelayMinutes: event.target.value }))
                }
                type="number"
                value={ruleForm.followUpDelayMinutes}
              />
            </label>
            <label className="lead-record-field lead-record-field-wide">
              <span>Follow-up reply</span>
              <textarea
                className="lead-record-input lead-record-textarea"
                onChange={(event) =>
                  setRuleForm((current) => ({ ...current, followUpReplyBody: event.target.value }))
                }
                value={ruleForm.followUpReplyBody}
              />
            </label>
            <label className="lead-record-field lead-record-field-wide automation-toggle-row">
              <input
                checked={ruleForm.stopAfterMatch}
                onChange={(event) =>
                  setRuleForm((current) => ({ ...current, stopAfterMatch: event.target.checked }))
                }
                type="checkbox"
              />
              <span>Stop after this rule matches</span>
            </label>
            <label className="lead-record-field lead-record-field-wide automation-toggle-row">
              <input
                checked={ruleForm.businessHoursOnly}
                onChange={(event) =>
                  setRuleForm((current) => ({ ...current, businessHoursOnly: event.target.checked }))
                }
                type="checkbox"
              />
              <span>Run only during business hours</span>
            </label>
            <label className="lead-record-field lead-record-field-wide automation-toggle-row">
              <input
                checked={ruleForm.enabled}
                onChange={(event) =>
                  setRuleForm((current) => ({ ...current, enabled: event.target.checked }))
                }
                type="checkbox"
              />
              <span>Rule enabled</span>
            </label>
          </div>
        </details>

        {error ? <div className="form-error">{error}</div> : null}

        <div className="composer-actions">
          <button className="button button-primary" disabled={isPending} onClick={() => void saveRule()} type="button">
            {isPending ? "Saving..." : ruleForm.id ? "Save rule" : "Create rule"}
          </button>
        </div>
      </article>

      <article className="table-card">
        <div className="card-header">
          <div>
            <h3 className="card-title">Rules</h3>
            <p className="muted">Priority still runs top-down, but the editing surface is now calmer.</p>
          </div>
        </div>

        <div className="timeline-list">
          {rules.map((rule) => (
            <div className="timeline-row automation-rule-row" key={rule.id}>
              <div className="timeline-topline">
                <strong>{rule.name}</strong>
                <span className={`stage-pill ${rule.enabled ? "qualified" : ""}`}>
                  {rule.enabled ? "Enabled" : "Disabled"}
                </span>
              </div>
              <div className="message-meta">
                <span className="lead-chip">{rule.triggerLabel}</span>
                <span className="lead-chip">{rule.matchLabel}</span>
                <span className="lead-chip">P{rule.priority}</span>
                <span className="lead-chip">{rule.cooldownMinutes}m cooldown</span>
                {rule.keyword ? <span className="lead-chip">{rule.keyword}</span> : null}
              </div>
              <div className="table-subtle">{rule.replyBody}</div>
              {rule.addTags.length ? (
                <div className="message-meta">
                  {rule.addTags.map((tag) => (
                    <span className="lead-chip" key={tag}>
                      Tag: {tag}
                    </span>
                  ))}
                </div>
              ) : null}
              {rule.followUpDelayMinutes && rule.followUpReplyBody ? (
                <div className="table-subtle">
                  Follow-up in {rule.followUpDelayMinutes}m: {rule.followUpReplyBody}
                </div>
              ) : null}
              <div className="composer-actions inline-actions">
                <button className="button button-secondary compact-button" disabled={isPending} onClick={() => beginEditRule(rule.id)} type="button">
                  Edit
                </button>
                <button
                  className="button button-secondary compact-button"
                  disabled={isPending}
                  onClick={() => void toggleRule(rule.id, !rule.enabled)}
                  type="button"
                >
                  {rule.enabled ? "Disable" : "Enable"}
                </button>
                <button
                  className="button button-secondary compact-button"
                  disabled={isPending}
                  onClick={() => void removeRule(rule.id)}
                  type="button"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      </article>
    </section>
  );

  const renderHours = () => (
    <article className="content-card automation-settings-card">
      <div className="card-header">
        <div>
          <h3 className="card-title">Business hours and away reply</h3>
          <p className="muted">Keep timing, pause, and away behavior together in one place.</p>
        </div>
      </div>

      <div className="lead-record-form-sections">
        <section className="lead-record-panel">
          <div className="lead-record-section-head">
            <strong>Business hours</strong>
            <span>Used by away replies and business-hours-only keyword rules.</span>
          </div>
          <div className="lead-record-form-grid">
            <label className="lead-record-field">
              <span>Timezone</span>
              <input
                className="lead-record-input"
                onChange={(event) => setSettingsForm((current) => ({ ...current, timezone: event.target.value }))}
                value={settingsForm.timezone}
              />
            </label>
            <label className="lead-record-field">
              <span>Human takeover pause (minutes)</span>
              <input
                className="lead-record-input"
                min={15}
                onChange={(event) =>
                  setSettingsForm((current) => ({
                    ...current,
                    humanTakeoverPauseMinutes: Number(event.target.value) || 240
                  }))
                }
                type="number"
                value={settingsForm.humanTakeoverPauseMinutes}
              />
            </label>
            <label className="lead-record-field lead-record-field-wide automation-toggle-row">
              <input
                checked={settingsForm.businessHoursEnabled}
                onChange={(event) =>
                  setSettingsForm((current) => ({ ...current, businessHoursEnabled: event.target.checked }))
                }
                type="checkbox"
              />
              <span>Enable business hours and away reply logic</span>
            </label>
          </div>

          <div className="automation-business-hours-grid">
            {settingsForm.businessHours.map((slot, index) => (
              <div className="automation-business-hours-row" key={slot.day}>
                <label className="automation-toggle-row">
                  <input
                    checked={slot.enabled}
                    onChange={(event) =>
                      setSettingsForm((current) => ({
                        ...current,
                        businessHours: current.businessHours.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, enabled: event.target.checked } : item
                        )
                      }))
                    }
                    type="checkbox"
                  />
                  <span>{slot.label ?? slot.day}</span>
                </label>
                <input
                  className="lead-record-input"
                  disabled={!slot.enabled}
                  onChange={(event) =>
                    setSettingsForm((current) => ({
                      ...current,
                      businessHours: current.businessHours.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, start: event.target.value } : item
                      )
                    }))
                  }
                  type="time"
                  value={slot.start}
                />
                <input
                  className="lead-record-input"
                  disabled={!slot.enabled}
                  onChange={(event) =>
                    setSettingsForm((current) => ({
                      ...current,
                      businessHours: current.businessHours.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, end: event.target.value } : item
                      )
                    }))
                  }
                  type="time"
                  value={slot.end}
                />
              </div>
            ))}
          </div>
        </section>

        <section className="lead-record-panel">
          <div className="lead-record-section-head">
            <strong>Away reply</strong>
            <span>Send a controlled reply when messages arrive outside working hours.</span>
          </div>
          <div className="lead-record-form-grid">
            <label className="lead-record-field lead-record-field-wide automation-toggle-row">
              <input
                checked={settingsForm.awayReplyEnabled}
                onChange={(event) =>
                  setSettingsForm((current) => ({ ...current, awayReplyEnabled: event.target.checked }))
                }
                type="checkbox"
              />
              <span>Send away reply outside business hours</span>
            </label>
            <label className="lead-record-field">
              <span>Away cooldown (minutes)</span>
              <input
                className="lead-record-input"
                min={30}
                onChange={(event) =>
                  setSettingsForm((current) => ({
                    ...current,
                    awayReplyCooldownMinutes: Number(event.target.value) || 720
                  }))
                }
                type="number"
                value={settingsForm.awayReplyCooldownMinutes}
              />
            </label>
            <label className="lead-record-field lead-record-field-wide">
              <span>Away reply</span>
              <textarea
                className="lead-record-input lead-record-textarea"
                onChange={(event) =>
                  setSettingsForm((current) => ({ ...current, awayReplyBody: event.target.value }))
                }
                value={settingsForm.awayReplyBody}
              />
            </label>
            <label className="lead-record-field lead-record-field-wide automation-toggle-row">
              <input
                checked={settingsForm.regexEnabled}
                onChange={(event) =>
                  setSettingsForm((current) => ({ ...current, regexEnabled: event.target.checked }))
                }
                type="checkbox"
              />
              <span>Allow regex match rules</span>
            </label>
          </div>
        </section>
      </div>

      {error ? <div className="form-error">{error}</div> : null}

      <div className="composer-actions">
        <button
          className="button button-primary"
          disabled={isPending}
          onClick={() => saveSettings("Hours saved", "Business hours, away reply, and pause settings are updated.")}
          type="button"
        >
          {isPending ? "Saving..." : "Save hours settings"}
        </button>
      </div>
    </article>
  );

  const renderLeadCapture = () => (
    <article className="content-card automation-settings-card">
      <div className="card-header">
        <div>
          <h3 className="card-title">Lead capture flow</h3>
          <p className="muted">Keep the property intake prompts separate from your keyword rules.</p>
        </div>
      </div>

      <section className="lead-record-panel">
        <div className="lead-record-section-head">
          <strong>Property intake</strong>
          <span>Collect purpose, area, and budget in a simple guided sequence.</span>
        </div>
        <div className="lead-record-form-grid">
          <label className="lead-record-field lead-record-field-wide automation-toggle-row">
            <input
              checked={settingsForm.propertyFlowEnabled}
              onChange={(event) =>
                setSettingsForm((current) => ({ ...current, propertyFlowEnabled: event.target.checked }))
              }
              type="checkbox"
            />
            <span>Enable property lead capture flow</span>
          </label>
          <label className="lead-record-field lead-record-field-wide">
            <span>Step 1 prompt</span>
            <input
              className="lead-record-input"
              onChange={(event) =>
                setSettingsForm((current) => ({ ...current, propertyFlowPromptPurpose: event.target.value }))
              }
              value={settingsForm.propertyFlowPromptPurpose}
            />
          </label>
          <label className="lead-record-field lead-record-field-wide">
            <span>Step 2 prompt</span>
            <input
              className="lead-record-input"
              onChange={(event) =>
                setSettingsForm((current) => ({ ...current, propertyFlowPromptArea: event.target.value }))
              }
              value={settingsForm.propertyFlowPromptArea}
            />
          </label>
          <label className="lead-record-field lead-record-field-wide">
            <span>Step 3 prompt</span>
            <input
              className="lead-record-input"
              onChange={(event) =>
                setSettingsForm((current) => ({ ...current, propertyFlowPromptBudget: event.target.value }))
              }
              value={settingsForm.propertyFlowPromptBudget}
            />
          </label>
          <label className="lead-record-field lead-record-field-wide">
            <span>Flow completion reply</span>
            <textarea
              className="lead-record-input lead-record-textarea"
              onChange={(event) =>
                setSettingsForm((current) => ({ ...current, propertyFlowCompleteReply: event.target.value }))
              }
              value={settingsForm.propertyFlowCompleteReply}
            />
          </label>
        </div>
      </section>

      {error ? <div className="form-error">{error}</div> : null}

      <div className="composer-actions">
        <button
          className="button button-primary"
          disabled={isPending}
          onClick={() =>
            saveSettings("Lead capture saved", "The property intake prompts are ready for new inquiries.")
          }
          type="button"
        >
          {isPending ? "Saving..." : "Save lead capture"}
        </button>
      </div>
    </article>
  );

  const renderDecisionFlow = () => (
    <article className="content-card automation-settings-card">
      <div className="card-header">
        <div>
          <h3 className="card-title">Yes / no decision flow</h3>
          <p className="muted">Ask one qualifying question, then branch the next reply into a yes or no path.</p>
        </div>
      </div>

      <section className="lead-record-panel">
        <div className="lead-record-section-head">
          <strong>Branching question</strong>
          <span>Starts on the first inbound message when enabled and no other active flow is running.</span>
        </div>
        <div className="lead-record-form-grid">
          <label className="lead-record-field lead-record-field-wide automation-toggle-row">
            <input
              checked={settingsForm.decisionFlowEnabled}
              onChange={(event) =>
                setSettingsForm((current) => ({ ...current, decisionFlowEnabled: event.target.checked }))
              }
              type="checkbox"
            />
            <span>Enable yes/no decision flow</span>
          </label>
          <label className="lead-record-field lead-record-field-wide">
            <span>Question</span>
            <textarea
              className="lead-record-input lead-record-textarea"
              onChange={(event) =>
                setSettingsForm((current) => ({ ...current, decisionFlowQuestion: event.target.value }))
              }
              value={settingsForm.decisionFlowQuestion}
            />
          </label>
          <label className="lead-record-field">
            <span>Yes keywords</span>
            <input
              className="lead-record-input"
              onChange={(event) =>
                setSettingsForm((current) => ({ ...current, decisionFlowYesKeywords: event.target.value }))
              }
              placeholder="yes, y, interested, ok"
              value={settingsForm.decisionFlowYesKeywords}
            />
          </label>
          <label className="lead-record-field">
            <span>No keywords</span>
            <input
              className="lead-record-input"
              onChange={(event) =>
                setSettingsForm((current) => ({ ...current, decisionFlowNoKeywords: event.target.value }))
              }
              placeholder="no, later, not interested"
              value={settingsForm.decisionFlowNoKeywords}
            />
          </label>
          <label className="lead-record-field lead-record-field-wide">
            <span>Fallback reply</span>
            <input
              className="lead-record-input"
              onChange={(event) =>
                setSettingsForm((current) => ({ ...current, decisionFlowFallbackReply: event.target.value }))
              }
              value={settingsForm.decisionFlowFallbackReply}
            />
          </label>
        </div>
      </section>

      <div className="lead-record-form-sections">
        <section className="lead-record-panel">
          <div className="lead-record-section-head">
            <strong>Yes branch</strong>
            <span>Reply and tags to apply when the customer answers yes.</span>
          </div>
          <div className="lead-record-form-grid">
            <label className="lead-record-field lead-record-field-wide">
              <span>Yes reply</span>
              <textarea
                className="lead-record-input lead-record-textarea"
                onChange={(event) =>
                  setSettingsForm((current) => ({ ...current, decisionFlowYesReply: event.target.value }))
                }
                value={settingsForm.decisionFlowYesReply}
              />
            </label>
            <label className="lead-record-field lead-record-field-wide">
              <span>Yes tags</span>
              <input
                className="lead-record-input"
                onChange={(event) =>
                  setSettingsForm((current) => ({
                    ...current,
                    decisionFlowYesTags: event.target.value
                      .split(",")
                      .map((tag) => tag.trim())
                      .filter(Boolean)
                  }))
                }
                placeholder="qualified, interested"
                value={settingsForm.decisionFlowYesTags.join(", ")}
              />
            </label>
          </div>
        </section>

        <section className="lead-record-panel">
          <div className="lead-record-section-head">
            <strong>No branch</strong>
            <span>Reply and tags to apply when the customer answers no.</span>
          </div>
          <div className="lead-record-form-grid">
            <label className="lead-record-field lead-record-field-wide">
              <span>No reply</span>
              <textarea
                className="lead-record-input lead-record-textarea"
                onChange={(event) =>
                  setSettingsForm((current) => ({ ...current, decisionFlowNoReply: event.target.value }))
                }
                value={settingsForm.decisionFlowNoReply}
              />
            </label>
            <label className="lead-record-field lead-record-field-wide">
              <span>No tags</span>
              <input
                className="lead-record-input"
                onChange={(event) =>
                  setSettingsForm((current) => ({
                    ...current,
                    decisionFlowNoTags: event.target.value
                      .split(",")
                      .map((tag) => tag.trim())
                      .filter(Boolean)
                  }))
                }
                placeholder="cold, no-interest"
                value={settingsForm.decisionFlowNoTags.join(", ")}
              />
            </label>
          </div>
        </section>
      </div>

      {error ? <div className="form-error">{error}</div> : null}

      <div className="composer-actions">
        <button
          className="button button-primary"
          disabled={isPending}
          onClick={() =>
            saveSettings("Decision flow saved", "The yes/no branching workflow is ready for new inbound messages.")
          }
          type="button"
        >
          {isPending ? "Saving..." : "Save decision flow"}
        </button>
      </div>
    </article>
  );

  const selectedWorkflow = workflowList.find((workflow) => workflow.id === selectedWorkflowId) ?? workflowList[0] ?? null;
  const parsedWorkflow = parseWorkflowDraft(selectedWorkflow?.definitionJson ?? DEFAULT_WORKFLOW_DEFINITION_JSON);
  const selectedWorkflowVariables = parsedWorkflow?.variables ?? [];
  const selectedWorkflowVariable =
    selectedWorkflowVariables.find((variable) => variable.key === selectedWorkflowVariableKey) ?? null;
  const workflowVariableTree = useMemo(() => {
    const groups = new Map<string, WorkflowVariable[]>();
    selectedWorkflowVariables.forEach((variable) => {
      const group = getWorkflowVariableGroup(variable.key);
      const bucket = groups.get(group) ?? [];
      bucket.push(variable);
      groups.set(group, bucket);
    });

    return Array.from(groups.entries())
      .map(([group, variables]) => ({
        group,
        variables: variables.sort((left, right) => left.key.localeCompare(right.key))
      }))
      .sort((left, right) => left.group.localeCompare(right.group));
  }, [selectedWorkflowVariables]);
  const selectedWorkflowStep =
    parsedWorkflow?.steps.find((step) => step.id === selectedWorkflowStepId) ??
    parsedWorkflow?.steps[0] ??
    null;
  const WORKFLOW_END_ID = "workflow-end";
  const WORKFLOW_MAX_DEPTH = 5;

  const ensureTerminalWorkflow = (draft: WorkflowDraft): WorkflowDraft => {
    const terminalStep: WorkflowDraft["steps"][number] =
      draft.steps.find((step) => step.id === WORKFLOW_END_ID && step.type === "end") ??
      ({
        id: WORKFLOW_END_ID,
        type: "end",
        title: "End",
        reply: "",
        tags: []
      } satisfies WorkflowDraft["steps"][number]);

    const stepsWithoutTerminal = draft.steps.filter((step) => step.id !== WORKFLOW_END_ID);
    const normalizedSteps = stepsWithoutTerminal.map((step) => {
      if ("branches" in step) {
        const branches = step.branches?.length
          ? step.branches.map((branch) => ({
              ...branch,
              nextStepId: branch.nextStepId || WORKFLOW_END_ID
            }))
          : [
              {
                id: `${step.id}-yes`,
                label: "Yes",
                keywords: ["yes", "y"],
                reply: "",
                nextStepId: WORKFLOW_END_ID,
                tags: []
              },
              {
                id: `${step.id}-no`,
                label: "No",
                keywords: ["no", "n"],
                reply: "",
                nextStepId: WORKFLOW_END_ID,
                tags: []
              }
            ];

        return {
          ...step,
          branches,
          fallbackNextStepId: step.fallbackNextStepId ?? null
        };
      }

      if ("nextStepId" in step) {
        return {
          ...step,
          nextStepId: step.nextStepId || WORKFLOW_END_ID
        };
      }

      return step;
    });

    const hasValidStart = normalizedSteps.some((step) => step.id === draft.startStepId);
    return {
      ...draft,
      variables: normalizeWorkflowVariables(draft.variables),
      startStepId: hasValidStart ? draft.startStepId : terminalStep.id,
      steps: [...normalizedSteps, terminalStep]
    };
  };

  const buildWorkflowLayout = (draft: WorkflowDraft) => {
    const normalized = ensureTerminalWorkflow(draft);
    const stepMap = new Map(normalized.steps.map((step) => [step.id, step]));
    const columnMap = new Map<string, number>([[normalized.startStepId, 1]]);
    const orderMap = new Map<string, number>();
    const visitQueue = [normalized.startStepId];
    let visitIndex = 0;

    while (visitQueue.length) {
      const stepId = visitQueue.shift();
      if (!stepId) {
        continue;
      }

      const step = stepMap.get(stepId);
      const currentColumn = columnMap.get(stepId) ?? 1;
      if (!step) {
        continue;
      }

      if (!orderMap.has(stepId)) {
        orderMap.set(stepId, visitIndex);
        visitIndex += 1;
      }

      const targets =
        "branches" in step
          ? step.branches?.map((branch) => branch.nextStepId || WORKFLOW_END_ID) ?? []
          : "nextStepId" in step
            ? [step.nextStepId || WORKFLOW_END_ID]
            : [];

      targets.forEach((targetId) => {
        if (!targetId) {
          return;
        }

        const nextColumn = currentColumn + 1;
        const existingColumn = columnMap.get(targetId);
        if (!existingColumn || nextColumn > existingColumn) {
          columnMap.set(targetId, nextColumn);
        }
        visitQueue.push(targetId);
      });
    }

    const columns = new Map<number, string[]>();
    normalized.steps.forEach((step) => {
      const column = columnMap.get(step.id) ?? (step.id === WORKFLOW_END_ID ? 3 : 2);
      const bucket = columns.get(column) ?? [];
      bucket.push(step.id);
      columns.set(column, bucket);
    });

    const positions = new Map<string, { x: number; y: number }>();
    Array.from(columns.entries())
      .sort((left, right) => left[0] - right[0])
      .forEach(([column, ids]) => {
        ids
          .sort((left, right) => (orderMap.get(left) ?? 0) - (orderMap.get(right) ?? 0))
          .forEach((id, index) => {
            positions.set(id, {
              x: 240 + (column - 1) * 300,
              y: 48 + index * 180
            });
          });
      });

    const getSourcePoint = (stepId: string, branchId?: string) => {
      const position = positions.get(stepId);
      const step = stepMap.get(stepId);
      if (!position || !step) {
        return null;
      }

      const base = {
        x: position.x + 220,
        y: position.y + 60
      };

      if (branchId && "branches" in step && step.branches?.length) {
        const branchIndex = step.branches.findIndex((branch) => branch.id === branchId);
        return {
          x: base.x,
          y: base.y + (branchIndex < 0 ? 0 : branchIndex * 22) - Math.max(0, (step.branches.length - 1) * 11)
        };
      }

      return base;
    };

    const edges = [
      {
        id: "start-edge",
        label: "Start",
        sourceX: 112,
        sourceY: 110,
        targetX: positions.get(normalized.startStepId)?.x ?? 240,
        targetY: (positions.get(normalized.startStepId)?.y ?? 48) + 60
      },
      ...normalized.steps.flatMap((step) => {
        if ("branches" in step) {
          return step.branches?.flatMap((branch) => {
            const source = getSourcePoint(step.id, branch.id);
            const target = positions.get(branch.nextStepId || WORKFLOW_END_ID);
            if (!source || !target) {
              return [];
            }

            return [
              {
                id: `${step.id}:${branch.id}`,
                label: branch.label,
                sourceX: source.x,
                sourceY: source.y,
                targetX: target.x,
                targetY: target.y + 60
              }
            ];
          }) ?? [];
        }

        if ("nextStepId" in step) {
          const source = getSourcePoint(step.id);
          const target = positions.get(step.nextStepId || WORKFLOW_END_ID);
          if (!source || !target) {
            return [];
          }

          return [
            {
              id: `${step.id}:next`,
              label: "Next",
              sourceX: source.x,
              sourceY: source.y,
              targetX: target.x,
              targetY: target.y + 60
            }
          ];
        }

        return [];
      })
    ];

    return {
      workflow: normalized,
      positions,
      edges,
      canvasHeight: Math.max(380, ...Array.from(positions.values()).map((position) => position.y + 150)),
      canvasWidth: Math.max(980, ...Array.from(positions.values()).map((position) => position.x + 280))
    };
  };

  const normalizedWorkflow = useMemo(
    () => (parsedWorkflow ? buildWorkflowLayout(parsedWorkflow) : null),
    [parsedWorkflow]
  );
  const workflowDepthMap = useMemo(() => {
    if (!normalizedWorkflow) {
      return new Map<string, number>();
    }

    const depthMap = new Map<string, number>([[normalizedWorkflow.workflow.startStepId, 1]]);
    const queue = [normalizedWorkflow.workflow.startStepId];

    while (queue.length) {
      const stepId = queue.shift();
      if (!stepId) {
        continue;
      }

      const step = normalizedWorkflow.workflow.steps.find((item) => item.id === stepId);
      const depth = depthMap.get(stepId) ?? 1;
      if (!step) {
        continue;
      }

      const targets =
        "branches" in step
          ? step.branches?.map((branch) => branch.nextStepId || WORKFLOW_END_ID) ?? []
          : "nextStepId" in step
            ? [step.nextStepId || WORKFLOW_END_ID]
            : [];

      targets.forEach((targetId) => {
        if (!depthMap.has(targetId)) {
          depthMap.set(targetId, depth + 1);
          queue.push(targetId);
        }
      });
    }

    return depthMap;
  }, [normalizedWorkflow]);
  const shouldHideTerminalOnlyState =
    normalizedWorkflow?.workflow.startStepId === WORKFLOW_END_ID &&
    normalizedWorkflow.workflow.steps.length === 1 &&
    normalizedWorkflow.workflow.steps[0]?.id === WORKFLOW_END_ID;

  const updateWorkflowDraft = (updater: (current: WorkflowDraft) => WorkflowDraft) => {
    const current = parseWorkflowDraft(selectedWorkflow?.definitionJson ?? DEFAULT_WORKFLOW_DEFINITION_JSON);
    if (!current) {
      return;
    }

    const next = ensureTerminalWorkflow(updater(ensureTerminalWorkflow(current)));
    setWorkflowList((currentList) =>
      currentList.map((workflow) =>
        workflow.id === selectedWorkflowId
          ? {
              ...workflow,
              definitionJson: JSON.stringify(next, null, 2)
            }
          : workflow
      )
    );
  };

  const updateWorkflowVariables = (updater: (current: WorkflowVariable[]) => WorkflowVariable[]) => {
    updateWorkflowDraft((current) => ({
      ...current,
      variables: updater(normalizeWorkflowVariables(current.variables))
    }));
  };

  const buildNextWorkflowVariable = (existing: WorkflowVariable[]) => {
    let index = existing.length + 1;
    let key = normalizeWorkflowVariableKey(`variable_${index}`);

    while (existing.some((entry) => entry.key === key)) {
      index += 1;
      key = normalizeWorkflowVariableKey(`variable_${index}`);
    }

    return {
      key,
      type: "text" as const,
      description: null
    };
  };

  const createWorkflowVariable = (assignTo?: "saveAs" | "decisionSourceKey") => {
    const currentVariables = normalizeWorkflowVariables(parsedWorkflow?.variables);
    const nextVariable = buildNextWorkflowVariable(currentVariables);
    setSelectedWorkflowVariableKey(nextVariable.key);
    setExpandedWorkflowVariableGroups((current) => {
      const nextGroup = getWorkflowVariableGroup(nextVariable.key);
      return current.includes(nextGroup) ? current : [...current, nextGroup];
    });

    updateWorkflowDraft((current) => {
      const variables = [...normalizeWorkflowVariables(current.variables), nextVariable];
      let steps = current.steps;

      if (assignTo && selectedWorkflowStep) {
        steps = current.steps.map((step) =>
          step.id === selectedWorkflowStep.id ? { ...step, [assignTo]: nextVariable.key } : step
        );
      }

      return {
        ...current,
        variables,
        steps
      };
    });
  };

  const renameWorkflowVariable = (previousKey: string, nextValue: string) => {
    const existingVariables = normalizeWorkflowVariables(parsedWorkflow?.variables);
    const fallbackKey =
      existingVariables.findIndex((entry) => entry.key === previousKey) >= 0
        ? `variable_${existingVariables.findIndex((entry) => entry.key === previousKey) + 1}`
        : "variable";
    const baseKey = normalizeWorkflowVariableKey(nextValue || fallbackKey);

    let nextKey = baseKey;
    let duplicateIndex = 2;
    while (existingVariables.some((entry) => entry.key !== previousKey && entry.key === nextKey)) {
      nextKey = `${baseKey}_${duplicateIndex}`;
      duplicateIndex += 1;
    }

    setSelectedWorkflowVariableKey(nextKey);
    setExpandedWorkflowVariableGroups((current) => {
      const nextGroup = getWorkflowVariableGroup(nextKey);
      return current.includes(nextGroup) ? current : [...current, nextGroup];
    });

    updateWorkflowDraft((current) => {
      return {
        ...current,
        variables: normalizeWorkflowVariables(current.variables).map((entry) =>
          entry.key === previousKey ? { ...entry, key: nextKey } : entry
        ),
        steps: current.steps.map((step) => {
          if (step.type === "ask") {
            return {
              ...step,
              saveAs: step.saveAs === previousKey ? nextKey : step.saveAs
            };
          }

          if (step.type === "question" || step.type === "choice") {
            return {
              ...step,
              decisionSourceKey: step.decisionSourceKey === previousKey ? nextKey : step.decisionSourceKey
            };
          }

          return step;
        })
      };
    });
  };

  const removeWorkflowVariable = (key: string) => {
    setSelectedWorkflowVariableKey((current) => (current === key ? null : current));
    updateWorkflowDraft((current) => ({
      ...current,
      variables: normalizeWorkflowVariables(current.variables).filter((entry) => entry.key !== key),
      steps: current.steps.map((step) => {
        if (step.type === "ask") {
          return {
            ...step,
            saveAs: step.saveAs === key ? null : step.saveAs
          };
        }

        if (step.type === "question" || step.type === "choice") {
          return {
            ...step,
            decisionSourceKey: step.decisionSourceKey === key ? null : step.decisionSourceKey
          };
        }

        return step;
      })
    }));
  };

  useEffect(() => {
    setSelectedWorkflowVariableKey((current) => (current === null ? current : null));
    setExpandedWorkflowVariableGroups((current) => (current.length ? [] : current));
  }, [selectedWorkflowId]);

  useEffect(() => {
    if (!selectedWorkflowVariables.length) {
      setSelectedWorkflowVariableKey((current) => (current === null ? current : null));
      setExpandedWorkflowVariableGroups((current) => (current.length ? [] : current));
      return;
    }

    setSelectedWorkflowVariableKey((current) =>
      current && selectedWorkflowVariables.some((entry) => entry.key === current) ? current : selectedWorkflowVariables[0]?.key ?? null
    );
    setExpandedWorkflowVariableGroups((current) => {
      const availableGroups = Array.from(new Set(selectedWorkflowVariables.map((entry) => getWorkflowVariableGroup(entry.key))));
      const next = current.filter((group) => availableGroups.includes(group));
      if (next.length === current.length && next.every((group, index) => group === current[index])) {
        return current;
      }
      if (next.length) {
        return next;
      }
      const fallback = availableGroups.slice(0, 1);
      if (fallback.length === current.length && fallback.every((group, index) => group === current[index])) {
        return current;
      }
      return fallback;
    });
  }, [selectedWorkflowVariables]);

  const nextWorkflowNodeId = (draft: WorkflowDraft, prefix: "action" | "decision") => {
    const ids = draft.steps
      .map((step) => {
        if (!step.id.startsWith(`${prefix}-`)) {
          return 0;
        }
        return Number(step.id.replace(`${prefix}-`, "")) || 0;
      });
    return `${prefix}-${Math.max(0, ...ids) + 1}`;
  };

  const openWorkflowMenu = (
    event: React.MouseEvent<HTMLElement>,
    targetId: string,
    targetType: "start" | "action" | "question" | "end"
  ) => {
    event.preventDefault();
    if (!workflowCanvasRef.current) {
      return;
    }

    const rect = workflowCanvasRef.current.getBoundingClientRect();
    setWorkflowContextMenu({
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      targetId,
      targetType
    });
  };

  const createActionNode = (draft: WorkflowDraft, title: string) => ({
    id: nextWorkflowNodeId(draft, "action"),
    type: "action" as const,
    title,
    reply: "",
    tags: [],
    nextStepId: WORKFLOW_END_ID
  });

  const createDecisionNode = (draft: WorkflowDraft, title: string) => ({
    id: nextWorkflowNodeId(draft, "decision"),
    type: "question" as const,
    title,
    prompt: "Ask a yes/no question.",
    branches: [
      {
        id: "yes",
        label: "Yes",
        keywords: ["yes", "y"],
        reply: "",
        nextStepId: WORKFLOW_END_ID,
        tags: []
      },
      {
        id: "no",
        label: "No",
        keywords: ["no", "n"],
        reply: "",
        nextStepId: WORKFLOW_END_ID,
        tags: []
      }
    ],
    fallbackReply: "Please answer yes or no.",
    fallbackNextStepId: null
  });

  const insertWorkflowNode = (mode: "branch" | "decision", branchId?: "yes" | "no") => {
    if (!workflowContextMenu) {
      return;
    }

    updateWorkflowDraft((current) => {
      const normalizedCurrent = ensureTerminalWorkflow(current);
      const depthMap = new Map<string, number>([[normalizedCurrent.startStepId, 1]]);
      const queue = [normalizedCurrent.startStepId];

      while (queue.length) {
        const stepId = queue.shift();
        if (!stepId) {
          continue;
        }

        const step = normalizedCurrent.steps.find((item) => item.id === stepId);
        const depth = depthMap.get(stepId) ?? 1;
        if (!step) {
          continue;
        }

        const targets =
          "branches" in step
            ? step.branches?.map((branch) => branch.nextStepId || WORKFLOW_END_ID) ?? []
            : "nextStepId" in step
              ? [step.nextStepId || WORKFLOW_END_ID]
              : [];

        targets.forEach((targetId) => {
          if (!depthMap.has(targetId)) {
            depthMap.set(targetId, depth + 1);
            queue.push(targetId);
          }
        });
      }

      const parentDepth =
        workflowContextMenu.targetType === "start"
          ? 0
          : (depthMap.get(workflowContextMenu.targetId) ?? 1);

      if (parentDepth >= WORKFLOW_MAX_DEPTH) {
        return normalizedCurrent;
      }

      const nextNode =
        mode === "decision"
          ? createDecisionNode(normalizedCurrent, `Decision ${normalizedCurrent.steps.length}`)
          : createActionNode(normalizedCurrent, `Branch ${normalizedCurrent.steps.length}`);

      const next = {
        ...normalizedCurrent,
        steps: [...normalizedCurrent.steps, nextNode]
      };

      if (workflowContextMenu.targetType === "start") {
        return {
          ...next,
          startStepId: nextNode.id
        };
      }

      return {
        ...next,
        steps: next.steps.map((step) => {
          if (step.id !== workflowContextMenu.targetId) {
            return step;
          }

          if ("branches" in step && branchId) {
            return {
              ...step,
              branches: step.branches?.map((branch) =>
                branch.id === branchId ? { ...branch, nextStepId: nextNode.id } : branch
              )
            };
          }

          if ("nextStepId" in step) {
            return {
              ...step,
              nextStepId: nextNode.id
            };
          }

          return step;
        })
      };
    });

    setWorkflowContextMenu(null);
  };

  const connectWorkflowPathToEnd = (branchId?: "yes" | "no") => {
    if (!workflowContextMenu || workflowContextMenu.targetType === "start") {
      return;
    }

    updateWorkflowDraft((current) => ({
      ...current,
      steps: current.steps.map((step) => {
        if (step.id !== workflowContextMenu.targetId) {
          return step;
        }

        if ("branches" in step && branchId) {
          return {
            ...step,
            branches: step.branches?.map((branch) =>
              branch.id === branchId ? { ...branch, nextStepId: WORKFLOW_END_ID } : branch
            )
          };
        }

        if ("nextStepId" in step) {
          return {
            ...step,
            nextStepId: WORKFLOW_END_ID
          };
        }

        return step;
      })
    }));

    setWorkflowContextMenu(null);
  };

  const updateSelectedWorkflowStep = (
    updater: (step: NonNullable<typeof selectedWorkflowStep>) => WorkflowDraft["steps"][number]
  ) => {
    if (!selectedWorkflowStep) {
      return;
    }

    updateWorkflowDraft((current) => ({
      ...current,
      steps: current.steps.map((step) => (step.id === selectedWorkflowStep.id ? updater(selectedWorkflowStep) : step))
    }));
  };

  const removeSelectedWorkflowStep = () => {
    if (!selectedWorkflowStep) {
      return;
    }

    if (selectedWorkflowStep.id === WORKFLOW_END_ID) {
      return;
    }

    updateWorkflowDraft((current) => {
      const nextSteps = current.steps.filter((step) => step.id !== selectedWorkflowStep.id);
      return {
        ...current,
        startStepId:
          current.startStepId === selectedWorkflowStep.id ? nextSteps[0]?.id ?? current.startStepId : current.startStepId,
        steps: nextSteps.map((step) =>
          "branches" in step && step.branches
            ? {
                ...step,
                branches: step.branches.map((branch) =>
                  branch.nextStepId === selectedWorkflowStep.id ? { ...branch, nextStepId: null } : branch
                ),
                fallbackNextStepId:
                  step.fallbackNextStepId === selectedWorkflowStep.id ? null : step.fallbackNextStepId
              }
            : "nextStepId" in step && step.nextStepId === selectedWorkflowStep.id
              ? { ...step, nextStepId: null }
              : step
        )
      };
    });
    setSelectedWorkflowStepId(null);
  };

  const removeWorkflowNode = (stepId: string) => {
    if (stepId === WORKFLOW_END_ID) {
      return;
    }

    updateWorkflowDraft((current) => {
      const nextSteps = current.steps.filter((step) => step.id !== stepId);
      return {
        ...current,
        startStepId: current.startStepId === stepId ? WORKFLOW_END_ID : current.startStepId,
        steps: nextSteps.map((step) =>
          "branches" in step && step.branches
            ? {
                ...step,
                branches: step.branches.map((branch) =>
                  branch.nextStepId === stepId ? { ...branch, nextStepId: WORKFLOW_END_ID } : branch
                ),
                fallbackNextStepId: step.fallbackNextStepId === stepId ? WORKFLOW_END_ID : step.fallbackNextStepId
              }
            : "nextStepId" in step && step.nextStepId === stepId
              ? { ...step, nextStepId: WORKFLOW_END_ID }
              : step
        )
      };
    });

    setSelectedWorkflowStepId((current) => (current === stepId ? null : current));
    setWorkflowContextMenu(null);
  };

  useEffect(() => {
    const handleWindowClick = () => setWorkflowContextMenu(null);
    window.addEventListener("click", handleWindowClick);
    return () => window.removeEventListener("click", handleWindowClick);
  }, []);

  useEffect(() => {
    if (!workflowList.length) {
      if (selectedWorkflowId !== null) {
        setSelectedWorkflowId(null);
      }
      if (selectedWorkflowStepId !== null) {
        setSelectedWorkflowStepId(null);
      }
      return;
    }

    if (!selectedWorkflowId || !workflowList.some((workflow) => workflow.id === selectedWorkflowId)) {
      setSelectedWorkflowId(workflowList[0]?.id ?? null);
      setSelectedWorkflowStepId(null);
    }
  }, [selectedWorkflowId, selectedWorkflowStepId, workflowList]);

  const renderWorkflow = () => (
    <article className="content-card automation-settings-card">
      <div className="card-header">
        <div>
          <h3 className="card-title">Structured workflow</h3>
          <p className="muted">Define a graph-like step flow now, then layer drag-and-drop on top later.</p>
        </div>
      </div>

      <section className="lead-record-panel">
        <div className="lead-record-section-head">
          <strong>Workflow list</strong>
          <span>Create, select, and manage multiple workflows for this workspace.</span>
        </div>
        <div className="composer-actions inline-actions">
          <button className="button button-secondary compact-button" onClick={createWorkflow} type="button">
            New workflow
          </button>
        </div>
        <div className="automation-workflow-list">
          {workflowList.map((workflow) => (
            <div
              className={`automation-workflow-list-item${workflow.id === selectedWorkflowId ? " selected" : ""}`}
              key={workflow.id}
            >
              <button
                className="automation-workflow-list-main"
                onClick={() => setSelectedWorkflowId(workflow.id)}
                type="button"
              >
                <strong>{workflow.name}</strong>
                <span>{workflow.isActive ? "Active runtime workflow" : "Draft workflow"}</span>
              </button>
              <div className="automation-workflow-list-actions">
                {!workflow.isActive ? (
                  <button className="inbox-search-tool" onClick={() => setActiveWorkflow(workflow.id)} type="button">
                    Set active
                  </button>
                ) : (
                  <span className="lead-chip">Active</span>
                )}
                <button className="inbox-search-tool" onClick={() => deleteWorkflow(workflow.id)} type="button">
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="lead-record-panel">
        <div className="lead-record-section-head">
          <strong>Workflow canvas</strong>
          <span>Sequential Workflow Designer canvas with the existing Connexa inspector on the right.</span>
        </div>
        {!selectedWorkflow ? (
          <div className="table-subtle">
            No workflows yet. Create a workflow to open the designer and test panel.
          </div>
        ) : (
          <>
          <label className="lead-record-field lead-record-field-wide">
            <span>Workflow name</span>
            <input
              className="lead-record-input"
              onChange={(event) =>
                setWorkflowList((current) =>
                  current.map((workflow) =>
                    workflow.id === selectedWorkflow.id ? { ...workflow, name: event.target.value } : workflow
                  )
                )
              }
              value={selectedWorkflow.name}
            />
          </label>
        <div className="automation-workflow-builder">
          <WorkflowLibraryDesigner
            onChange={(nextValue) =>
              setWorkflowList((current) =>
                current.map((workflow) =>
                  workflow.id === selectedWorkflowId ? { ...workflow, definitionJson: nextValue } : workflow
                )
              )
            }
            onSelectedStepIdChange={setSelectedWorkflowStepId}
            value={selectedWorkflow?.definitionJson ?? DEFAULT_WORKFLOW_DEFINITION_JSON}
          />

          <div className="automation-workflow-inspector">
            <section className="lead-record-panel workflow-variable-panel">
              <div className="lead-record-section-head">
                <strong>{`Workflow variables (${selectedWorkflowVariables.length})`}</strong>
                <span>Create reusable variables once, then select them from ask and decision nodes.</span>
              </div>

              <div className="workflow-panel-body workflow-variable-body">
                <div className="workflow-variable-toolbar">
                  <button className="button button-secondary compact-button" onClick={() => createWorkflowVariable()} type="button">
                    Add variable
                  </button>
                </div>

                {workflowVariableTree.length ? (
                  <div className="workflow-variable-tree">
                    {workflowVariableTree.map(({ group, variables }) => {
                      const isExpanded = expandedWorkflowVariableGroups.includes(group);
                      return (
                        <div className="workflow-variable-tree-group" key={group}>
                          <button
                            className="workflow-variable-tree-group-toggle"
                            onClick={() =>
                              setExpandedWorkflowVariableGroups((current) =>
                                current.includes(group) ? current.filter((entry) => entry !== group) : [...current, group]
                              )
                            }
                            type="button"
                          >
                            <span className="workflow-variable-tree-group-caret">{isExpanded ? "▾" : "▸"}</span>
                            <strong>{group}</strong>
                            <span>{variables.length}</span>
                          </button>
                          {isExpanded ? (
                            <div className="workflow-variable-tree-children">
                              {variables.map((variable) => (
                                <button
                                  className={`workflow-variable-tree-item ${
                                    selectedWorkflowVariableKey === variable.key ? "selected" : ""
                                  }`}
                                  key={variable.key}
                                  onClick={() => setSelectedWorkflowVariableKey(variable.key)}
                                  type="button"
                                >
                                  <span>{getWorkflowVariableLeafKey(variable.key)}</span>
                                  <small>{variable.key}</small>
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="table-subtle">No variables yet. Create one and attach it to an ask or decision step.</div>
                )}

                {selectedWorkflowVariable ? (
                  <div className="workflow-variable-editor">
                    <div className="workflow-variable-editor-head">
                      <strong>{selectedWorkflowVariable.key}</strong>
                      <span>{getWorkflowVariableGroup(selectedWorkflowVariable.key)}</span>
                    </div>
                    <label className="lead-record-field">
                      <span>Variable key</span>
                      <input
                        className="lead-record-input"
                        onChange={(event) => renameWorkflowVariable(selectedWorkflowVariable.key, event.target.value)}
                        value={selectedWorkflowVariable.key}
                      />
                    </label>
                    <label className="lead-record-field">
                      <span>Description</span>
                      <input
                        className="lead-record-input"
                        onChange={(event) =>
                          updateWorkflowVariables((current) =>
                            current.map((entry) =>
                              entry.key === selectedWorkflowVariable.key
                                ? { ...entry, description: event.target.value.trim() || null }
                                : entry
                            )
                          )
                        }
                        placeholder="Optional note for the team"
                        value={selectedWorkflowVariable.description ?? ""}
                      />
                    </label>
                    <div className="workflow-variable-row-delete">
                      <span className="muted">{selectedWorkflowVariable.key}</span>
                      <button
                        className="button button-secondary compact-button"
                        onClick={() => removeWorkflowVariable(selectedWorkflowVariable.key)}
                        type="button"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </section>

            {selectedWorkflowStep ? (
              <section className="lead-record-panel workflow-node-panel">
                <div className="lead-record-section-head">
                  <strong>Node inspector</strong>
                  <span>Edit the selected node without touching raw JSON.</span>
                </div>

                <div className="workflow-panel-body workflow-node-body">
                <div className="lead-record-form-grid">
                  <label className="lead-record-field">
                    <span>Node ID</span>
                    <input className="lead-record-input" readOnly value={selectedWorkflowStep.id} />
                  </label>
                  <label className="lead-record-field">
                    <span>Type</span>
                    <input className="lead-record-input" readOnly value={selectedWorkflowStep.type} />
                  </label>
                  <label className="lead-record-field lead-record-field-wide">
                    <span>Title</span>
                    <input
                      className="lead-record-input"
                      onChange={(event) =>
                        updateSelectedWorkflowStep((step) => ({ ...step, title: event.target.value }))
                      }
                      value={selectedWorkflowStep.title ?? ""}
                    />
                  </label>
                  {"prompt" in selectedWorkflowStep ? (
                    <label className="lead-record-field lead-record-field-wide">
                      <span>Prompt</span>
                      <textarea
                        className="lead-record-input lead-record-textarea"
                        onChange={(event) =>
                          updateSelectedWorkflowStep((step) => ({ ...step, prompt: event.target.value }))
                        }
                        value={selectedWorkflowStep.prompt ?? ""}
                      />
                    </label>
                  ) : null}
                  {"prompt" in selectedWorkflowStep && selectedWorkflowStep.type === "ask" ? (
                    <>
                      <label className="lead-record-field">
                        <span>Save reply into</span>
                        <select
                          className="lead-record-input app-select"
                          onChange={(event) =>
                            updateSelectedWorkflowStep((step) => ({
                              ...step,
                              saveAs: event.target.value || null
                            }))
                          }
                          value={selectedWorkflowStep.saveAs ?? ""}
                        >
                          <option value="">Do not save this reply</option>
                          {selectedWorkflowVariables.map((variable) => (
                            <option key={variable.key} value={variable.key}>
                              {variable.key}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="lead-record-field">
                        <span>Create variable</span>
                        <button
                          className="button button-secondary compact-button"
                          onClick={() => createWorkflowVariable("saveAs")}
                          type="button"
                        >
                          Add and select
                        </button>
                      </div>
                    </>
                  ) : null}
                  {"prompt" in selectedWorkflowStep &&
                  (selectedWorkflowStep.type === "question" || selectedWorkflowStep.type === "choice") ? (
                    <label className="lead-record-field">
                      <span>Decision source</span>
                      <select
                        className="lead-record-input app-select"
                        onChange={(event) =>
                          updateSelectedWorkflowStep((step) => ({
                            ...step,
                            decisionSource: event.target.value === "savedValue" ? "savedValue" : "currentReply"
                          }))
                        }
                        value={selectedWorkflowStep.decisionSource ?? "currentReply"}
                      >
                        <option value="currentReply">Current reply</option>
                        <option value="savedValue">Saved value</option>
                      </select>
                    </label>
                  ) : null}
                  {"prompt" in selectedWorkflowStep &&
                  (selectedWorkflowStep.type === "question" || selectedWorkflowStep.type === "choice") &&
                  (selectedWorkflowStep.decisionSource ?? "currentReply") === "savedValue" ? (
                    <>
                      <label className="lead-record-field lead-record-field-wide">
                        <span>Saved variable</span>
                        <select
                          className="lead-record-input app-select"
                          onChange={(event) =>
                            updateSelectedWorkflowStep((step) => ({
                              ...step,
                              decisionSourceKey: event.target.value || null
                            }))
                          }
                          value={selectedWorkflowStep.decisionSourceKey ?? ""}
                        >
                          <option value="">Select a saved variable</option>
                          {selectedWorkflowVariables.map((variable) => (
                            <option key={variable.key} value={variable.key}>
                              {variable.key}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="lead-record-field">
                        <span>Create variable</span>
                        <button
                          className="button button-secondary compact-button"
                          onClick={() => createWorkflowVariable("decisionSourceKey")}
                          type="button"
                        >
                          Add and select
                        </button>
                      </div>
                    </>
                  ) : null}
                  {"prompt" in selectedWorkflowStep &&
                  (selectedWorkflowStep.type === "question" || selectedWorkflowStep.type === "choice") ? (
                    <label className="lead-record-field">
                      <span>Max retries</span>
                      <input
                        className="lead-record-input"
                        inputMode="numeric"
                        min={1}
                        onChange={(event) =>
                          updateSelectedWorkflowStep((step) => ({
                            ...step,
                            maxRetries:
                              event.target.value.trim() && Number(event.target.value) > 0
                                ? Math.round(Number(event.target.value))
                                : null
                          }))
                        }
                        placeholder="Unlimited"
                        value={selectedWorkflowStep.maxRetries ? `${selectedWorkflowStep.maxRetries}` : ""}
                      />
                    </label>
                  ) : null}
                  {"prompt" in selectedWorkflowStep &&
                  (selectedWorkflowStep.type === "question" || selectedWorkflowStep.type === "choice") ? (
                    <label className="lead-record-field lead-record-field-wide">
                      <span>Fallback reply</span>
                      <textarea
                        className="lead-record-input lead-record-textarea"
                        onChange={(event) =>
                          updateSelectedWorkflowStep((step) => ({
                            ...step,
                            fallbackReply: event.target.value
                          }))
                        }
                        placeholder={
                          selectedWorkflowStep.type === "choice"
                            ? "Please reply with one of the listed options."
                            : "Please reply yes or no."
                        }
                        value={selectedWorkflowStep.fallbackReply ?? ""}
                      />
                    </label>
                  ) : null}
                  {"prompt" in selectedWorkflowStep &&
                  (selectedWorkflowStep.type === "question" || selectedWorkflowStep.type === "choice") ? (
                    <label className="lead-record-field">
                      <span>Fallback next step</span>
                      <select
                        className="lead-record-input app-select"
                        onChange={(event) =>
                          updateSelectedWorkflowStep((step) => ({
                            ...step,
                            fallbackNextStepId: event.target.value || null
                          }))
                        }
                        value={selectedWorkflowStep.fallbackNextStepId ?? ""}
                      >
                        <option value="">Stay on this node</option>
                        {normalizedWorkflow?.workflow.steps
                          .filter((step) => step.id !== selectedWorkflowStep.id)
                          .map((step) => (
                            <option key={step.id} value={step.id}>
                              {step.id === WORKFLOW_END_ID ? "End" : step.title || step.id}
                            </option>
                          ))}
                      </select>
                    </label>
                  ) : null}
                  {"prompt" in selectedWorkflowStep && selectedWorkflowStep.type === "ask" ? (
                    <label className="lead-record-field">
                      <span>Next step</span>
                      <select
                        className="lead-record-input app-select"
                        onChange={(event) =>
                          updateSelectedWorkflowStep((step) => ({
                            ...step,
                            nextStepId: event.target.value || null
                          }))
                        }
                        value={selectedWorkflowStep.nextStepId ?? ""}
                      >
                        <option value="">End flow</option>
                        {normalizedWorkflow?.workflow.steps
                          .filter((step) => step.id !== selectedWorkflowStep.id)
                          .map((step) => (
                            <option key={step.id} value={step.id}>
                              {step.id === WORKFLOW_END_ID ? "End" : step.title || step.id}
                            </option>
                          ))}
                      </select>
                    </label>
                  ) : null}
                  {"reply" in selectedWorkflowStep ? (
                    <label className="lead-record-field lead-record-field-wide">
                      <span>Reply</span>
                      <textarea
                        className="lead-record-input lead-record-textarea"
                        onChange={(event) =>
                          updateSelectedWorkflowStep((step) => ({ ...step, reply: event.target.value }))
                        }
                        value={selectedWorkflowStep.reply ?? ""}
                      />
                    </label>
                  ) : null}
                  {"tags" in selectedWorkflowStep ? (
                    <label className="lead-record-field lead-record-field-wide">
                      <span>Tags</span>
                      <input
                        className="lead-record-input"
                        onChange={(event) =>
                          updateSelectedWorkflowStep((step) => ({
                            ...step,
                            tags: event.target.value.split(",").map((tag) => tag.trim()).filter(Boolean)
                          }))
                        }
                        value={selectedWorkflowStep.tags?.join(", ") ?? ""}
                      />
                    </label>
                  ) : null}
                  {"assignOwnerId" in selectedWorkflowStep ? (
                    <label className="lead-record-field">
                      <span>Assign owner ID</span>
                      <input
                        className="lead-record-input"
                        onChange={(event) =>
                          updateSelectedWorkflowStep((step) => ({
                            ...step,
                            assignOwnerId: event.target.value.trim() || null
                          }))
                        }
                        value={selectedWorkflowStep.assignOwnerId ?? ""}
                      />
                    </label>
                  ) : null}
                  {"leadStage" in selectedWorkflowStep ? (
                    <label className="lead-record-field">
                      <span>Lead stage</span>
                      <select
                        className="lead-record-input app-select"
                        onChange={(event) =>
                          updateSelectedWorkflowStep((step) => ({
                            ...step,
                            leadStage: event.target.value || null
                          }))
                        }
                        value={selectedWorkflowStep.leadStage ?? ""}
                      >
                        <option value="">No change</option>
                        <option value="NEW_LEAD">New lead</option>
                        <option value="QUALIFIED">Qualified</option>
                        <option value="SITE_VISIT_BOOKED">Site visit booked</option>
                        <option value="FOLLOW_UP">Follow up</option>
                        <option value="NEGOTIATION">Negotiation</option>
                        <option value="CLOSED_WON">Closed won</option>
                        <option value="CLOSED_LOST">Closed lost</option>
                      </select>
                    </label>
                  ) : null}
                  {"nextStepId" in selectedWorkflowStep ? (
                    <div className="lead-record-field">
                      <span>Next step</span>
                      <select
                        className="lead-record-input app-select"
                        onChange={(event) =>
                          updateSelectedWorkflowStep((step) => ({
                            ...step,
                            nextStepId: event.target.value || null
                          }))
                        }
                        value={selectedWorkflowStep.nextStepId ?? ""}
                      >
                        <option value="">End flow</option>
                        {normalizedWorkflow?.workflow.steps
                          .filter((step) => step.id !== selectedWorkflowStep.id)
                          .map((step) => (
                            <option key={step.id} value={step.id}>
                              {step.id === WORKFLOW_END_ID ? "End" : step.title || step.id}
                            </option>
                          ))}
                      </select>
                    </div>
                  ) : null}
                  {"branches" in selectedWorkflowStep ? (
                    <div className="lead-record-field lead-record-field-wide automation-workflow-branch-list">
                      <span>Branches</span>
                      {selectedWorkflowStep.branches?.map((branch, index) => (
                        <div className="automation-workflow-branch-card" key={branch.id}>
                          <input
                            className="lead-record-input"
                            onChange={(event) =>
                              updateSelectedWorkflowStep((step) => ({
                                ...step,
                                branches: step.branches?.map((item, itemIndex) =>
                                  itemIndex === index ? { ...item, label: event.target.value } : item
                                ) ?? []
                              }))
                            }
                            placeholder="Branch label"
                            value={branch.label}
                          />
                          <input
                            className="lead-record-input"
                            onChange={(event) =>
                              updateSelectedWorkflowStep((step) => ({
                                ...step,
                                branches: step.branches?.map((item, itemIndex) =>
                                  itemIndex === index
                                    ? {
                                        ...item,
                                        keywords: event.target.value
                                          .split(",")
                                          .map((keyword) => keyword.trim())
                                          .filter(Boolean)
                                      }
                                    : item
                                ) ?? []
                              }))
                            }
                            placeholder="Keywords"
                            value={branch.keywords.join(", ")}
                          />
                          <input
                            className="lead-record-input"
                            onChange={(event) =>
                              updateSelectedWorkflowStep((step) => ({
                                ...step,
                                branches: step.branches?.map((item, itemIndex) =>
                                  itemIndex === index ? { ...item, reply: event.target.value } : item
                                ) ?? []
                              }))
                            }
                            placeholder="Reply"
                            value={branch.reply ?? ""}
                          />
                          <select
                            className="lead-record-input app-select"
                            onChange={(event) =>
                              updateSelectedWorkflowStep((step) => ({
                                ...step,
                                branches: step.branches?.map((item, itemIndex) =>
                                  itemIndex === index ? { ...item, nextStepId: event.target.value || null } : item
                                ) ?? []
                              }))
                            }
                            value={branch.nextStepId ?? ""}
                          >
                            <option value="">End flow</option>
                            {normalizedWorkflow?.workflow.steps
                              .filter((step) => step.id !== selectedWorkflowStep.id)
                              .map((step) => (
                                <option key={step.id} value={step.id}>
                                  {step.id === WORKFLOW_END_ID ? "End" : step.title || step.id}
                                </option>
                              ))}
                          </select>
                          <button
                            className="button button-secondary compact-button"
                            onClick={() =>
                              updateSelectedWorkflowStep((step) => ({
                                ...step,
                                branches: step.branches?.filter((_, itemIndex) => itemIndex !== index) ?? []
                              }))
                            }
                            type="button"
                          >
                            Remove branch
                          </button>
                        </div>
                      ))}
                      <button
                        className="button button-secondary compact-button"
                        onClick={() =>
                          updateSelectedWorkflowStep((step) => {
                            const nextIndex = (step.branches?.length ?? 0) + 1;
                            const nextId = step.type === "choice" ? `${nextIndex}` : `branch-${nextIndex}`;
                            return {
                              ...step,
                              branches: [
                                ...(step.branches ?? []),
                                {
                                  id: nextId,
                                  label: step.type === "choice" ? `Option ${nextIndex}` : `Branch ${nextIndex}`,
                                  keywords: [nextId],
                                  reply: "",
                                  nextStepId: null,
                                  tags: []
                                }
                              ]
                            };
                          })
                        }
                        type="button"
                      >
                        Add branch
                      </button>
                    </div>
                  ) : null}
                </div>

                <div className="composer-actions inline-actions">
                  <button
                    className="button button-secondary compact-button"
                    onClick={removeSelectedWorkflowStep}
                    type="button"
                  >
                    Delete node
                  </button>
                </div>
                </div>
              </section>
            ) : (
              <section className="lead-record-panel workflow-node-panel">
                <div className="lead-record-section-head">
                  <strong>Node inspector</strong>
                  <span>Edit the selected node without touching raw JSON.</span>
                </div>
                <div className="workflow-panel-body workflow-node-body">
                  <div className="table-subtle">Select a node to edit its settings.</div>
                </div>
              </section>
            )}
          </div>
        </div>
          </>
        )}
      </section>

      {selectedWorkflow ? <WorkflowTestPanel value={selectedWorkflow.definitionJson} /> : null}

      {error ? <div className="form-error">{error}</div> : null}

      <div className="composer-actions">
        <button
          className="button button-secondary"
          disabled={isPending || !selectedWorkflow}
          onClick={() =>
            setWorkflowList((current) =>
              current.map((workflow) =>
                workflow.id === selectedWorkflowId ? { ...workflow, definitionJson: DEFAULT_WORKFLOW_DEFINITION_JSON } : workflow
              )
            )
          }
          type="button"
        >
          Load sample workflow
        </button>
        <button
          className="button button-primary"
          disabled={isPending || !selectedWorkflow}
          onClick={saveSelectedWorkflow}
          type="button"
        >
          {isPending ? "Saving..." : "Save workflow"}
        </button>
      </div>
    </article>
  );

  return (
    <section className="automation-layout">
      <article className="content-card automation-tab-shell">
        <div className="card-header automation-tab-header">
          <div>
            <h3 className="card-title">Automation workspace</h3>
            <p className="muted">Keep the core automation controls close by and switch sections only when needed.</p>
          </div>
        </div>

        <div aria-label="Automation sections" className="automation-tab-list" role="tablist">
          {TABS.map((tab) => (
            <button
              aria-selected={activeTab === tab.id}
              className={`automation-tab-button ${activeTab === tab.id ? "active" : ""}`}
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              role="tab"
              type="button"
            >
              <strong>{tab.label}</strong>
              <span>{tab.description}</span>
            </button>
          ))}
        </div>
      </article>

      {activeTab === "rules" ? renderRules() : null}
      {activeTab === "hours" ? renderHours() : null}
      {activeTab === "workflow" ? renderWorkflow() : null}
    </section>
  );
}

type WorkflowVariableType = "text";

type WorkflowVariable = {
  key: string;
  type: WorkflowVariableType;
  description?: string | null;
};

type WorkflowDraft = {
  startStepId: string;
  variables?: WorkflowVariable[];
  steps: Array<{
    id: string;
    type: "ask" | "question" | "choice" | "action" | "end";
    title?: string;
    position?: { x: number; y: number };
    prompt?: string;
    saveAs?: string | null;
    decisionSource?: "currentReply" | "savedValue";
    decisionSourceKey?: string | null;
    maxRetries?: number | null;
    reply?: string;
    tags?: string[];
    assignOwnerId?: string | null;
    leadStage?: string | null;
    nextStepId?: string | null;
    fallbackReply?: string | null;
    fallbackNextStepId?: string | null;
    branches?: Array<{
      id: string;
      label: string;
      keywords: string[];
      reply?: string;
      nextStepId?: string | null;
      tags?: string[];
    }>;
  }>;
};

const DEFAULT_WORKFLOW_DEFINITION_JSON = JSON.stringify(
  {
    startStepId: "workflow-end",
    variables: [],
    steps: [
      {
        id: "workflow-end",
        type: "end",
        title: "End",
        reply: ""
      }
    ]
  },
  null,
  2
);

function parseWorkflowDraft(value: string): WorkflowDraft | null {
  try {
    const parsed = JSON.parse(value) as WorkflowDraft;
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.steps) || typeof parsed.startStepId !== "string") {
      return null;
    }
    return {
      ...parsed,
      variables: normalizeWorkflowVariables(parsed.variables)
    };
  } catch {
    return null;
  }
}

function normalizeWorkflowVariableKey(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (!normalized) {
    return "variable";
  }

  return /^\d/.test(normalized) ? `var_${normalized}` : normalized;
}

function getWorkflowVariableGroup(key: string): string {
  const parts = key.split("_").filter(Boolean);
  if (parts.length <= 1) {
    return "general";
  }
  return parts[0];
}

function getWorkflowVariableLeafKey(key: string): string {
  const parts = key.split("_").filter(Boolean);
  if (parts.length <= 1) {
    return key;
  }
  return parts.slice(1).join("_");
}

function normalizeWorkflowVariableType(_value: unknown): WorkflowVariableType {
  return "text";
}

function normalizeWorkflowVariables(value: unknown): WorkflowVariable[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const usedKeys = new Set<string>();
  const normalized: WorkflowVariable[] = [];

  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const record = entry as Record<string, unknown>;
    const baseKey = normalizeWorkflowVariableKey(
      typeof record.key === "string" && record.key.trim()
        ? record.key
        : typeof record.label === "string"
          ? record.label
          : ""
    );

    let key = baseKey;
    let duplicateIndex = 2;
    while (usedKeys.has(key)) {
      key = `${baseKey}_${duplicateIndex}`;
      duplicateIndex += 1;
    }

    usedKeys.add(key);
    normalized.push({
      key,
      type: normalizeWorkflowVariableType(record.type),
      description: typeof record.description === "string" && record.description.trim() ? record.description.trim() : null
    });
  }

  return normalized;
}

