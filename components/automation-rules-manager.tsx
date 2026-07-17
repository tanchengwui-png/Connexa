"use client";

import { createPortal } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition, type CSSProperties } from "react";
import { AttachmentPreview } from "@/components/attachment-preview";
import { AutomationEntryQrPanel } from "@/components/automation-entry-qr-panel";
import { AutomationTestPanel } from "@/components/automation-test-panel";
import { useConfirmation } from "@/components/confirmation-provider";
import { FullEmojiPicker } from "@/components/full-emoji-picker";
import { AttachmentIcon, EmojiIcon } from "@/components/inbox/icons";
import { INBOX_LAYERS } from "@/components/inbox/layers";
import { PortalDropdown } from "@/components/inbox/portal-dropdown";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/toast-provider";
import { WorkflowLibraryDesigner } from "@/components/workflow-library-designer";
import { MediaAssetKind, type MediaAssetKind as MediaAssetKindValue } from "@/lib/db-types";
import {
  formatMediaAssetSize,
  getMediaKindLabel,
  isAudioMimeType,
  isDocumentMimeType,
  type MediaLibraryAsset
} from "@/lib/media-library-shared";
import {
  getWorkflowContentAttributeHelperText,
  getWorkflowContentAttributePlaceholder,
  normalizeWorkflowContentAttributeKey,
  validateWorkflowContentAttributeLiteral,
  WORKFLOW_CONTENT_ATTRIBUTE_OPTIONS
} from "@/lib/workflow-content-attributes";
import {
  encodeRuleMatcher,
  RULE_LANGUAGE_OPTIONS,
  RULE_MATCH_OPERATORS,
  RULE_MATCH_OPERATOR_OPTIONS,
  type RuleMatchOperator
} from "@/lib/automation-rule-operators";
import { AutomationMatchType, AutomationTriggerType } from "@/lib/db-types";

type AutomationRulesManagerProps = {
  workspaceId: string;
  liveKeywordTesting: {
    connectionStatus: string;
    displayName: string | null;
    phoneNumber: string | null;
  };
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
    activeWorkflowIds: string[];
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
    matchOperator: RuleMatchOperator;
    matchLabel: string;
    keyword: string | null;
    replyBody: string;
    replyMediaAssetIds: string[];
    replyMediaAssets: Array<{
      id: string;
      title: string;
      kind: MediaAssetKindValue;
      mimeType: string;
      url: string;
    }>;
    replyMediaAssetId: string | null;
    replyMediaAssetTitle: string | null;
    replyMediaAssetKind: MediaAssetKindValue | null;
    replyMediaAssetUrl: string | null;
    workflowId: string | null;
    workflowName: string | null;
    addTags: string[];
    priority: number;
    cooldownMinutes: number;
    stopAfterMatch: boolean;
    businessHoursOnly: boolean;
    followUpDelayMinutes: number | null;
    followUpReplyBody: string | null;
    followUpMediaAssetIds: string[];
    followUpMediaAssets: Array<{
      id: string;
      title: string;
      kind: MediaAssetKindValue;
      mimeType: string;
      url: string;
    }>;
    followUpMediaAssetId: string | null;
    followUpMediaAssetTitle: string | null;
    followUpMediaAssetKind: MediaAssetKindValue | null;
    followUpMediaAssetUrl: string | null;
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
  agents: Array<{
    id: string;
    name: string;
    role: string;
  }>;
  mediaAssets: MediaLibraryAsset[];
  mediaLimits: {
    totalAssets: number;
    imageCount: number;
    audioCount: number;
    videoCount: number;
    documentCount: number;
    usedStorageBytes: number;
    storageLimitBytes: number | null;
    remainingStorageBytes: number | null;
    storageUsagePercentage: number | null;
    isStorageUnlimited: boolean;
    hasStorageLimitConfigured: boolean;
    maxFileBytes: number;
  };
  workflows: Array<{
    id: string;
    name: string;
    definitionJson: string;
    isActive: boolean;
    updatedAtIso: string;
  }>;
};

type AutomationTab = "rules" | "hours" | "workflow" | "testing" | "entryQr";
type WorkflowWorkspaceMode = "side" | "bottom";
type AutomationViewMode = "list" | "editor";
const DEFAULT_WORKFLOW_WORKSPACE_MODE: WorkflowWorkspaceMode = "side";
const DEFAULT_WORKFLOW_CANVAS_WIDTH_PERCENT = 62;

const EMPTY_RULE_FORM: {
  id: string | null;
  name: string;
  triggerType: AutomationTriggerType;
  matchOperator: RuleMatchOperator;
  matchType: AutomationMatchType;
  keyword: string;
  replyBody: string;
  replyMediaAssetIds: string[];
  workflowId: string;
  addTags: string;
  priority: number;
  cooldownMinutes: number;
  stopAfterMatch: boolean;
  businessHoursOnly: boolean;
  followUpDelayMinutes: string;
  followUpReplyBody: string;
  followUpMediaAssetIds: string[];
  enabled: boolean;
} = {
  id: null as string | null,
  name: "",
  triggerType: AutomationTriggerType.KEYWORD_MATCH,
  matchOperator: RULE_MATCH_OPERATORS.CONTAINS_WORD,
  matchType: AutomationMatchType.CONTAINS,
  keyword: "",
  replyBody: "",
  replyMediaAssetIds: [],
  workflowId: "",
  addTags: "",
  priority: 100,
  cooldownMinutes: 360,
  stopAfterMatch: true,
  businessHoursOnly: false,
  followUpDelayMinutes: "",
  followUpReplyBody: "",
  followUpMediaAssetIds: [],
  enabled: false
};

const FOLLOW_UP_DELAY_PRESETS = [
  { label: "15 min", minutes: 15 },
  { label: "30 min", minutes: 30 },
  { label: "1 hr", minutes: 60 },
  { label: "3 hr", minutes: 180 },
  { label: "1 day", minutes: 1440 }
] as const;

const TABS: Array<{ id: AutomationTab; label: string; description: string }> = [
  { id: "rules", label: "Rules", description: "Welcome and keyword automation rules" },
  { id: "workflow", label: "Workflow", description: "Graph-style multi-step flow" },
  { id: "entryQr", label: "Entry QR", description: "Customer-facing WhatsApp QR and chat links" },
  { id: "testing", label: "Testing", description: "Send a fake inbound and watch automation run" },
  { id: "hours", label: "Hours", description: "Business hours, away reply, and pause" }
];

export function AutomationRulesManager({
  workspaceId,
  liveKeywordTesting,
  settings,
  rules,
  jobs,
  agents,
  mediaAssets,
  mediaLimits,
  workflows
}: AutomationRulesManagerProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const routeSearchParams = searchParams ?? new URLSearchParams();
  const { confirm } = useConfirmation();
  const { success, error: showError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<AutomationTab>("rules");
  const [settingsForm, setSettingsForm] = useState(settings);
  const previousHumanTakeoverPauseMinutesRef = useRef(
    settings.humanTakeoverPauseMinutes > 0 ? settings.humanTakeoverPauseMinutes : 240
  );
  const [ruleForm, setRuleForm] = useState(EMPTY_RULE_FORM);
  const [anyWordsDraft, setAnyWordsDraft] = useState("");
  const [isKeywordManagerOpen, setIsKeywordManagerOpen] = useState(false);
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
    targetType: "start" | "action" | "question" | "delay" | "end";
  } | null>(null);
  const [activeEmojiField, setActiveEmojiField] = useState<
    | "replyBody"
    | "followUpReplyBody"
    | "workflowReplyBody"
    | "workflowPromptBody"
    | "workflowFallbackReplyBody"
    | "workflowNotificationMessage"
    | `workflowMediaItemMessage:${string}`
    | null
  >(null);
  const [isWorkflowInspectorExpanded, setIsWorkflowInspectorExpanded] = useState(false);
  const [isQuestionOptionsOpen, setIsQuestionOptionsOpen] = useState(false);
  const [isNotificationOptionsOpen, setIsNotificationOptionsOpen] = useState(false);
  const workflowWorkspaceMode: WorkflowWorkspaceMode = DEFAULT_WORKFLOW_WORKSPACE_MODE;
  const [workflowCanvasWidthPercent, setWorkflowCanvasWidthPercent] = useState(
    DEFAULT_WORKFLOW_CANVAS_WIDTH_PERCENT
  );
  const workflowCanvasRef = useRef<HTMLDivElement | null>(null);
  const workflowBuilderRef = useRef<HTMLDivElement | null>(null);
  const workflowResizeStateRef = useRef<{ active: boolean }>({ active: false });
  const replyEmojiButtonRef = useRef<HTMLButtonElement | null>(null);
  const followUpEmojiButtonRef = useRef<HTMLButtonElement | null>(null);
  const workflowReplyEmojiButtonRef = useRef<HTMLButtonElement | null>(null);
  const workflowPromptEmojiButtonRef = useRef<HTMLButtonElement | null>(null);
  const workflowFallbackReplyEmojiButtonRef = useRef<HTMLButtonElement | null>(null);
  const workflowNotificationEmojiButtonRef = useRef<HTMLButtonElement | null>(null);
  const workflowMediaItemEmojiButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const replyBodyRef = useRef<HTMLTextAreaElement | null>(null);
  const followUpReplyBodyRef = useRef<HTMLTextAreaElement | null>(null);
  const workflowReplyBodyRef = useRef<HTMLTextAreaElement | null>(null);
  const workflowPromptBodyRef = useRef<HTMLTextAreaElement | null>(null);
  const workflowFallbackReplyBodyRef = useRef<HTMLTextAreaElement | null>(null);
  const workflowNotificationBodyRef = useRef<HTMLTextAreaElement | null>(null);
  const workflowMediaItemBodyRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const selectedMatchOperatorOption = RULE_MATCH_OPERATOR_OPTIONS.find(
    (option) => option.value === ruleForm.matchOperator
  );
  const matchValueRequired = Boolean(selectedMatchOperatorOption?.needsValue);
  const anyWordsValues = useMemo(
    () =>
      ruleForm.keyword
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    [ruleForm.keyword]
  );
  const anyWordsPreview = useMemo(() => anyWordsValues.slice(0, 4).join(", "), [anyWordsValues]);
  const humanTakeoverPauseEnabled = settingsForm.humanTakeoverPauseMinutes > 0;
  const activeMode: AutomationViewMode = routeSearchParams.get("mode") === "editor" ? "editor" : "list";
  const selectedRuleIdFromRoute = routeSearchParams.get("ruleId");
  const selectedWorkflowIdFromRoute = routeSearchParams.get("workflowId");

  const navigateAutomationView = (
    tab: AutomationTab,
    options?: {
      mode?: AutomationViewMode;
      ruleId?: string | null;
      workflowId?: string | null;
    }
  ) => {
    const params = new URLSearchParams(routeSearchParams.toString());
    params.set("tab", tab);

    if (options?.mode === "editor") {
      params.set("mode", "editor");
    } else {
      params.delete("mode");
    }

    if (tab === "rules" && options?.ruleId) {
      params.set("ruleId", options.ruleId);
    } else {
      params.delete("ruleId");
    }

    if (tab === "workflow" && options?.workflowId) {
      params.set("workflowId", options.workflowId);
    } else {
      params.delete("workflowId");
    }

    router.push(`/automation-rules?${params.toString()}`);
  };

  const beginEditRule = (ruleId: string) => {
    const rule = rules.find((item) => item.id === ruleId);
    if (!rule) {
      return;
    }

    setRuleForm({
      id: rule.id,
      name: rule.name,
      triggerType: rule.triggerType,
      matchOperator: rule.matchOperator,
      matchType: rule.matchType,
      keyword: rule.keyword ?? "",
      replyBody: rule.replyBody,
      replyMediaAssetIds: rule.replyMediaAssetIds,
      workflowId: rule.workflowId ?? "",
      addTags: rule.addTags.join(", "),
      priority: rule.priority,
      cooldownMinutes: rule.cooldownMinutes,
      stopAfterMatch: rule.stopAfterMatch,
      businessHoursOnly: rule.businessHoursOnly,
      followUpDelayMinutes: rule.followUpDelayMinutes ? `${rule.followUpDelayMinutes}` : "",
      followUpReplyBody: rule.followUpReplyBody ?? "",
      followUpMediaAssetIds: rule.followUpMediaAssetIds,
      enabled: rule.enabled
    });
    setAnyWordsDraft("");
    setIsKeywordManagerOpen(false);
  };

  const resetRuleForm = () => {
    setRuleForm(EMPTY_RULE_FORM);
    setAnyWordsDraft("");
    setIsKeywordManagerOpen(false);
  };

  const commitAnyWordsDraft = () => {
    const nextValues = Array.from(
      new Set(
        [...anyWordsValues, ...anyWordsDraft.split(",").map((item) => item.trim()).filter(Boolean)]
      )
    );
    setRuleForm((current) => ({
      ...current,
      keyword: nextValues.join(", ")
    }));
    setAnyWordsDraft("");
  };

  const removeAnyWordsValue = (valueToRemove: string) => {
    setRuleForm((current) => ({
      ...current,
      keyword: current.keyword
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item && item !== valueToRemove)
        .join(", ")
    }));
  };

  const clearAnyWordsValues = () => {
    setRuleForm((current) => ({
      ...current,
      keyword: ""
    }));
    setAnyWordsDraft("");
  };

  const insertEmoji = (field: "replyBody" | "followUpReplyBody", emoji: string) => {
    const textarea = field === "replyBody" ? replyBodyRef.current : followUpReplyBodyRef.current;

    setRuleForm((current) => {
      const currentValue = current[field];
      if (!textarea) {
        return {
          ...current,
          [field]: `${currentValue}${emoji}`
        };
      }

      const start = textarea.selectionStart ?? currentValue.length;
      const end = textarea.selectionEnd ?? currentValue.length;
      const nextValue = `${currentValue.slice(0, start)}${emoji}${currentValue.slice(end)}`;

      queueMicrotask(() => {
        textarea.focus();
        const nextCaret = start + emoji.length;
        textarea.setSelectionRange(nextCaret, nextCaret);
      });

      return {
        ...current,
        [field]: nextValue
      };
    });
  };

  const insertWorkflowReplyEmoji = (emoji: string) => {
    const textarea = workflowReplyBodyRef.current;

    updateSelectedWorkflowStep((step) => {
      if (!("reply" in step)) {
        return step;
      }

      const currentValue = step.reply ?? "";
      if (!textarea) {
        return {
          ...step,
          reply: `${currentValue}${emoji}`
        };
      }

      const start = textarea.selectionStart ?? currentValue.length;
      const end = textarea.selectionEnd ?? currentValue.length;
      const nextValue = `${currentValue.slice(0, start)}${emoji}${currentValue.slice(end)}`;

      queueMicrotask(() => {
        textarea.focus();
        const nextCaret = start + emoji.length;
        textarea.setSelectionRange(nextCaret, nextCaret);
      });

      return {
        ...step,
        reply: nextValue
      };
    });
  };

  const insertWorkflowPromptEmoji = (emoji: string) => {
    const textarea = workflowPromptBodyRef.current;

    updateSelectedWorkflowStep((step) => {
      if (!("prompt" in step)) {
        return step;
      }

      const currentValue = step.prompt ?? "";
      if (!textarea) {
        return {
          ...step,
          prompt: `${currentValue}${emoji}`
        };
      }

      const start = textarea.selectionStart ?? currentValue.length;
      const end = textarea.selectionEnd ?? currentValue.length;
      const nextValue = `${currentValue.slice(0, start)}${emoji}${currentValue.slice(end)}`;

      queueMicrotask(() => {
        textarea.focus();
        const nextCaret = start + emoji.length;
        textarea.setSelectionRange(nextCaret, nextCaret);
      });

      return {
        ...step,
        prompt: nextValue
      };
    });
  };

  const insertWorkflowFallbackReplyEmoji = (emoji: string) => {
    const textarea = workflowFallbackReplyBodyRef.current;

    updateSelectedWorkflowStep((step) => {
      if (!(step.type === "question" || step.type === "choice")) {
        return step;
      }

      const currentValue = step.fallbackReply ?? "";
      if (!textarea) {
        return {
          ...step,
          fallbackReply: `${currentValue}${emoji}`
        };
      }

      const start = textarea.selectionStart ?? currentValue.length;
      const end = textarea.selectionEnd ?? currentValue.length;
      const nextValue = `${currentValue.slice(0, start)}${emoji}${currentValue.slice(end)}`;

      queueMicrotask(() => {
        textarea.focus();
        const nextCaret = start + emoji.length;
        textarea.setSelectionRange(nextCaret, nextCaret);
      });

      return {
        ...step,
        fallbackReply: nextValue
      };
    });
  };

  const insertWorkflowNotificationEmoji = (emoji: string) => {
    const textarea = workflowNotificationBodyRef.current;

    updateSelectedWorkflowStep((step) => {
      if (!(step.type === "update" || step.type === "action")) {
        return step;
      }

      const currentValue = step.notifyMessage ?? "";
      if (!textarea) {
        return {
          ...step,
          notifyMessage: `${currentValue}${emoji}`
        };
      }

      const start = textarea.selectionStart ?? currentValue.length;
      const end = textarea.selectionEnd ?? currentValue.length;
      const nextValue = `${currentValue.slice(0, start)}${emoji}${currentValue.slice(end)}`;

      queueMicrotask(() => {
        textarea.focus();
        const nextCaret = start + emoji.length;
        textarea.setSelectionRange(nextCaret, nextCaret);
      });

      return {
        ...step,
        notifyMessage: nextValue
      };
    });
  };

  const insertWorkflowMediaItemEmoji = (mediaAssetId: string, emoji: string) => {
    const textarea = workflowMediaItemBodyRefs.current[mediaAssetId];

    updateSelectedWorkflowStep((step) => {
      if (!("mediaItems" in step)) {
        return step;
      }

      return {
        ...step,
        mediaItems: (step.mediaItems ?? []).map((item) => {
          if (item.mediaAssetId !== mediaAssetId) {
            return item;
          }

          const currentValue = item.message ?? "";
          if (!textarea) {
            return {
              ...item,
              message: `${currentValue}${emoji}`
            };
          }

          const start = textarea.selectionStart ?? currentValue.length;
          const end = textarea.selectionEnd ?? currentValue.length;
          const nextValue = `${currentValue.slice(0, start)}${emoji}${currentValue.slice(end)}`;

          queueMicrotask(() => {
            textarea.focus();
            const nextCaret = start + emoji.length;
            textarea.setSelectionRange(nextCaret, nextCaret);
          });

          return {
            ...item,
            message: nextValue
          };
        })
      };
    });
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

      const nextWorkflow = { ...payload.workflow, isActive: workflowList.length === 0 };
      setWorkflowList((current) => [nextWorkflow, ...current]);
      setSelectedWorkflowId(nextWorkflow.id);
      if (workflowList.length === 0) {
        setSettingsForm((current) => ({
          ...current,
          workflowFlowEnabled: true,
          activeWorkflowIds: [nextWorkflow.id],
          activeWorkflowId: nextWorkflow.id
        }));
      }
      success("Workflow created", `${nextWorkflow.name} is ready.`);
      navigateAutomationView("workflow", { mode: "editor", workflowId: nextWorkflow.id });
    });
  };

  const saveSelectedWorkflow = () => {
    if (!selectedWorkflow) {
      return;
    }

    const validationError = getWorkflowSaveValidationError(selectedWorkflow.definitionJson);
    if (validationError) {
      setError(validationError);
      showError("Workflow not saved", validationError);
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

  const toggleWorkflowActive = (workflowId: string, nextIsActive: boolean) => {
    const workflow = workflowList.find((item) => item.id === workflowId);
    const validationError =
      nextIsActive && workflow ? getWorkflowActivationValidationError(workflow.definitionJson) : null;

    if (validationError) {
      setError(validationError);
      showError("Workflow not activated", validationError);
      return;
    }

    setError(null);
    startTransition(async () => {
      const response = await fetch(`/api/automation-workflows/${workflowId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          isActive: nextIsActive
        })
      });

      const payload = (await response.json().catch(() => null)) as
        | { error?: string; workflow?: AutomationRulesManagerProps["workflows"][number] }
        | null;

      if (!response.ok || !payload?.workflow) {
        const message = payload?.error ?? `Unable to ${nextIsActive ? "activate" : "deactivate"} workflow.`;
        setError(message);
        showError(`Workflow not ${nextIsActive ? "activated" : "deactivated"}`, message);
        return;
      }

      setSettingsForm((current) => {
        const nextActiveWorkflowIds = nextIsActive
          ? Array.from(new Set([...current.activeWorkflowIds, payload.workflow!.id]))
          : current.activeWorkflowIds.filter((id) => id !== payload.workflow?.id);

        return {
          ...current,
          workflowFlowEnabled: nextIsActive ? true : current.workflowFlowEnabled,
          activeWorkflowIds: nextActiveWorkflowIds,
          activeWorkflowId: nextActiveWorkflowIds[0] ?? null
        };
      });
      setWorkflowList((current) =>
        current.map((workflow) => ({
          ...workflow,
          isActive: workflow.id === payload.workflow?.id ? nextIsActive : workflow.isActive
        }))
      );
      success(
        nextIsActive ? "Workflow activated" : "Workflow deactivated",
        nextIsActive
          ? `${payload.workflow.name} is now active at runtime.`
          : `${payload.workflow.name} is no longer active at runtime.`
      );
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
        activeWorkflowIds: current.activeWorkflowIds.filter((id) => id !== workflowId),
        activeWorkflowId:
          current.activeWorkflowIds.filter((id) => id !== workflowId)[0] ?? null
      }));
      success("Workflow deleted", `${workflow?.name ?? "Workflow"} has been removed.`);
    });
  };

  const saveRule = async () => {
    setError(null);

    const encodedMatcher = encodeRuleMatcher({
      operator: ruleForm.matchOperator,
      value: ruleForm.keyword
    });
    const duplicateValueRules =
      ruleForm.triggerType === AutomationTriggerType.KEYWORD_MATCH
        ? rules.filter((rule) => {
            if (rule.id === ruleForm.id || rule.triggerType !== AutomationTriggerType.KEYWORD_MATCH) {
              return false;
            }

            const existingValue = rule.keyword?.trim().toLowerCase() ?? "";
            const nextValue = ruleForm.keyword.trim().toLowerCase();

            if (!existingValue || !nextValue || existingValue !== nextValue) {
              return false;
            }

            return rule.matchType !== encodedMatcher.matchType || rule.matchOperator !== ruleForm.matchOperator;
          })
        : [];

    if (duplicateValueRules.length) {
      const duplicateSummary = duplicateValueRules
        .map((rule) => `${rule.name} (${rule.matchLabel})`)
        .join(", ");
      const confirmedDuplicate = await confirm({
        title: "Possible duplicate rule value",
        description: `This value is already used by ${duplicateSummary} with a different condition. This might create duplicate behavior. Do you want to save anyway?`,
        confirmLabel: "Save anyway"
      });

      if (!confirmedDuplicate) {
        return;
      }
    }

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
          matchType: encodedMatcher.matchType,
          keyword: encodedMatcher.keyword,
          replyBody: ruleForm.replyBody,
          replyMediaAssetIds: ruleForm.replyMediaAssetIds,
          replyMediaAssetId: ruleForm.replyMediaAssetIds[0] ?? null,
          workflowId: ruleForm.workflowId || null,
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
          followUpMediaAssetIds: ruleForm.followUpMediaAssetIds,
          followUpMediaAssetId: ruleForm.followUpMediaAssetIds[0] ?? null,
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
      navigateAutomationView("rules");
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
      navigateAutomationView("rules");
      router.refresh();
    });
  };

  const renderRules = () => (
    <section className="automation-rule-columns">
      {activeMode === "editor" ? (
      <article className="content-card automation-rule-card">
        <div className="card-header">
          <div>
            <h3 className="card-title">{ruleForm.id ? "Edit rule" : "Create rule"}</h3>
            <p className="muted">Keep the core rule simple. Expand advanced options only when you need them.</p>
          </div>
          <button className="inbox-search-tool" onClick={() => navigateAutomationView("rules")} type="button">
            Back to rules
          </button>
        </div>

        <div className="automation-rule-editor">
          <section className="automation-rule-section">
            <div className="automation-rule-section-head">
              <strong>When This Rule Runs</strong>
              <span>Define the trigger, condition, and keyword value before configuring the response.</span>
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
                  className="lead-record-input"
                  onChange={(event) =>
                    setRuleForm((current) => ({
                      ...current,
                      triggerType: event.target.value as AutomationTriggerType
                    }))
                  }
                  value={ruleForm.triggerType}
                >
                  <option value={AutomationTriggerType.KEYWORD_MATCH}>Message rule</option>
                  <option value={AutomationTriggerType.WELCOME_MESSAGE}>Welcome message</option>
                </select>
              </label>
              <label className="lead-record-field">
                <span>Condition</span>
                <select
                  className="lead-record-input"
                  onChange={(event) =>
                    setRuleForm((current) => ({
                      ...current,
                      matchOperator: event.target.value as RuleMatchOperator,
                      matchType:
                        event.target.value === RULE_MATCH_OPERATORS.EXACTLY_MATCHES
                          ? AutomationMatchType.EXACT
                          : event.target.value === RULE_MATCH_OPERATORS.REGEX
                            ? AutomationMatchType.REGEX
                            : AutomationMatchType.CONTAINS,
                      keyword:
                        RULE_MATCH_OPERATOR_OPTIONS.find((option) => option.value === event.target.value)?.needsValue === false
                          ? ""
                          : current.keyword
                    }))
                  }
                  value={ruleForm.matchOperator}
                >
                  {RULE_MATCH_OPERATOR_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              {ruleForm.triggerType === AutomationTriggerType.KEYWORD_MATCH ? (
                matchValueRequired ? (
                  <label
                    className={`lead-record-field${
                      ruleForm.matchOperator === RULE_MATCH_OPERATORS.CONTAINS_ANY_WORDS ? " lead-record-field-wide" : ""
                    }`}
                  >
                    <span>
                      {ruleForm.matchOperator === RULE_MATCH_OPERATORS.MESSAGE_LANGUAGE_IS
                        ? "Language"
                        : ruleForm.matchOperator === RULE_MATCH_OPERATORS.CONTAINS_ANY_WORDS
                          ? "Keywords"
                          : ruleForm.matchOperator === RULE_MATCH_OPERATORS.REGEX
                            ? "Pattern"
                            : "Value"}
                    </span>
                    {ruleForm.matchOperator === RULE_MATCH_OPERATORS.MESSAGE_LANGUAGE_IS ? (
                      <select
                        className="lead-record-input app-select"
                        onChange={(event) => setRuleForm((current) => ({ ...current, keyword: event.target.value }))}
                        value={ruleForm.keyword}
                      >
                        <option value="">Select language</option>
                        {RULE_LANGUAGE_OPTIONS.map((language) => (
                          <option key={language.value} value={language.value}>
                            {language.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      ruleForm.matchOperator === RULE_MATCH_OPERATORS.CONTAINS_ANY_WORDS ? (
                        <div className="lead-record-field-stack">
                          <div className="automation-keyword-summary-card">
                            <div className="automation-keyword-summary-head">
                              <div className="automation-keyword-summary-copy">
                                <strong>
                                  {anyWordsValues.length
                                    ? `${anyWordsValues.length} keyword${anyWordsValues.length === 1 ? "" : "s"} added`
                                    : "No keywords added"}
                                </strong>
                                <span>
                                  {anyWordsValues.length
                                    ? `${anyWordsPreview}${anyWordsValues.length > 4 ? "..." : ""}`
                                    : "Add words or phrases that should trigger this rule."}
                                </span>
                              </div>
                              <button
                                className="inbox-search-tool"
                                onClick={() => setIsKeywordManagerOpen(true)}
                                type="button"
                              >
                                {anyWordsValues.length ? "Manage" : "Add"}
                              </button>
                            </div>
                          </div>
                          <span className="field-hint">Manage keywords in one place without stretching the form.</span>
                        </div>
                      ) : (
                        <input
                          className="lead-record-input"
                          onChange={(event) => setRuleForm((current) => ({ ...current, keyword: event.target.value }))}
                          placeholder={selectedMatchOperatorOption?.placeholder}
                          value={ruleForm.keyword}
                        />
                      )
                    )}
                  </label>
                ) : (
                  <div className="automation-rule-note">
                    <strong>{selectedMatchOperatorOption?.label ?? "Condition"}</strong>
                    <span>This condition checks the incoming message automatically. No keyword is needed.</span>
                  </div>
                )
              ) : (
                <div className="automation-rule-note">
                  <strong>Welcome rule</strong>
                  <span>Runs when an inbound message arrives and no other active flow is running.</span>
                </div>
              )}
            </div>
          </section>

          <section className="automation-rule-section">
            <div className="automation-rule-section-head">
              <strong>What Happens Immediately</strong>
              <span>Set the instant reply, attach media, start a workflow, and add tags.</span>
            </div>
            <div className="lead-record-form-grid">
              <label className="lead-record-field lead-record-field-wide">
                <span>Reply body</span>
                <div className="automation-textarea-with-emoji">
                  <textarea
                    className="lead-record-input lead-record-textarea automation-textarea-with-emoji-input"
                    onChange={(event) => setRuleForm((current) => ({ ...current, replyBody: event.target.value }))}
                    placeholder={ruleForm.workflowId ? "Optional. Leave blank to start the workflow without sending a rule reply." : ""}
                    ref={replyBodyRef}
                    value={ruleForm.replyBody}
                  />
                  <div className="automation-emoji-toolbar automation-emoji-toolbar-inside">
                    <button
                      aria-label="Open emoji picker"
                      className="automation-emoji-icon-button"
                      onClick={() => setActiveEmojiField((current) => (current === "replyBody" ? null : "replyBody"))}
                      ref={replyEmojiButtonRef}
                      type="button"
                    >
                      <EmojiIcon />
                    </button>
                  </div>
                </div>
                <AutomationMediaSelector
                  assets={mediaAssets}
                  emptyMessage="No media in the library yet. Upload shared assets in Setup > Media Library."
                  onChange={(assetIds) => setRuleForm((current) => ({ ...current, replyMediaAssetIds: assetIds }))}
                  selectedIds={ruleForm.replyMediaAssetIds}
                />
                <span className="field-hint">
                  {mediaAssets.length
                    ? `Select one or more shared assets. ${
                        mediaLimits.isStorageUnlimited
                          ? "Unlimited Media Library storage."
                          : mediaLimits.remainingStorageBytes !== null
                            ? `${formatMediaAssetSize(mediaLimits.remainingStorageBytes)} remaining.`
                            : "Unlimited Media Library storage."
                      }`
                    : "No media in the library yet. Upload shared assets in Setup > Media Library."}
                </span>
              </label>
              <label className="lead-record-field">
                <span>Workflow to start</span>
                <select
                  className="lead-record-input"
                  onChange={(event) => setRuleForm((current) => ({ ...current, workflowId: event.target.value }))}
                  value={ruleForm.workflowId}
                >
                  <option value="">No workflow</option>
                  {workflowList.map((workflow) => (
                    <option key={workflow.id} value={workflow.id}>
                      {workflow.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="lead-record-field">
                <span>Tags to add</span>
                <input
                  className="lead-record-input"
                  onChange={(event) => setRuleForm((current) => ({ ...current, addTags: event.target.value }))}
                  placeholder="Rawang, buyer, high intent"
                  value={ruleForm.addTags}
                />
              </label>
            </div>
          </section>

          <section className="automation-rule-section">
            <div className="automation-rule-section-head">
              <strong>Follow-up Message</strong>
              <span>Configure an optional delayed message after the rule has already matched.</span>
            </div>
            <div className="lead-record-form-grid">
              <div className="lead-record-field">
                <span>Delay before follow-up</span>
                <span className="field-hint">
                  Choose when the second message should send after this rule has already replied.
                </span>
                <div className="automation-delay-presets">
                  {FOLLOW_UP_DELAY_PRESETS.map((preset) => {
                    const isActive = ruleForm.followUpDelayMinutes === String(preset.minutes);
                    return (
                      <button
                        className={`automation-delay-chip${isActive ? " active" : ""}`}
                        key={preset.minutes}
                        onClick={() =>
                          setRuleForm((current) => ({
                            ...current,
                            followUpDelayMinutes: isActive ? "" : String(preset.minutes)
                          }))
                        }
                        type="button"
                      >
                        {preset.label}
                      </button>
                    );
                  })}
                </div>
                <div className="automation-delay-input-row">
                  <input
                    className="lead-record-input"
                    min={0}
                    onChange={(event) =>
                      setRuleForm((current) => ({ ...current, followUpDelayMinutes: event.target.value }))
                    }
                    placeholder="Custom delay"
                    type="number"
                    value={ruleForm.followUpDelayMinutes}
                  />
                  <span className="automation-delay-unit">minutes</span>
                </div>
              </div>
              <div className="automation-rule-note lead-record-field-wide">
                <strong>Optional step</strong>
                <span>Leave this empty if the rule should reply once with no delayed follow-up.</span>
              </div>
              <label className="lead-record-field lead-record-field-wide">
                <span>Follow-up reply</span>
                <div className="automation-textarea-with-emoji">
                  <textarea
                    className="lead-record-input lead-record-textarea automation-textarea-with-emoji-input"
                    onChange={(event) =>
                      setRuleForm((current) => ({ ...current, followUpReplyBody: event.target.value }))
                    }
                    ref={followUpReplyBodyRef}
                    value={ruleForm.followUpReplyBody}
                  />
                  <div className="automation-emoji-toolbar automation-emoji-toolbar-inside">
                    <button
                      aria-label="Open emoji picker"
                      className="automation-emoji-icon-button"
                      onClick={() =>
                        setActiveEmojiField((current) => (current === "followUpReplyBody" ? null : "followUpReplyBody"))
                      }
                      ref={followUpEmojiButtonRef}
                      type="button"
                    >
                      <EmojiIcon />
                    </button>
                  </div>
                </div>
                <AutomationMediaSelector
                  assets={mediaAssets}
                  emptyMessage="No media in the library yet. Upload shared assets in Setup > Media Library."
                  onChange={(assetIds) => setRuleForm((current) => ({ ...current, followUpMediaAssetIds: assetIds }))}
                  selectedIds={ruleForm.followUpMediaAssetIds}
                />
              </label>
            </div>
          </section>

          <details className="automation-advanced-block">
            <summary>Advanced Controls</summary>
            <div className="automation-rule-section-head automation-rule-section-head-inline">
              <strong>Safety and delivery rules</strong>
              <span>Use these options to control repeat behavior, priority, hours, and whether the rule remains active.</span>
            </div>
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
                <span className="field-hint">
                  Higher priority rules are evaluated first. Use a smaller number for more important rules.
                </span>
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
              <span className="field-hint field-hint-tight">
                Once this is enabled, no lower-priority rules will be triggered.
              </span>
              <label className="lead-record-field lead-record-field-wide">
                <span>Cooldown (min)</span>
                <input
                  className="lead-record-input"
                  min={0}
                  onChange={(event) =>
                    setRuleForm((current) => ({ ...current, cooldownMinutes: Number(event.target.value) || 0 }))
                  }
                  type="number"
                  value={ruleForm.cooldownMinutes}
                />
                <span className="field-hint">
                  After this rule runs, it will not run again for the same contact until this time passes.
                </span>
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
        </div>

        {error ? <div className="form-error">{error}</div> : null}

        <div className="composer-actions automation-rule-actions">
          <button className="button button-secondary" onClick={() => navigateAutomationView("rules")} type="button">
            Cancel
          </button>
          <button className="button button-primary" disabled={isPending} onClick={() => void saveRule()} type="button">
            {isPending ? "Saving..." : ruleForm.id ? "Save rule" : "Create rule"}
          </button>
        </div>
      </article>
      ) : null}

      {activeMode === "list" ? (
      <article className="table-card">
        <div className="card-header">
          <div>
            <h3 className="card-title">Rules</h3>
            <p className="muted">Use plain-language conditions instead of raw regex for most rules.</p>
          </div>
          <button
            className="button button-primary compact-button"
            onClick={() => {
              resetRuleForm();
              navigateAutomationView("rules", { mode: "editor" });
            }}
            type="button"
          >
            New rule
          </button>
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
              {rule.replyBody ? <div className="table-subtle">{rule.replyBody}</div> : null}
              {rule.replyMediaAssets.length ? (
                <div className="table-subtle">
                  Reply media:{" "}
                  {rule.replyMediaAssets
                    .map((asset) => `${asset.title} · ${getMediaKindLabel(asset.kind, asset.mimeType)}`)
                    .join(", ")}
                </div>
              ) : null}
              {rule.workflowName ? (
                <div className="table-subtle">Starts workflow: {rule.workflowName}</div>
              ) : null}
              {rule.addTags.length ? (
                <div className="message-meta">
                  {rule.addTags.map((tag) => (
                    <span className="lead-chip" key={tag}>
                      Tag: {tag}
                    </span>
                  ))}
                </div>
              ) : null}
              {rule.followUpDelayMinutes && (rule.followUpReplyBody || rule.followUpMediaAssets.length) ? (
                <div className="table-subtle">
                  Follow-up in {rule.followUpDelayMinutes}m:
                  {rule.followUpReplyBody ? ` ${rule.followUpReplyBody}` : " media only"}
                  {rule.followUpMediaAssets.length
                    ? ` · Media: ${rule.followUpMediaAssets.map((asset) => asset.title).join(", ")}`
                    : ""}
                </div>
              ) : null}
              <div className="composer-actions inline-actions">
                <button
                  className="button button-secondary compact-button"
                  disabled={isPending}
                  onClick={() => navigateAutomationView("rules", { mode: "editor", ruleId: rule.id })}
                  type="button"
                >
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
      ) : null}
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
            <span>Used by away replies and business-hours-only message rules.</span>
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
            <div />
            <div className="lead-record-field lead-record-field-wide">
              <span>Human takeover pause</span>
              <label className="automation-toggle-row">
                <input
                  checked={humanTakeoverPauseEnabled}
                  onChange={(event) =>
                    setSettingsForm((current) => {
                      if (event.target.checked) {
                        return {
                          ...current,
                          humanTakeoverPauseMinutes: previousHumanTakeoverPauseMinutesRef.current
                        };
                      }

                      if (current.humanTakeoverPauseMinutes > 0) {
                        previousHumanTakeoverPauseMinutesRef.current = current.humanTakeoverPauseMinutes;
                      }

                      return {
                        ...current,
                        humanTakeoverPauseMinutes: 0
                      };
                    })
                  }
                  type="checkbox"
                />
                <span>Pause automation after outbound team or campaign messages</span>
              </label>
              {humanTakeoverPauseEnabled ? (
                <div className="lead-record-form-grid">
                  <label className="lead-record-field">
                    <span>Pause duration (minutes)</span>
                    <input
                      className="lead-record-input"
                      min={1}
                      onChange={(event) => {
                        const nextValue = Number(event.target.value);

                        if (!Number.isFinite(nextValue) || nextValue < 1) {
                          return;
                        }

                        previousHumanTakeoverPauseMinutesRef.current = Math.floor(nextValue);
                        setSettingsForm((current) => ({
                          ...current,
                          humanTakeoverPauseMinutes: Math.floor(nextValue)
                        }));
                      }}
                      type="number"
                      value={settingsForm.humanTakeoverPauseMinutes}
                    />
                  </label>
                </div>
              ) : null}
              <span className="table-subtle">
                {humanTakeoverPauseEnabled
                  ? "Inbound replies received during this window will not start automation."
                  : "Disabled. Future outbound messages will not suppress workflow triggers."}
              </span>
            </div>
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
          <p className="muted">Keep the property intake prompts separate from your message rules.</p>
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
          <span>Starts when an inbound message arrives and no other active flow is running.</span>
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
  const selectedWorkflowWarnings = useMemo(
    () => (selectedWorkflow ? getWorkflowWarnings(selectedWorkflow.definitionJson) : []),
    [selectedWorkflow]
  );
  const selectedWorkflowVariables = parsedWorkflow?.variables ?? [];
  const availableWorkflowSteps = parsedWorkflow?.steps ?? [];
  const selectedWorkflowVariableUsage = useMemo(
    () => (parsedWorkflow ? getWorkflowVariableUsage(parsedWorkflow) : new Map<string, WorkflowVariableUsage>()),
    [parsedWorkflow]
  );
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
  const selectedWorkflowStepValidationError =
    selectedWorkflowStep?.type === "update"
      ? getWorkflowUpdateContentInlineError(selectedWorkflowStep) ?? getWorkflowNotificationInlineError(selectedWorkflowStep)
      : selectedWorkflowStep?.type === "action"
        ? getWorkflowNotificationInlineError(selectedWorkflowStep)
        : null;
  const WORKFLOW_END_ID = "workflow-end";

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
          fallbackNextStepId: step.fallbackNextStepId ?? null,
          nextStepId: step.nextStepId ?? null
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
    const normalizedVariables = normalizeWorkflowVariables(draft.variables);
    return {
      ...draft,
      variables: normalizedSteps.length ? normalizedVariables : [],
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

      const targets: string[] = [];
      if ("branches" in step) {
        targets.push(...(step.branches?.map((branch) => branch.nextStepId || WORKFLOW_END_ID) ?? []));
        if (step.nextStepId) {
          targets.push(step.nextStepId as string);
        }
        if (step.fallbackNextStepId) {
          targets.push(step.fallbackNextStepId as string);
        }
        if (step.onTimeoutStepId) {
          targets.push(step.onTimeoutStepId as string);
        }
      } else if ("nextStepId" in step) {
        targets.push(step.nextStepId || WORKFLOW_END_ID);
        if (step.onTimeoutStepId) {
          targets.push(step.onTimeoutStepId);
        }
      }

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

      const targets: string[] = [];
      if ("branches" in step) {
        targets.push(...(step.branches?.map((branch) => branch.nextStepId || WORKFLOW_END_ID) ?? []));
        if (step.nextStepId) {
          targets.push(step.nextStepId);
        }
        if (step.fallbackNextStepId) {
          targets.push(step.fallbackNextStepId);
        }
        if (step.onTimeoutStepId) {
          targets.push(step.onTimeoutStepId);
        }
      } else if ("nextStepId" in step) {
        targets.push(step.nextStepId || WORKFLOW_END_ID);
        if (step.onTimeoutStepId) {
          targets.push(step.onTimeoutStepId);
        }
      }

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
          if (step.type === "ask" || step.type === "question" || step.type === "choice") {
            return {
              ...step,
              saveAs: step.saveAs === previousKey ? nextKey : step.saveAs,
              ...(step.type === "question" || step.type === "choice"
                ? {
                    decisionSourceKey:
                      step.decisionSourceKey === previousKey ? nextKey : step.decisionSourceKey
                  }
                : {})
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
        if (step.type === "ask" || step.type === "question" || step.type === "choice") {
          return {
            ...step,
            saveAs: step.saveAs === key ? null : step.saveAs,
            ...(step.type === "question" || step.type === "choice"
              ? {
                  decisionSourceKey: step.decisionSourceKey === key ? null : step.decisionSourceKey
                }
              : {})
          };
        }

        return step;
      })
    }));
  };

  const insertReplyTemplateToken = (token: string) => {
    updateSelectedWorkflowStep((step) =>
      "reply" in step
        ? {
            ...step,
            reply: step.reply?.length ? `${step.reply}${step.reply.endsWith(" ") ? "" : " "}${token}` : token
          }
        : step
    );
  };

  const insertPromptTemplateToken = (token: string) => {
    updateSelectedWorkflowStep((step) =>
      "prompt" in step
        ? {
            ...step,
            prompt: step.prompt?.length ? `${step.prompt}${step.prompt.endsWith(" ") ? "" : " "}${token}` : token
          }
        : step
    );
  };

  useEffect(() => {
    setSelectedWorkflowVariableKey((current) => (current === null ? current : null));
    setExpandedWorkflowVariableGroups((current) => (current.length ? [] : current));
    setIsQuestionOptionsOpen(false);
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

  useEffect(() => {
    setIsQuestionOptionsOpen(false);
  }, [selectedWorkflowStepId]);

  const renderQuestionOptionsEditor = (
    promptNode: WorkflowDraft["steps"][number] & { type: "ask" | "question" | "choice" }
  ) => {
    const replySaveKeySuggestions = getWorkflowReplySaveKeySuggestions(promptNode.type);
    const assignedWorkflowVariable =
      promptNode.saveAs?.trim()
        ? selectedWorkflowVariables.find((variable) => variable.key === promptNode.saveAs?.trim()) ?? null
        : null;
    const activeWorkflowVariable = assignedWorkflowVariable ?? selectedWorkflowVariable;
    const savedVariableUsage = promptNode.saveAs?.trim() ? selectedWorkflowVariableUsage.get(promptNode.saveAs.trim()) ?? null : null;
    const savedVariableIsUnused =
      Boolean(promptNode.saveAs?.trim()) &&
      (!savedVariableUsage || (!savedVariableUsage.usedInUpdate && !savedVariableUsage.usedInDecision && !savedVariableUsage.usedInReply));

    return (
      <div className="lead-record-form-grid">
        <div className="lead-record-field lead-record-field-wide workflow-save-answer-panel">
          <div className="workflow-save-answer-head">
            <strong>Save reply for later steps</strong>
            <span>1. Choose a variable. 2. Create one if needed. 3. Use it later in Update nodes with `Saved answer`.</span>
          </div>
          <div className="workflow-save-answer-grid">
            <label className="lead-record-field">
              <span>Save answer as</span>
              <select
                className="lead-record-input app-select"
                onChange={(event) => {
                  const nextKey = event.target.value.trim() || null;
                  setSelectedWorkflowVariableKey(nextKey);
                  updateSelectedWorkflowStep((step) => ({
                    ...step,
                    saveAs: nextKey
                  }));
                }}
                value={promptNode.saveAs ?? ""}
              >
                <option value="">Do not save this reply</option>
                {selectedWorkflowVariables.map((variable) => (
                  <option key={variable.key} value={variable.key}>
                    {variable.key}
                  </option>
                ))}
              </select>
              <span className="field-hint">Choose an existing workflow variable for this reply.</span>
            </label>
            <div className="lead-record-field workflow-inline-action-field">
              <span>Create new variable</span>
              <button
                className="button button-secondary compact-button workflow-compact-button"
                onClick={() => createWorkflowVariable("saveAs")}
                type="button"
              >
                Create variable
              </button>
              <span className="field-hint">Creates a new workflow variable and assigns it to this node.</span>
            </div>
          </div>
          {activeWorkflowVariable ? (
            <div className="workflow-save-answer-status">
              <div className="workflow-save-answer-assigned">
                <span className="workflow-save-answer-label">Assigned variable</span>
                <code>{activeWorkflowVariable.key}</code>
              </div>
              <button
                className="button button-secondary compact-button workflow-compact-button"
                onClick={() => {
                  setSelectedWorkflowVariableKey(null);
                  updateSelectedWorkflowStep((step) => ({
                    ...step,
                    saveAs: null
                  }));
                }}
                type="button"
              >
                Unassign
              </button>
              <button
                className="button button-secondary compact-button workflow-compact-button workflow-danger-button"
                onClick={() => removeWorkflowVariable(activeWorkflowVariable.key)}
                type="button"
              >
                Delete variable everywhere
              </button>
            </div>
          ) : replySaveKeySuggestions.length ? (
            <div className="workflow-save-answer-status">
              <span className="workflow-save-answer-label">Quick create</span>
              <div className="automation-suggestion-row workflow-suggestion-row">
                {replySaveKeySuggestions.map((suggestion) => (
                  <button
                    className="lead-chip automation-suggestion-chip workflow-suggestion-chip"
                    key={suggestion}
                    onClick={() => {
                      const normalizedSuggestion = normalizeWorkflowVariableKey(suggestion);
                      const existingMatch =
                        selectedWorkflowVariables.find((variable) => variable.key === normalizedSuggestion) ?? null;
                      if (existingMatch) {
                        setSelectedWorkflowVariableKey(existingMatch.key);
                        updateSelectedWorkflowStep((step) => ({
                          ...step,
                          saveAs: existingMatch.key
                        }));
                        return;
                      }

                      setSelectedWorkflowVariableKey(normalizedSuggestion);
                      setExpandedWorkflowVariableGroups((current) => {
                        const nextGroup = getWorkflowVariableGroup(normalizedSuggestion);
                        return current.includes(nextGroup) ? current : [...current, nextGroup];
                      });
                      updateWorkflowDraft((current) => ({
                        ...current,
                        variables: [
                          ...normalizeWorkflowVariables(current.variables),
                          {
                            key: normalizedSuggestion,
                            type: "text",
                            description: null
                          }
                        ],
                        steps: current.steps.map((step) =>
                          step.id === selectedWorkflowStepId ? { ...step, saveAs: normalizedSuggestion } : step
                        )
                      }));
                    }}
                    type="button"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {savedVariableIsUnused ? (
            <div className="automation-rule-note">
              <strong>Variable not used later yet</strong>
              <span>
                This reply is being saved to <code>{promptNode.saveAs?.trim()}</code>, but no later node uses it in Update
                Contact, Saved value decisions, or Send Reply placeholders yet.
              </span>
            </div>
          ) : null}
        </div>
        <div className="lead-record-field lead-record-field-wide workflow-question-options-grid">
          <label className="lead-record-field">
            <span>Reply timeout (minutes)</span>
            <input
              className="lead-record-input"
              inputMode="numeric"
              min={1}
              onChange={(event) =>
                updateSelectedWorkflowStep((step) => ({
                  ...step,
                  expiresAfterMinutes:
                    event.target.value.trim() && Number(event.target.value) > 0
                      ? Math.round(Number(event.target.value))
                      : null
                }))
              }
              placeholder="Wait forever"
              value={promptNode.expiresAfterMinutes ? `${promptNode.expiresAfterMinutes}` : ""}
            />
          </label>
          <label className="lead-record-field">
            <span>On timeout</span>
            <select
              className="lead-record-input app-select"
              onChange={(event) =>
                updateSelectedWorkflowStep((step) => ({
                  ...step,
                  onTimeoutStepId: event.target.value.trim() || null
                }))
              }
              value={promptNode.onTimeoutStepId ?? ""}
            >
              <option value="">End workflow</option>
              {availableWorkflowSteps
                .filter((step) => step.id !== promptNode.id && step.type !== "end")
                .map((step) => (
                  <option key={step.id} value={step.id}>
                    {step.title?.trim() || step.id}
                  </option>
                ))}
            </select>
          </label>
        </div>
        {promptNode.type === "question" || promptNode.type === "choice" ? (
          <div className="lead-record-field lead-record-field-wide workflow-question-options-grid">
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
                value={promptNode.decisionSource ?? "currentReply"}
              >
                <option value="currentReply">Current reply</option>
                <option value="savedValue">Saved value</option>
              </select>
            </label>
            {promptNode.decisionSource === "savedValue" ? (
              <label className="lead-record-field">
                <span>Saved value key</span>
                <select
                  className="lead-record-input app-select"
                  onChange={(event) =>
                    updateSelectedWorkflowStep((step) => ({
                      ...step,
                      decisionSourceKey: event.target.value.trim() || null
                    }))
                  }
                  value={promptNode.decisionSourceKey ?? ""}
                >
                  <option value="">Choose saved value</option>
                  {selectedWorkflowVariables.map((variable) => (
                    <option key={variable.key} value={variable.key}>
                      {variable.key}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
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
                value={promptNode.maxRetries ? `${promptNode.maxRetries}` : ""}
              />
            </label>
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
                  promptNode.type === "choice"
                    ? "Please reply with one of the listed options."
                    : "Please reply yes or no."
                }
                ref={workflowFallbackReplyBodyRef}
                value={promptNode.fallbackReply ?? ""}
              />
              <div className="automation-emoji-toolbar">
                <button
                  aria-label="Open emoji picker"
                  className="automation-emoji-icon-button"
                  onClick={() =>
                    setActiveEmojiField((current) =>
                      current === "workflowFallbackReplyBody" ? null : "workflowFallbackReplyBody"
                    )
                  }
                  ref={workflowFallbackReplyEmojiButtonRef}
                  type="button"
                >
                  <EmojiIcon />
                </button>
              </div>
            </label>
          </div>
        ) : null}
      </div>
    );
  };

  const renderNotificationOptionsEditor = (
    step: WorkflowDraft["steps"][number] & { type: "action" | "update" }
  ) => {
    const selectedNotifyAgentIds = step.notifyAgentIds ?? [];
    const notificationInlineError = getWorkflowNotificationInlineError(step);

    return (
      <div className="lead-record-form-grid">
        <label className="lead-record-field lead-record-field-wide automation-toggle-row">
          <span>Notify assigned owner on WhatsApp</span>
          <input
            checked={Boolean(step.notifyAssignedOwner)}
            onChange={(event) =>
              updateSelectedWorkflowStep((currentStep) =>
                currentStep.type === "update" || currentStep.type === "action"
                  ? {
                      ...currentStep,
                      notifyAssignedOwner: event.target.checked
                    }
                  : currentStep
              )
            }
            type="checkbox"
          />
        </label>
        <label className="lead-record-field lead-record-field-wide">
          <span>Notify team members</span>
          <select
            className="lead-record-input app-select"
            multiple
            onChange={(event) =>
              updateSelectedWorkflowStep((currentStep) =>
                currentStep.type === "update" || currentStep.type === "action"
                  ? {
                      ...currentStep,
                      notifyAgentIds: Array.from(event.target.selectedOptions).map((option) => option.value)
                    }
                  : currentStep
              )
            }
            value={selectedNotifyAgentIds}
          >
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name} · {formatAgentRole(agent.role)}
              </option>
            ))}
          </select>
          <span className="field-hint">
            Hold Ctrl or Cmd to select more than one team member. Their WhatsApp number must be saved on the team profile.
          </span>
        </label>
        <label className="lead-record-field lead-record-field-wide">
          <span>Notification message</span>
          <textarea
            className="lead-record-input"
            onChange={(event) =>
              updateSelectedWorkflowStep((currentStep) =>
                currentStep.type === "update" || currentStep.type === "action"
                  ? {
                      ...currentStep,
                      notifyMessage: event.target.value
                    }
                  : currentStep
              )
            }
            placeholder="Lead {{name}} replied: {{currentReply}}"
            ref={workflowNotificationBodyRef}
            rows={4}
            value={step.notifyMessage ?? ""}
          />
          <div className="automation-emoji-toolbar">
            <button
              aria-label="Open emoji picker"
              className="automation-emoji-icon-button"
              onClick={() =>
                setActiveEmojiField((current) =>
                  current === "workflowNotificationMessage" ? null : "workflowNotificationMessage"
                )
              }
              ref={workflowNotificationEmojiButtonRef}
              type="button"
            >
              <EmojiIcon />
            </button>
          </div>
          <span className="field-hint">
            Supports saved variables and built-ins like <code>{"{{name}}"}</code>, <code>{"{{phone}}"}</code>, and <code>{"{{currentReply}}"}</code>.
          </span>
          {selectedWorkflowVariables.length ? (
            <div className="automation-suggestion-row workflow-suggestion-row">
              {selectedWorkflowVariables.map((variable) => {
                const token = `{{${variable.key}}}`;
                return (
                  <button
                    className="lead-chip automation-suggestion-chip workflow-suggestion-chip"
                    key={`notify:${token}`}
                    onClick={() =>
                      updateSelectedWorkflowStep((currentStep) =>
                        currentStep.type === "update" || currentStep.type === "action"
                          ? {
                              ...currentStep,
                              notifyMessage: `${currentStep.notifyMessage ?? ""}${token}`
                            }
                          : currentStep
                      )
                    }
                    type="button"
                  >
                    {token}
                  </button>
                );
              })}
            </div>
          ) : null}
        </label>
        {notificationInlineError ? <div className="form-error lead-record-field-wide">{notificationInlineError}</div> : null}
      </div>
    );
  };

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
    targetType: "start" | "action" | "question" | "delay" | "end"
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

        const targets: string[] =
          "branches" in step
            ? [
                ...(step.branches?.map((branch) => branch.nextStepId || WORKFLOW_END_ID) ?? []),
                step.nextStepId || null,
                step.fallbackNextStepId || null
              ].filter((targetId): targetId is string => Boolean(targetId))
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
      steps: current.steps.map((step) =>
        step.id === selectedWorkflowStep.id ? updater(step as NonNullable<typeof selectedWorkflowStep>) : step
      )
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
                nextStepId: step.nextStepId === selectedWorkflowStep.id ? null : step.nextStepId,
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
                nextStepId: step.nextStepId === stepId ? WORKFLOW_END_ID : step.nextStepId,
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
    const tabFromRoute = routeSearchParams.get("tab");
    if (
      tabFromRoute === "rules" ||
      tabFromRoute === "workflow" ||
      tabFromRoute === "hours" ||
      tabFromRoute === "testing" ||
      tabFromRoute === "entryQr"
    ) {
      setActiveTab(tabFromRoute);
    }
  }, [routeSearchParams]);

  useEffect(() => {
    if (activeTab !== "rules" || activeMode !== "editor") {
      return;
    }

    if (!selectedRuleIdFromRoute) {
      setRuleForm(EMPTY_RULE_FORM);
      setAnyWordsDraft("");
      setIsKeywordManagerOpen(false);
      return;
    }

    const rule = rules.find((item) => item.id === selectedRuleIdFromRoute);
    if (!rule) {
      return;
    }

    setRuleForm({
      id: rule.id,
      name: rule.name,
      triggerType: rule.triggerType,
      matchOperator: rule.matchOperator,
      matchType: rule.matchType,
      keyword: rule.keyword ?? "",
      replyBody: rule.replyBody,
      replyMediaAssetIds: rule.replyMediaAssetIds,
      workflowId: rule.workflowId ?? "",
      addTags: rule.addTags.join(", "),
      priority: rule.priority,
      cooldownMinutes: rule.cooldownMinutes,
      stopAfterMatch: rule.stopAfterMatch,
      businessHoursOnly: rule.businessHoursOnly,
      followUpDelayMinutes: rule.followUpDelayMinutes ? `${rule.followUpDelayMinutes}` : "",
      followUpReplyBody: rule.followUpReplyBody ?? "",
      followUpMediaAssetIds: rule.followUpMediaAssetIds,
      enabled: rule.enabled
    });
    setAnyWordsDraft("");
    setIsKeywordManagerOpen(false);
  }, [activeMode, activeTab, rules, selectedRuleIdFromRoute]);

  useEffect(() => {
    if (activeTab !== "workflow" || activeMode !== "editor") {
      return;
    }

    if (selectedWorkflowIdFromRoute && workflowList.some((workflow) => workflow.id === selectedWorkflowIdFromRoute)) {
      setSelectedWorkflowId(selectedWorkflowIdFromRoute);
      return;
    }

    if (!selectedWorkflowIdFromRoute && workflowList[0]?.id) {
      setSelectedWorkflowId(workflowList[0].id);
    }
  }, [activeMode, activeTab, selectedWorkflowIdFromRoute, workflowList]);

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

  useEffect(() => {
    if (!selectedWorkflowStep) {
      setIsWorkflowInspectorExpanded(false);
    }
  }, [selectedWorkflowStep]);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      if (!workflowResizeStateRef.current.active || workflowWorkspaceMode !== "side") {
        return;
      }

      const builder = workflowBuilderRef.current;
      if (!builder) {
        return;
      }

      const bounds = builder.getBoundingClientRect();
      if (!bounds.width) {
        return;
      }

      const nextWidth = ((event.clientX - bounds.left) / bounds.width) * 100;
      setWorkflowCanvasWidthPercent(Math.min(76, Math.max(42, Math.round(nextWidth))));
    };

    const stopResizing = () => {
      workflowResizeStateRef.current.active = false;
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopResizing);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stopResizing);
    };
  }, [workflowWorkspaceMode]);

  const renderWorkflowNodeInspector = (mode: "rail" | "dialog") => {
    if (!selectedWorkflowStep) {
      return (
        <section className={`lead-record-panel workflow-node-panel${mode === "dialog" ? " expanded" : ""}`}>
          <div className="lead-record-section-head workflow-node-panel-head">
            <div>
              <strong>Node inspector</strong>
            </div>
          </div>
          <div className="workflow-panel-body workflow-node-body">
            <div className="table-subtle">Select a node to edit its settings.</div>
          </div>
        </section>
      );
    }

    const isReplyNode = selectedWorkflowStep.type === "reply";
    const isFollowUpNode = selectedWorkflowStep.type === "follow_up";
    const supportsPrompt =
      "prompt" in selectedWorkflowStep &&
      (selectedWorkflowStep.type === "ask" ||
        selectedWorkflowStep.type === "question" ||
        selectedWorkflowStep.type === "choice");
    const promptNode = supportsPrompt ? selectedWorkflowStep : null;
    const supportsUpdates =
      "tags" in selectedWorkflowStep || "assignOwnerId" in selectedWorkflowStep || "leadStage" in selectedWorkflowStep;
    const supportsRouting =
      "nextStepId" in selectedWorkflowStep || "fallbackNextStepId" in selectedWorkflowStep || "branches" in selectedWorkflowStep;
    const nodeTypeLabel = formatWorkflowNodeType(selectedWorkflowStep.type);
    const nodeTypeDescription = getWorkflowNodeTypeDescription(selectedWorkflowStep.type);
    return (
      <section className={`lead-record-panel workflow-node-panel${mode === "dialog" ? " expanded" : ""}`}>
        <div className="lead-record-section-head workflow-node-panel-head">
          <div>
            <strong>Node inspector</strong>
          </div>
          <div className="composer-actions inline-actions workflow-node-panel-actions">
            {mode === "rail" ? (
              <button
                className="button button-secondary compact-button"
                onClick={() => setIsWorkflowInspectorExpanded(true)}
                type="button"
              >
                Expand editor
              </button>
            ) : (
              <button
                aria-label="Close expanded node editor"
                className="inbox-dialog-close"
                onClick={() => setIsWorkflowInspectorExpanded(false)}
                type="button"
              >
                x
              </button>
            )}
          </div>
        </div>

        <div className="workflow-panel-body workflow-node-body">
          <div className="workflow-node-inspector-intro">
            <strong>{nodeTypeLabel}</strong>
            <span>{nodeTypeDescription}</span>
            {promptNode?.saveAs?.trim() ? (
              <div className="workflow-node-variable-summary">
                <span className="workflow-node-variable-label">Saving reply as</span>
                <code>{promptNode.saveAs.trim()}</code>
              </div>
            ) : null}
          </div>

          <div className="lead-record-form-grid">
            <div className="workflow-node-section-card lead-record-field lead-record-field-wide">
              <div className="workflow-node-section-heading">
                <strong>Basics</strong>
                <span>Name this node clearly so it is easy to scan on the canvas.</span>
              </div>
              <div className="lead-record-form-grid">
                <label className="lead-record-field">
                  <span>Type</span>
                  <input className="lead-record-input" readOnly value={nodeTypeLabel} />
                </label>
                <label className="lead-record-field lead-record-field-wide">
                  <span>Title</span>
                  <input
                    className="lead-record-input"
                    onChange={(event) => updateSelectedWorkflowStep((step) => ({ ...step, title: event.target.value }))}
                    value={selectedWorkflowStep.title ?? ""}
                  />
                </label>
              </div>
            </div>

            {"prompt" in selectedWorkflowStep ? (
              <div className="workflow-node-section-card lead-record-field lead-record-field-wide">
                <div className="workflow-node-section-heading">
                  <strong>{isReplyNode ? "Message" : "Main Action"}</strong>
                  <span>{getWorkflowMainActionDescription(selectedWorkflowStep.type)}</span>
                </div>
                <div className="lead-record-form-grid">
                  <label className="lead-record-field lead-record-field-wide">
                    <span>Prompt</span>
                    <textarea
                      className="lead-record-input lead-record-textarea"
                      onChange={(event) => updateSelectedWorkflowStep((step) => ({ ...step, prompt: event.target.value }))}
                      ref={workflowPromptBodyRef}
                      value={selectedWorkflowStep.prompt ?? ""}
                    />
                    <div className="automation-emoji-toolbar">
                      <button
                        aria-label="Open emoji picker"
                        className="automation-emoji-icon-button"
                        onClick={() =>
                          setActiveEmojiField((current) => (current === "workflowPromptBody" ? null : "workflowPromptBody"))
                        }
                        ref={workflowPromptEmojiButtonRef}
                        type="button"
                      >
                        <EmojiIcon />
                      </button>
                    </div>
                    {selectedWorkflowStep.type === "question" ? (
                      <>
                        <span className="field-hint">
                          Use saved variables in the prompt with placeholders like <code>{"{{name}}"}</code> or <code>{"{{city}}"}</code>.
                        </span>
                        {selectedWorkflowVariables.length ? (
                          <div className="automation-suggestion-row workflow-suggestion-row">
                            {selectedWorkflowVariables.map((variable) => {
                              const token = `{{${variable.key}}}`;
                              return (
                                <button
                                  className="lead-chip automation-suggestion-chip workflow-suggestion-chip"
                                  key={`prompt:${token}`}
                                  onClick={() => insertPromptTemplateToken(token)}
                                  type="button"
                                >
                                  {token}
                                </button>
                              );
                            })}
                          </div>
                        ) : null}
                      </>
                    ) : null}
                  </label>
                </div>
              </div>
            ) : null}

            {selectedWorkflowStep.type === "delay" ? (
              <div className="workflow-node-section-card lead-record-field lead-record-field-wide">
                <div className="workflow-node-section-heading">
                  <strong>Timing</strong>
                  <span>Control when this delay resumes and when it should cancel itself.</span>
                </div>
                <div className="lead-record-form-grid">
                  <label className="lead-record-field">
                    <span>Delay minutes</span>
                    <input
                      className="lead-record-input"
                      inputMode="numeric"
                      min={1}
                      onChange={(event) =>
                        updateSelectedWorkflowStep((step) => ({
                          ...step,
                          delayMinutes:
                            event.target.value.trim() && Number(event.target.value) > 0
                              ? Math.round(Number(event.target.value))
                              : null
                        }))
                      }
                      placeholder="60"
                      value={selectedWorkflowStep.delayMinutes ? `${selectedWorkflowStep.delayMinutes}` : ""}
                    />
                  </label>
                  <label className="lead-record-field lead-record-field-wide automation-toggle-row">
                    <span>Resume only during business hours</span>
                    <input
                      checked={Boolean(selectedWorkflowStep.businessHoursOnly)}
                      onChange={(event) =>
                        updateSelectedWorkflowStep((step) => ({
                          ...step,
                          businessHoursOnly: event.target.checked
                        }))
                      }
                      type="checkbox"
                    />
                  </label>
                  <label className="lead-record-field lead-record-field-wide automation-toggle-row">
                    <span>Cancel if the contact replies before the delay ends</span>
                    <input
                      checked={selectedWorkflowStep.cancelOnInbound !== false}
                      onChange={(event) =>
                        updateSelectedWorkflowStep((step) => ({
                          ...step,
                          cancelOnInbound: event.target.checked
                        }))
                      }
                      type="checkbox"
                    />
                  </label>
                  <label className="lead-record-field lead-record-field-wide automation-toggle-row">
                    <span>Cancel if a human reply pauses automation</span>
                    <input
                      checked={Boolean(selectedWorkflowStep.cancelOnHumanReply)}
                      onChange={(event) =>
                        updateSelectedWorkflowStep((step) => ({
                          ...step,
                          cancelOnHumanReply: event.target.checked
                        }))
                      }
                      type="checkbox"
                    />
                  </label>
                </div>
              </div>
            ) : null}

            {selectedWorkflowStep.type === "follow_up" ? (
              <div className="workflow-node-section-card lead-record-field lead-record-field-wide">
                <div className="workflow-node-section-heading">
                  <strong>Follow-up Timing</strong>
                  <span>Wait for this long, then send the follow-up only if the contact still has not replied.</span>
                </div>
                <div className="lead-record-form-grid">
                  <label className="lead-record-field">
                    <span>Delay minutes</span>
                    <input
                      className="lead-record-input"
                      inputMode="numeric"
                      min={1}
                      onChange={(event) =>
                        updateSelectedWorkflowStep((step) => ({
                          ...step,
                          delayMinutes:
                            event.target.value.trim() && Number(event.target.value) > 0
                              ? Math.round(Number(event.target.value))
                              : null
                        }))
                      }
                      placeholder="60"
                      value={selectedWorkflowStep.delayMinutes ? `${selectedWorkflowStep.delayMinutes}` : ""}
                    />
                  </label>
                  <label className="lead-record-field lead-record-field-wide automation-toggle-row">
                    <span>Cancel if the contact replies before the timer ends</span>
                    <input
                      checked={selectedWorkflowStep.cancelOnInbound !== false}
                      onChange={(event) =>
                        updateSelectedWorkflowStep((step) => ({
                          ...step,
                          cancelOnInbound: event.target.checked
                        }))
                      }
                      type="checkbox"
                    />
                  </label>
                  <label className="lead-record-field lead-record-field-wide automation-toggle-row">
                    <span>Cancel if a human reply pauses automation</span>
                    <input
                      checked={Boolean(selectedWorkflowStep.cancelOnHumanReply)}
                      onChange={(event) =>
                        updateSelectedWorkflowStep((step) => ({
                          ...step,
                          cancelOnHumanReply: event.target.checked
                        }))
                      }
                      type="checkbox"
                    />
                  </label>
                </div>
              </div>
            ) : null}

            {selectedWorkflowStep.type === "go_to" ? (
              <div className="workflow-node-section-card lead-record-field lead-record-field-wide">
                <div className="workflow-node-section-heading">
                  <strong>Target</strong>
                  <span>Choose which step to jump to next.</span>
                </div>
                <label className="lead-record-field">
                  <span>Go to step</span>
                  <select
                    className="lead-record-input app-select"
                    onChange={(event) =>
                      updateSelectedWorkflowStep((step) => ({
                        ...step,
                        targetStepId: event.target.value || null
                      }))
                    }
                    value={selectedWorkflowStep.targetStepId ?? ""}
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
                  <span className="field-hint">Drop this node at the end of a branch, then point it back to the menu or any other step.</span>
                </label>
              </div>
            ) : null}

            {"reply" in selectedWorkflowStep ? (
              <div className="workflow-node-section-card lead-record-field lead-record-field-wide">
                <div className="workflow-node-section-heading">
                  <strong>{selectedWorkflowStep.type === "reply" ? "Message" : isFollowUpNode ? "Follow-up Reply" : "Reply"}</strong>
                  <span>{getWorkflowReplyDescription(selectedWorkflowStep.type)}</span>
                </div>
                <label className="lead-record-field">
                  <span>{selectedWorkflowStep.type === "reply" ? "Intro message" : isFollowUpNode ? "Follow-up message" : "Reply"}</span>
                  <textarea
                    className="lead-record-input lead-record-textarea"
                    onChange={(event) => updateSelectedWorkflowStep((step) => ({ ...step, reply: event.target.value }))}
                    ref={workflowReplyBodyRef}
                    value={selectedWorkflowStep.reply ?? ""}
                  />
                  {selectedWorkflowStep.type === "reply" ? (
                    <>
                      <span className="field-hint">
                        Use saved variables in the message with placeholders like <code>{"{{name}}"}</code> or <code>{"{{city}}"}</code>.
                      </span>
                      {selectedWorkflowVariables.length ? (
                        <div className="automation-suggestion-row workflow-suggestion-row">
                          {selectedWorkflowVariables.map((variable) => {
                            const token = `{{${variable.key}}}`;
                            return (
                              <button
                                className="lead-chip automation-suggestion-chip workflow-suggestion-chip"
                                key={token}
                                onClick={() => insertReplyTemplateToken(token)}
                                type="button"
                              >
                                {token}
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                    </>
                  ) : null}
                  {isReplyNode ? (
                    <>
                      <AutomationMediaSelector
                        assets={mediaAssets}
                        emptyMessage="No media in the library yet. Upload shared assets in Setup > Media Library."
                        onChange={(mediaAssetIds) =>
                          updateSelectedWorkflowStep((step) => ({
                            ...step,
                            mediaAssetIds,
                            mediaItems: syncWorkflowMediaItems(step.mediaItems ?? [], mediaAssetIds)
                          }))
                        }
                        selectedIds={(selectedWorkflowStep.mediaItems ?? []).map((item) => item.mediaAssetId)}
                      />
                      <div className="automation-emoji-toolbar">
                        <button
                          aria-label="Open emoji picker"
                          className="automation-emoji-icon-button"
                          onClick={() =>
                            setActiveEmojiField((current) => (current === "workflowReplyBody" ? null : "workflowReplyBody"))
                          }
                          ref={workflowReplyEmojiButtonRef}
                          type="button"
                        >
                          <EmojiIcon />
                        </button>
                      </div>
                    </>
                  ) : null}
                </label>
              </div>
            ) : null}

            {isReplyNode && (selectedWorkflowStep.mediaItems?.length ?? 0) > 0 ? (
              <details className="automation-advanced-block lead-record-field-wide" open>
                <summary>Attachment Captions</summary>
                <div className="lead-record-field lead-record-field-wide workflow-node-section-card">
                  <span>Message for each media</span>
                  <div className="automation-workflow-branch-list">
                    {selectedWorkflowStep.mediaItems?.map((item) => {
                      const asset = mediaAssets.find((entry) => entry.id === item.mediaAssetId);
                      return (
                        <div className="automation-workflow-branch-card" key={item.mediaAssetId}>
                          <input className="lead-record-input" readOnly value={asset?.title ?? item.mediaAssetId} />
                          <textarea
                            className="lead-record-input lead-record-textarea"
                            onChange={(event) =>
                              updateSelectedWorkflowStep((step) => ({
                                ...step,
                                mediaItems: (step.mediaItems ?? []).map((entry) =>
                                  entry.mediaAssetId === item.mediaAssetId
                                    ? { ...entry, message: event.target.value }
                                    : entry
                                )
                              }))
                            }
                            placeholder="Caption/message for this media"
                            ref={(node) => {
                              workflowMediaItemBodyRefs.current[item.mediaAssetId] = node;
                            }}
                            value={item.message ?? ""}
                          />
                          <div className="automation-emoji-toolbar">
                            <button
                              aria-label="Open emoji picker"
                              className="automation-emoji-icon-button"
                              onClick={() =>
                                setActiveEmojiField((current) =>
                                  current === `workflowMediaItemMessage:${item.mediaAssetId}`
                                    ? null
                                    : `workflowMediaItemMessage:${item.mediaAssetId}`
                                )
                              }
                              ref={(node) => {
                                workflowMediaItemEmojiButtonRefs.current[item.mediaAssetId] = node;
                              }}
                              type="button"
                            >
                              <EmojiIcon />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </details>
            ) : null}

            {supportsPrompt ? (
              <div className="workflow-node-section-card lead-record-field lead-record-field-wide">
                <div className="workflow-node-section-heading">
                  <strong>Question Options</strong>
                  <span>Keep the node focused here. Open the dedicated editor for saved replies, decision logic, and fallback behavior.</span>
                </div>
                <div className="workflow-question-options-summary">
                  <div className="workflow-question-options-summary-item">
                    <span className="workflow-question-options-summary-label">Saves to</span>
                    <strong>{promptNode?.saveAs?.trim() || "Not saving reply"}</strong>
                  </div>
                  <div className="workflow-question-options-summary-item">
                    <span className="workflow-question-options-summary-label">Reply timeout</span>
                    <strong>{promptNode?.expiresAfterMinutes ? `${promptNode.expiresAfterMinutes} min` : "No timeout"}</strong>
                  </div>
                  <div className="workflow-question-options-summary-item">
                    <span className="workflow-question-options-summary-label">On timeout</span>
                    <strong>
                      {promptNode?.onTimeoutStepId
                        ? availableWorkflowSteps.find((step) => step.id === promptNode.onTimeoutStepId)?.title?.trim() ||
                          promptNode.onTimeoutStepId
                        : "End workflow"}
                    </strong>
                  </div>
                  {promptNode?.type === "question" || promptNode?.type === "choice" ? (
                    <>
                      <div className="workflow-question-options-summary-item">
                        <span className="workflow-question-options-summary-label">Decision source</span>
                        <strong>{promptNode.decisionSource === "savedValue" ? "Saved value" : "Current reply"}</strong>
                      </div>
                      <div className="workflow-question-options-summary-item">
                        <span className="workflow-question-options-summary-label">Fallback</span>
                        <strong>{promptNode.fallbackReply?.trim() ? "Configured" : "Not set"}</strong>
                      </div>
                      <div className="workflow-question-options-summary-item">
                        <span className="workflow-question-options-summary-label">Max retries</span>
                        <strong>{promptNode.maxRetries ? `${promptNode.maxRetries}` : "Unlimited"}</strong>
                      </div>
                    </>
                  ) : null}
                </div>
                {promptNode?.saveAs?.trim() &&
                (() => {
                  const usage = selectedWorkflowVariableUsage.get(promptNode.saveAs.trim()) ?? null;
                  return !usage || (!usage.usedInUpdate && !usage.usedInDecision && !usage.usedInReply);
                })() ? (
                  <div className="automation-rule-note">
                    <strong>Saved variable not used yet</strong>
                    <span>
                      <code>{promptNode.saveAs.trim()}</code> is saved here, but no later node uses it in Update Contact,
                      Saved value decisions, or Send Reply placeholders yet.
                    </span>
                  </div>
                ) : null}
                <div className="composer-actions inline-actions">
                  <button
                    className="button button-secondary compact-button workflow-compact-button"
                    onClick={() => setIsQuestionOptionsOpen(true)}
                    type="button"
                  >
                    Edit Question Options
                  </button>
                </div>
              </div>
            ) : null}

            {supportsUpdates ? (
              <details className="automation-advanced-block lead-record-field-wide">
                <summary>Lead Updates</summary>
                <div className="lead-record-form-grid">
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
                  {selectedWorkflowStep.type === "update" ? (
                    <>
                      <label className="lead-record-field">
                        <span>Assignment</span>
                        <select
                          className="lead-record-input app-select"
                          onChange={(event) =>
                            updateSelectedWorkflowStep((step) => {
                              if (step.type !== "update") {
                                return step;
                              }

                              const assignmentMode = normalizeWorkflowAssignmentMode(event.target.value);
                              return {
                                ...step,
                                assignmentMode,
                                assignOwnerId: assignmentMode === "fixed" ? step.assignOwnerId ?? null : null,
                                roundRobinAgentIds: assignmentMode === "round_robin" ? step.roundRobinAgentIds ?? [] : [],
                                overwriteExistingOwner:
                                  assignmentMode === "none" ? false : Boolean(step.overwriteExistingOwner)
                              };
                            })
                          }
                          value={selectedWorkflowStep.assignmentMode ?? "none"}
                        >
                          <option value="none">No change</option>
                          <option value="fixed">Assign specific agent</option>
                          <option value="round_robin">Round robin</option>
                        </select>
                      </label>
                      {(selectedWorkflowStep.assignmentMode ?? "none") === "fixed" ? (
                        <label className="lead-record-field">
                          <span>Assign agent</span>
                          <select
                            className="lead-record-input app-select"
                            onChange={(event) =>
                              updateSelectedWorkflowStep((step) =>
                                step.type === "update"
                                  ? {
                                      ...step,
                                      assignOwnerId: event.target.value.trim() || null
                                    }
                                  : step
                              )
                            }
                            value={selectedWorkflowStep.assignOwnerId ?? ""}
                          >
                            <option value="">Choose agent</option>
                            {agents.map((agent) => (
                              <option key={agent.id} value={agent.id}>
                                {agent.name} · {formatAgentRole(agent.role)}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : null}
                      {(selectedWorkflowStep.assignmentMode ?? "none") === "round_robin" ? (
                        <label className="lead-record-field lead-record-field-wide">
                          <span>Round robin agents</span>
                          <select
                            className="lead-record-input app-select"
                            multiple
                            onChange={(event) =>
                              updateSelectedWorkflowStep((step) =>
                                step.type === "update"
                                  ? {
                                      ...step,
                                      roundRobinAgentIds: Array.from(event.target.selectedOptions).map((option) => option.value)
                                    }
                                  : step
                              )
                            }
                            value={selectedWorkflowStep.roundRobinAgentIds ?? []}
                          >
                            {agents.map((agent) => (
                              <option key={agent.id} value={agent.id}>
                                {agent.name} · {formatAgentRole(agent.role)}
                              </option>
                            ))}
                          </select>
                          <span className="field-hint">Select at least two active agents. The workflow assigns the next conversation in order.</span>
                        </label>
                      ) : null}
                      {(selectedWorkflowStep.assignmentMode ?? "none") !== "none" ? (
                        <label className="lead-record-field lead-record-field-wide automation-toggle-row">
                          <span>Overwrite existing owner</span>
                          <input
                            checked={Boolean(selectedWorkflowStep.overwriteExistingOwner)}
                            onChange={(event) =>
                              updateSelectedWorkflowStep((step) =>
                                step.type === "update"
                                  ? {
                                      ...step,
                                      overwriteExistingOwner: event.target.checked
                                    }
                                  : step
                              )
                            }
                            type="checkbox"
                          />
                        </label>
                      ) : null}
                    </>
                  ) : "assignOwnerId" in selectedWorkflowStep ? (
                    <label className="lead-record-field">
                      <span>Assign agent</span>
                      <select
                        className="lead-record-input app-select"
                        onChange={(event) =>
                          updateSelectedWorkflowStep((step) => ({
                            ...step,
                            assignOwnerId: event.target.value.trim() || null
                          }))
                        }
                        value={selectedWorkflowStep.assignOwnerId ?? ""}
                      >
                        <option value="">No change</option>
                        {agents.map((agent) => (
                          <option key={agent.id} value={agent.id}>
                            {agent.name} · {formatAgentRole(agent.role)}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  {(selectedWorkflowStep.type === "update" || selectedWorkflowStep.type === "action") ? (
                    <>
                      <label className="lead-record-field">
                        <span>Snooze</span>
                        <select
                          className="lead-record-input app-select"
                          onChange={(event) =>
                            updateSelectedWorkflowStep((step) =>
                              step.type === "update" || step.type === "action"
                                ? {
                                    ...step,
                                    snoozeAction: normalizeWorkflowSnoozeAction(event.target.value),
                                    snoozeDurationMinutes:
                                      event.target.value === "snooze" ? step.snoozeDurationMinutes ?? 60 : null
                                  }
                                : step
                            )
                          }
                          value={selectedWorkflowStep.snoozeAction ?? "none"}
                        >
                          <option value="none">No change</option>
                          <option value="snooze">Snooze conversation</option>
                          <option value="unsnooze">Unsnooze conversation</option>
                        </select>
                      </label>
                      {(selectedWorkflowStep.snoozeAction ?? "none") === "snooze" ? (
                        <>
                          <label className="lead-record-field">
                            <span>Snooze minutes</span>
                            <input
                              className="lead-record-input"
                              min={1}
                              onChange={(event) =>
                                updateSelectedWorkflowStep((step) =>
                                  step.type === "update" || step.type === "action"
                                    ? {
                                        ...step,
                                        snoozeDurationMinutes: Math.max(1, Number(event.target.value) || 0)
                                      }
                                    : step
                                )
                              }
                              type="number"
                              value={selectedWorkflowStep.snoozeDurationMinutes ?? 60}
                            />
                          </label>
                          <label className="lead-record-field lead-record-field-wide">
                            <span>Snooze reason</span>
                            <input
                              className="lead-record-input"
                              onChange={(event) =>
                                updateSelectedWorkflowStep((step) =>
                                  step.type === "update" || step.type === "action"
                                    ? {
                                        ...step,
                                        snoozeReason: event.target.value
                                      }
                                    : step
                                )
                              }
                              placeholder="Awaiting customer reply"
                              value={selectedWorkflowStep.snoozeReason ?? ""}
                            />
                          </label>
                        </>
                      ) : null}
                    </>
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
                  {selectedWorkflowStep.type === "update" ? (
                    <>
                      <label className="lead-record-field">
                        <span>Content field</span>
                        <select
                          className="lead-record-input app-select"
                          onChange={(event) =>
                            updateSelectedWorkflowStep((step) =>
                              step.type === "update"
                                ? {
                                    ...step,
                                    leadAttributeKey: event.target.value || null
                                  }
                                : step
                            )
                          }
                          value={selectedWorkflowStep.leadAttributeKey ?? ""}
                        >
                          <option value="">No attribute update</option>
                          {LEAD_ATTRIBUTE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      {selectedWorkflowStep.leadAttributeKey === "custom" ? (
                        <label className="lead-record-field">
                          <span>Custom field key</span>
                          <input
                            className="lead-record-input"
                            onChange={(event) =>
                              updateSelectedWorkflowStep((step) =>
                                step.type === "update"
                                  ? {
                                      ...step,
                                      leadCustomAttributeKey: event.target.value
                                    }
                                  : step
                              )
                            }
                            placeholder="interest"
                            value={selectedWorkflowStep.leadCustomAttributeKey ?? ""}
                          />
                        </label>
                      ) : null}
                      {selectedWorkflowStep.leadAttributeKey ? (
                        <>
                          <label className="lead-record-field">
                            <span>Value source</span>
                            <select
                              className="lead-record-input app-select"
                              onChange={(event) =>
                                updateSelectedWorkflowStep((step) =>
                                  step.type === "update"
                                    ? {
                                        ...step,
                                        leadAttributeValueSource: event.target.value === "savedValue" ? "savedValue" : "literal"
                                      }
                                    : step
                                )
                              }
                              value={selectedWorkflowStep.leadAttributeValueSource ?? "literal"}
                            >
                              <option value="literal">Typed value</option>
                              <option value="savedValue">Saved answer</option>
                            </select>
                          </label>
                          {(selectedWorkflowStep.leadAttributeValueSource ?? "literal") === "savedValue" ? (
                            <div className="lead-record-field lead-record-field-wide">
                              <span>Saved answer key</span>
                              <input
                                className="lead-record-input"
                                list={`workflow-update-variable-options-${selectedWorkflowStep.id}`}
                                onChange={(event) =>
                                  updateSelectedWorkflowStep((step) =>
                                    step.type === "update"
                                      ? {
                                          ...step,
                                          leadAttributeValueKey: event.target.value
                                        }
                                      : step
                                  )
                                }
                                placeholder="budget"
                                value={selectedWorkflowStep.leadAttributeValueKey ?? ""}
                              />
                              <datalist id={`workflow-update-variable-options-${selectedWorkflowStep.id}`}>
                                {selectedWorkflowVariables.map((variable) => (
                                  <option key={variable.key} value={variable.key} />
                                ))}
                              </datalist>
                              {selectedWorkflowVariables.length ? (
                                <div className="automation-suggestion-row">
                                  {selectedWorkflowVariables.map((variable) => (
                                    <button
                                      className="lead-chip automation-suggestion-chip"
                                      key={variable.key}
                                      onClick={() =>
                                        updateSelectedWorkflowStep((step) =>
                                          step.type === "update"
                                            ? {
                                                ...step,
                                                leadAttributeValueKey: variable.key
                                              }
                                            : step
                                        )
                                      }
                                      type="button"
                                    >
                                      {variable.key}
                                    </button>
                                  ))}
                                </div>
                              ) : null}
                              {getWorkflowSavedAnswerKeySuggestions(selectedWorkflowStep.leadAttributeKey).length ? (
                                <div className="automation-suggestion-row">
                                  {getWorkflowSavedAnswerKeySuggestions(selectedWorkflowStep.leadAttributeKey).map((suggestion) => (
                                    <button
                                      className="lead-chip automation-suggestion-chip"
                                      key={suggestion}
                                      onClick={() =>
                                        updateSelectedWorkflowStep((step) =>
                                          step.type === "update"
                                            ? {
                                                ...step,
                                                leadAttributeValueKey: suggestion
                                              }
                                            : step
                                        )
                                      }
                                      type="button"
                                    >
                                      {suggestion}
                                    </button>
                                  ))}
                                </div>
                              ) : null}
                              <span className="field-hint">
                                Prefer one of this workflow&apos;s saved variables above. Common key suggestions remain available below.
                              </span>
                            </div>
                          ) : (
                            <label className="lead-record-field">
                              <span>Attribute value</span>
                              <input
                                className="lead-record-input"
                                onChange={(event) =>
                                  updateSelectedWorkflowStep((step) =>
                                    step.type === "update"
                                      ? {
                                          ...step,
                                          leadAttributeValue: event.target.value
                                        }
                                      : step
                                  )
                                }
                                placeholder={getWorkflowContentAttributePlaceholder(selectedWorkflowStep.leadAttributeKey)}
                                value={selectedWorkflowStep.leadAttributeValue ?? ""}
                              />
                            </label>
                          )}
                          <div className="table-subtle lead-record-field-wide">
                            {getWorkflowContentAttributeHelperText(selectedWorkflowStep.leadAttributeKey)}
                          </div>
                          {selectedWorkflowStepValidationError ? (
                            <div className="form-error lead-record-field-wide">
                              {selectedWorkflowStepValidationError}
                            </div>
                          ) : null}
                        </>
                      ) : null}
                    </>
                  ) : null}
                </div>
              </details>
            ) : null}

            {selectedWorkflowStep.type === "update" || selectedWorkflowStep.type === "action" ? (
              <div className="workflow-node-section-card lead-record-field lead-record-field-wide">
                <div className="workflow-node-section-heading">
                  <strong>Team Notification</strong>
                  <span>Configure who should get a WhatsApp alert when this node runs.</span>
                </div>
                <div className="workflow-question-options-summary">
                  <div className="workflow-question-options-summary-item">
                    <span className="workflow-question-options-summary-label">Assigned owner</span>
                    <strong>{selectedWorkflowStep.notifyAssignedOwner ? "Yes" : "No"}</strong>
                  </div>
                  <div className="workflow-question-options-summary-item">
                    <span className="workflow-question-options-summary-label">Selected members</span>
                    <strong>{selectedWorkflowStep.notifyAgentIds?.length ?? 0}</strong>
                  </div>
                  <div className="workflow-question-options-summary-item">
                    <span className="workflow-question-options-summary-label">Message</span>
                    <strong>{selectedWorkflowStep.notifyMessage?.trim() ? "Configured" : "Not set"}</strong>
                  </div>
                </div>
                {getWorkflowNotificationInlineError(selectedWorkflowStep) ? (
                  <div className="form-error lead-record-field-wide">
                    {getWorkflowNotificationInlineError(selectedWorkflowStep)}
                  </div>
                ) : null}
                <div className="composer-actions inline-actions">
                  <button
                    className="button button-secondary compact-button workflow-compact-button"
                    onClick={() => setIsNotificationOptionsOpen(true)}
                    type="button"
                  >
                    Edit Notification
                  </button>
                </div>
              </div>
            ) : null}

            {supportsRouting ? (
              <details className="automation-advanced-block lead-record-field-wide">
                <summary>Routing</summary>
                {"branches" in selectedWorkflowStep ? (
                  <div className="lead-record-field lead-record-field-wide workflow-node-section-card">
                    <span>Branches</span>
                    <div className="automation-workflow-branch-list">
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
                          <div className="automation-rule-note">
                            <strong>Route</strong>
                            <span>Use the canvas path itself for branch routing. To return to a menu later, drag in a `Go To Step` node.</span>
                          </div>
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
                  </div>
                ) : (
                  <div className="automation-rule-note">
                    <strong>Routing lives on the canvas</strong>
                    <span>Connect nodes directly on the workflow canvas to change what happens next.</span>
                  </div>
                )}
              </details>
            ) : null}
          </div>

          <div className="composer-actions inline-actions workflow-node-footer">
            <button className="button button-secondary compact-button" onClick={removeSelectedWorkflowStep} type="button">
              Delete node
            </button>
          </div>
        </div>
      </section>
    );
  };

  const workflowBuilderStyle =
    workflowWorkspaceMode === "side"
      ? ({
          "--workflow-inspector-width": `${100 - workflowCanvasWidthPercent}%`
        } as CSSProperties)
      : undefined;

  const renderWorkflow = () => (
    <article className="content-card automation-settings-card automation-workflow-shell">
      <div className="card-header">
        <div>
          <h3 className="card-title">Structured workflow</h3>
          <p className="muted">
            {activeMode === "editor"
              ? "Define a graph-like step flow now, then layer drag-and-drop on top later."
              : "Only created workflows are shown here. Open one to edit it on the canvas."}
          </p>
        </div>
        {activeMode === "editor" ? (
          <button className="inbox-search-tool" onClick={() => navigateAutomationView("workflow")} type="button">
            Back to workflows
          </button>
        ) : (
          <button className="button button-primary compact-button" onClick={createWorkflow} type="button">
            New workflow
          </button>
        )}
      </div>

      {activeMode === "list" ? (
      <section className="lead-record-panel">
        <div className="lead-record-section-head">
          <strong>Workflow list</strong>
          <span>Select an existing workflow or create a new one to open the canvas.</span>
        </div>
        <div className="automation-workflow-list">
          {workflowList.map((workflow) => (
            <div
              className={`automation-workflow-list-item${workflow.id === selectedWorkflowId ? " selected" : ""}`}
              key={workflow.id}
            >
              <div className="automation-workflow-list-main">
                <strong>{workflow.name}</strong>
                <span>{workflow.isActive ? "Active at runtime" : "Inactive workflow"}</span>
              </div>
              <div className="automation-workflow-list-actions">
                <button
                  className="inbox-search-tool"
                  onClick={() => navigateAutomationView("workflow", { mode: "editor", workflowId: workflow.id })}
                  type="button"
                >
                  Edit
                </button>
                {workflow.isActive ? (
                  <button className="inbox-search-tool" onClick={() => toggleWorkflowActive(workflow.id, false)} type="button">
                    Deactivate
                  </button>
                ) : (
                  <button className="inbox-search-tool" onClick={() => toggleWorkflowActive(workflow.id, true)} type="button">
                    Activate
                  </button>
                )}
                <button className="inbox-search-tool" onClick={() => deleteWorkflow(workflow.id)} type="button">
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
      ) : null}

      {activeMode === "editor" ? (
      <section className="lead-record-panel">
        <div className="lead-record-section-head">
          <strong>Workflow canvas</strong>
          <span>Balanced view keeps the canvas and inspector visible together.</span>
        </div>
        {!selectedWorkflow ? (
          <div className="table-subtle">
            No workflows yet. Create a workflow to open the designer and test panel.
          </div>
        ) : (
          <>
          {selectedWorkflowWarnings.length ? (
            <div className="wa-help-notice automation-workflow-warning-list">
              <strong>Workflow warnings</strong>
              {selectedWorkflowWarnings.map((warning) => (
                <span key={warning}>{warning}</span>
              ))}
            </div>
          ) : null}
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
        <div
          className={`automation-workflow-builder automation-workflow-builder-${workflowWorkspaceMode}`}
          ref={workflowBuilderRef}
          style={workflowBuilderStyle}
        >
          <WorkflowLibraryDesigner
            key={`${selectedWorkflowId ?? "workflow"}:${workflowWorkspaceMode}`}
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
        {workflowWorkspaceMode === "side" ? (
          <div
            aria-hidden="true"
            className="automation-workflow-resizer"
              onPointerDown={(event) => {
                event.preventDefault();
                workflowResizeStateRef.current.active = true;
              }}
            />
          ) : null}

          <div className="automation-workflow-inspector">{renderWorkflowNodeInspector("rail")}</div>
        </div>
        {isWorkflowInspectorExpanded
          ? createPortal(
              <div
                aria-hidden={!isWorkflowInspectorExpanded}
                className="inbox-dialog-backdrop workflow-inspector-backdrop"
                onClick={() => setIsWorkflowInspectorExpanded(false)}
                style={{ zIndex: INBOX_LAYERS.modal }}
              >
                <div
                  aria-modal="true"
                  className="inbox-dialog workflow-inspector-dialog"
                  onClick={(event) => event.stopPropagation()}
                  role="dialog"
                  style={{ zIndex: INBOX_LAYERS.modal + 1 }}
                >
                  {renderWorkflowNodeInspector("dialog")}
                </div>
              </div>,
              document.body
            )
          : null}
        {isQuestionOptionsOpen &&
        selectedWorkflowStep &&
        (selectedWorkflowStep.type === "ask" ||
          selectedWorkflowStep.type === "question" ||
          selectedWorkflowStep.type === "choice")
          ? createPortal(
              <div
                aria-hidden={!isQuestionOptionsOpen}
                className="inbox-dialog-backdrop workflow-inspector-backdrop"
                onClick={() => setIsQuestionOptionsOpen(false)}
                style={{ zIndex: INBOX_LAYERS.modal }}
              >
                <div
                  aria-modal="true"
                  className="inbox-dialog workflow-question-options-dialog"
                  onClick={(event) => event.stopPropagation()}
                  role="dialog"
                  style={{ zIndex: INBOX_LAYERS.modal + 1 }}
                >
                  <div className="inbox-dialog-head">
                    <div>
                      <strong>Question Options</strong>
                      <p>Configure saved replies, decision source, retries, and fallback behavior without crowding the node inspector.</p>
                    </div>
                    <button
                      aria-label="Close question options editor"
                      className="inbox-dialog-close"
                      onClick={() => setIsQuestionOptionsOpen(false)}
                      type="button"
                    >
                      ×
                    </button>
                  </div>
                  <div className="inbox-dialog-body workflow-question-options-dialog-body">
                    {renderQuestionOptionsEditor(
                      selectedWorkflowStep as WorkflowDraft["steps"][number] & { type: "ask" | "question" | "choice" }
                    )}
                  </div>
                  <div className="inbox-dialog-actions">
                    <div className="inbox-dialog-actions-right">
                      <button
                        className="inbox-dialog-primary"
                        onClick={() => setIsQuestionOptionsOpen(false)}
                        type="button"
                      >
                        Done
                      </button>
                    </div>
                  </div>
                </div>
              </div>,
              document.body
            )
          : null}
        {isNotificationOptionsOpen &&
        selectedWorkflowStep &&
        (selectedWorkflowStep.type === "action" || selectedWorkflowStep.type === "update")
          ? createPortal(
              <div
                aria-hidden={!isNotificationOptionsOpen}
                className="inbox-dialog-backdrop workflow-inspector-backdrop"
                onClick={() => setIsNotificationOptionsOpen(false)}
                style={{ zIndex: INBOX_LAYERS.modal }}
              >
                <div
                  aria-modal="true"
                  className="inbox-dialog workflow-question-options-dialog"
                  onClick={(event) => event.stopPropagation()}
                  role="dialog"
                  style={{ zIndex: INBOX_LAYERS.modal + 1 }}
                >
                  <div className="inbox-dialog-head">
                    <div>
                      <strong>Team Notification</strong>
                      <p>Choose who should receive a WhatsApp alert and compose the message without crowding the node inspector.</p>
                    </div>
                    <button
                      aria-label="Close team notification editor"
                      className="inbox-dialog-close"
                      onClick={() => setIsNotificationOptionsOpen(false)}
                      type="button"
                    >
                      ×
                    </button>
                  </div>
                  <div className="inbox-dialog-body workflow-question-options-dialog-body">
                    {renderNotificationOptionsEditor(
                      selectedWorkflowStep as WorkflowDraft["steps"][number] & { type: "action" | "update" }
                    )}
                  </div>
                  <div className="inbox-dialog-actions">
                    <div className="inbox-dialog-actions-right">
                      <button
                        className="inbox-dialog-primary"
                        onClick={() => setIsNotificationOptionsOpen(false)}
                        type="button"
                      >
                        Done
                      </button>
                    </div>
                  </div>
                </div>
              </div>,
              document.body
            )
          : null}
          </>
        )}
      </section>
      ) : null}

      {error ? <div className="form-error">{error}</div> : null}

      {activeMode === "editor" ? (
      <div className="composer-actions automation-workflow-footer-actions">
        <button className="button button-secondary" onClick={() => navigateAutomationView("workflow")} type="button">
          Back
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
      ) : null}
    </article>
  );

  const renderEntryQr = () => (
    <AutomationEntryQrPanel
      keywordRules={rules
        .filter((rule) => rule.enabled && rule.triggerType === AutomationTriggerType.KEYWORD_MATCH)
        .map((rule) => ({
          id: rule.id,
          name: rule.name,
          keyword: rule.keyword,
          matchLabel: rule.matchLabel
        }))}
      liveKeywordTesting={liveKeywordTesting}
    />
  );

  const renderTesting = () => <AutomationTestPanel workspaceId={workspaceId} />;

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
            <Button
              aria-selected={activeTab === tab.id}
              className={`automation-tab-button ${activeTab === tab.id ? "active" : ""}`}
              key={tab.id}
              onClick={() => {
                setActiveTab(tab.id);
                navigateAutomationView(tab.id);
              }}
              role="tab"
              selected={activeTab === tab.id}
              variant="toggle"
            >
              <strong>{tab.label}</strong>
              <span>{tab.description}</span>
            </Button>
          ))}
        </div>
      </article>

      {activeTab === "rules" ? renderRules() : null}
      {activeTab === "hours" ? renderHours() : null}
      {activeTab === "workflow" ? renderWorkflow() : null}
      {activeTab === "entryQr" ? renderEntryQr() : null}
      {activeTab === "testing" ? renderTesting() : null}

      <PortalDropdown
        align="start"
        anchorRef={
          activeEmojiField === "followUpReplyBody"
            ? followUpEmojiButtonRef
            : activeEmojiField === "workflowReplyBody"
              ? workflowReplyEmojiButtonRef
              : activeEmojiField === "workflowPromptBody"
                ? workflowPromptEmojiButtonRef
                : activeEmojiField === "workflowFallbackReplyBody"
                  ? workflowFallbackReplyEmojiButtonRef
                  : activeEmojiField === "workflowNotificationMessage"
                    ? workflowNotificationEmojiButtonRef
                    : activeEmojiField?.startsWith("workflowMediaItemMessage:")
                      ? { current: workflowMediaItemEmojiButtonRefs.current[activeEmojiField.slice("workflowMediaItemMessage:".length)] ?? null }
                      : replyEmojiButtonRef
        }
        className="automation-emoji-dropdown"
        onClose={() => setActiveEmojiField(null)}
        open={Boolean(activeEmojiField)}
        side="bottom"
        zIndex={INBOX_LAYERS.modal + 2}
      >
        <div className="automation-emoji-picker-shell">
          <FullEmojiPicker
            onEmojiSelect={(emoji) => {
              if (!activeEmojiField) {
                return;
              }

              if (activeEmojiField === "workflowReplyBody") {
                insertWorkflowReplyEmoji(emoji);
                return;
              }

              if (activeEmojiField === "workflowPromptBody") {
                insertWorkflowPromptEmoji(emoji);
                return;
              }

              if (activeEmojiField === "workflowFallbackReplyBody") {
                insertWorkflowFallbackReplyEmoji(emoji);
                return;
              }

              if (activeEmojiField === "workflowNotificationMessage") {
                insertWorkflowNotificationEmoji(emoji);
                return;
              }

              if (activeEmojiField.startsWith("workflowMediaItemMessage:")) {
                insertWorkflowMediaItemEmoji(activeEmojiField.slice("workflowMediaItemMessage:".length), emoji);
                return;
              }

              if (activeEmojiField === "replyBody" || activeEmojiField === "followUpReplyBody") {
                insertEmoji(activeEmojiField, emoji);
              }
            }}
          />
        </div>
      </PortalDropdown>
      {isKeywordManagerOpen
        ? createPortal(
            <div
              aria-hidden={!isKeywordManagerOpen}
              className="inbox-dialog-backdrop"
              onClick={() => setIsKeywordManagerOpen(false)}
              style={{ zIndex: INBOX_LAYERS.modal }}
            >
              <div
                aria-modal="true"
                className="inbox-dialog automation-keyword-dialog"
                onClick={(event) => event.stopPropagation()}
                role="dialog"
                style={{ zIndex: INBOX_LAYERS.modal + 1 }}
              >
                <div className="inbox-dialog-head">
                  <div>
                    <strong>Manage keywords</strong>
                    <p>Add each word or phrase once. This list stays scrollable even with large sets.</p>
                  </div>
                  <button
                    aria-label="Close keyword manager"
                    className="inbox-dialog-close"
                    onClick={() => setIsKeywordManagerOpen(false)}
                    type="button"
                  >
                    ×
                  </button>
                </div>
                <div className="inbox-dialog-body automation-keyword-dialog-body">
                  <div className="automation-keyword-dialog-toolbar">
                    <input
                      className="inbox-dialog-input automation-keyword-dialog-input"
                      onChange={(event) => setAnyWordsDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === ",") {
                          event.preventDefault();
                          commitAnyWordsDraft();
                          return;
                        }

                        if (event.key === "Backspace" && !anyWordsDraft && anyWordsValues.length) {
                          event.preventDefault();
                          removeAnyWordsValue(anyWordsValues[anyWordsValues.length - 1]);
                        }
                      }}
                      onBlur={commitAnyWordsDraft}
                      placeholder={selectedMatchOperatorOption?.placeholder ?? "Add keyword"}
                      value={anyWordsDraft}
                    />
                    <button className="inbox-dialog-primary" onClick={commitAnyWordsDraft} type="button">
                      Add
                    </button>
                  </div>
                  <span className="field-hint">Press Enter or comma to add each keyword.</span>
                  <div className="automation-keyword-dialog-summary">
                    <strong>{anyWordsValues.length} keyword{anyWordsValues.length === 1 ? "" : "s"}</strong>
                    {anyWordsValues.length ? (
                      <button className="inbox-dialog-secondary" onClick={clearAnyWordsValues} type="button">
                        Clear all
                      </button>
                    ) : null}
                  </div>
                  {anyWordsValues.length ? (
                    <div className="automation-keyword-dialog-list">
                      {anyWordsValues.map((value) => (
                        <div className="automation-keyword-dialog-item" key={value}>
                          <div className="automation-keyword-dialog-item-copy">
                            <strong>{value}</strong>
                          </div>
                          <button
                            className="inbox-dialog-secondary"
                            onClick={() => removeAnyWordsValue(value)}
                            type="button"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="automation-keyword-dialog-empty">
                      No keywords yet. Add words or phrases to trigger this rule.
                    </div>
                  )}
                </div>
                <div className="inbox-dialog-actions">
                  <div className="inbox-dialog-actions-right">
                    <button className="inbox-dialog-primary" onClick={() => setIsKeywordManagerOpen(false)} type="button">
                      Done
                    </button>
                  </div>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </section>
  );
}

function AutomationMediaSelector({
  assets,
  selectedIds,
  onChange,
  emptyMessage
}: {
  assets: MediaLibraryAsset[];
  selectedIds: string[];
  onChange: (assetIds: string[]) => void;
  emptyMessage: string;
}) {
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<"all" | MediaAssetKindValue>("all");
  const [isManagerOpen, setIsManagerOpen] = useState(false);

  if (!assets.length) {
    return <div className="automation-media-selector-empty">{emptyMessage}</div>;
  }

  const selectedSet = new Set(selectedIds);
  const selectedAssets = mapSelectedMediaAssets(assets, selectedIds);
  const visibleSelectedAssets = selectedAssets.slice(0, 4);
  const hiddenSelectedAssetsCount = Math.max(0, selectedAssets.length - visibleSelectedAssets.length);
  const availableAssets = assets.filter((asset) => !selectedSet.has(asset.id));
  const filteredAssets = availableAssets.filter((asset) => {
    if (kindFilter !== "all" && asset.kind !== kindFilter) {
      return false;
    }

    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return true;
    }

    return (
      asset.title.toLowerCase().includes(normalizedQuery) ||
      getMediaKindLabel(asset.kind, asset.mimeType).toLowerCase().includes(normalizedQuery)
    );
  });

  return (
    <>
      <div className="automation-media-summary-card">
        <div className="automation-media-summary-head">
          <div className="automation-media-summary-copy">
            <strong>
              {selectedAssets.length ? `${selectedAssets.length} media selected` : "No media selected"}
            </strong>
            <span>
              {selectedAssets.length
                ? selectedAssets.length > 4
                  ? `Showing 4 of ${selectedAssets.length}. The rest stay attached.`
                  : "Attachments stay separate from the rule settings."
                : "Attach images, audio, video, or PDFs using the same lightweight pattern as the inbox composer."}
            </span>
          </div>
          <div className="automation-media-summary-actions">
            <button className="inbox-search-tool" onClick={() => setIsManagerOpen(true)} type="button">
              Add media
            </button>
            {selectedAssets.length ? (
              <button className="inbox-dialog-secondary" onClick={() => onChange([])} type="button">
                Clear
              </button>
            ) : null}
          </div>
        </div>
        {selectedAssets.length ? (
          <div className="inbox-attachment-row automation-media-summary-row">
            {visibleSelectedAssets.map((asset, index) => (
              <span className="inbox-attachment-chip" key={asset.id} title={asset.title}>
                <AttachmentIcon />
                <span>{`${index + 1}. ${asset.title} · ${getMediaKindLabel(asset.kind, asset.mimeType)}`}</span>
              </span>
            ))}
            {hiddenSelectedAssetsCount ? (
              <span className="inbox-attachment-chip inbox-attachment-chip-summary">
                <AttachmentIcon />
                <span>{`+${hiddenSelectedAssetsCount} more`}</span>
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
      {isManagerOpen
        ? createPortal(
            <div
              aria-hidden={!isManagerOpen}
              className="inbox-dialog-backdrop"
              onClick={() => setIsManagerOpen(false)}
              style={{ zIndex: INBOX_LAYERS.modal }}
            >
              <div
                aria-modal="true"
                className="inbox-dialog automation-media-dialog"
                onClick={(event) => event.stopPropagation()}
                role="dialog"
                style={{ zIndex: INBOX_LAYERS.modal + 1 }}
              >
                <div className="inbox-dialog-head">
                  <div>
                    <strong>Manage reply media</strong>
                    <p>Choose items from the library, then reorder the selected sequence here.</p>
                  </div>
                  <button
                    aria-label="Close media manager"
                    className="inbox-dialog-close"
                    onClick={() => setIsManagerOpen(false)}
                    type="button"
                  >
                    ×
                  </button>
                </div>
                <div className="inbox-dialog-body">
                  <div className="automation-media-selector-shell automation-media-selector-shell-dialog">
                    <div className="automation-media-selected-block">
                      <div className="automation-media-block-head">
                        <strong>Selected media</strong>
                        <span>
                          {selectedAssets.length
                            ? `${selectedAssets.length} item${selectedAssets.length === 1 ? "" : "s"}`
                            : "Nothing selected yet"}
                        </span>
                      </div>
                      {selectedAssets.length ? (
                        <div className="automation-media-selected-list">
                          {selectedAssets.map((asset, index) => (
                            <div className="automation-media-selected-item" key={asset.id}>
                              <div className="automation-media-selected-order">{index + 1}</div>
                              <div className="automation-media-selector-copy">
                                <strong>{asset.title}</strong>
                                <span>
                                  {getMediaKindLabel(asset.kind, asset.mimeType)} · {formatMediaAssetSize(asset.sizeBytes)}
                                </span>
                              </div>
                              <div className="automation-media-selected-actions">
                                <button
                                  className="automation-media-sort-button"
                                  disabled={index === 0}
                                  onClick={() => onChange(moveItem(selectedIds, index, index - 1))}
                                  type="button"
                                >
                                  Up
                                </button>
                                <button
                                  className="automation-media-sort-button"
                                  disabled={index === selectedAssets.length - 1}
                                  onClick={() => onChange(moveItem(selectedIds, index, index + 1))}
                                  type="button"
                                >
                                  Down
                                </button>
                                <button
                                  className="automation-media-remove-button"
                                  onClick={() => onChange(selectedIds.filter((value) => value !== asset.id))}
                                  type="button"
                                >
                                  Remove
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="automation-media-selector-empty">Choose assets below to build the send sequence.</div>
                      )}
                    </div>

                    <div className="automation-media-library-block">
                      <div className="automation-media-block-head">
                        <strong>Choose from library</strong>
                        <span>Search, filter, then add to the sequence</span>
                      </div>
                      <div className="automation-media-library-toolbar">
                        <input
                          className="lead-record-input"
                          onChange={(event) => setQuery(event.target.value)}
                          placeholder="Search media..."
                          value={query}
                        />
                        <div className="automation-media-filter-row">
                          {(["all", MediaAssetKind.IMAGE, MediaAssetKind.AUDIO, MediaAssetKind.VIDEO] as const).map((value) => (
                            <button
                              className={`automation-media-filter-chip ${kindFilter === value ? "active" : ""}`}
                              key={value}
                              onClick={() => setKindFilter(value)}
                              type="button"
                            >
                              {value === "all" ? "All" : getMediaKindLabel(value)}
                            </button>
                          ))}
                        </div>
                      </div>
                      {filteredAssets.length ? (
                        <div className="automation-media-selector-list">
                          {filteredAssets.map((asset) => (
                            <button
                              className="automation-media-selector-option"
                              key={asset.id}
                              onClick={() => onChange([...selectedIds, asset.id])}
                              type="button"
                            >
                              <div className="automation-media-selector-copy">
                                <strong>{asset.title}</strong>
                                <span>
                                  {getMediaKindLabel(asset.kind, asset.mimeType)} · {formatMediaAssetSize(asset.sizeBytes)}
                                </span>
                              </div>
                              <span className="automation-media-selector-state">Add</span>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div className="automation-media-selector-empty">
                          No library media matches the current search or filter.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <div className="inbox-dialog-actions">
                  <div className="inbox-dialog-actions-right">
                    <button className="inbox-dialog-primary" onClick={() => setIsManagerOpen(false)} type="button">
                      Done
                    </button>
                  </div>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
}

function AutomationMediaPreviewList({ assets }: { assets: MediaLibraryAsset[] }) {
  return (
    <div className="automation-media-preview-list">
      {assets.map((asset) => (
        <AutomationMediaPreview asset={asset} key={asset.id} />
      ))}
    </div>
  );
}

function AutomationMediaPreview({ asset }: { asset: MediaLibraryAsset }) {
  return (
    <div className="automation-media-preview-card">
      <div className="automation-media-preview-frame">
        <AttachmentPreview
          fileName={asset.originalName || asset.title}
          fit="cover"
          mimeType={asset.mimeType}
          openLabel="Open attachment"
          sizeLabel={formatMediaAssetSize(asset.sizeBytes)}
          url={asset.publicUrl}
        />
      </div>
      <div className="automation-media-preview-copy">
        <strong>{asset.title}</strong>
        <span>
          {getMediaKindLabel(asset.kind, asset.mimeType)} · {formatMediaAssetSize(asset.sizeBytes)}
        </span>
      </div>
    </div>
  );
}

function mapSelectedMediaAssets(assets: MediaLibraryAsset[], selectedIds: string[]) {
  const assetMap = new Map(assets.map((asset) => [asset.id, asset] as const));
  return selectedIds.map((assetId) => assetMap.get(assetId)).filter(Boolean) as MediaLibraryAsset[];
}

function moveItem(values: string[], fromIndex: number, toIndex: number) {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= values.length || toIndex >= values.length) {
    return values;
  }

  const next = [...values];
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
}

type WorkflowVariableType = "text";

type WorkflowVariable = {
  key: string;
  type: WorkflowVariableType;
  description?: string | null;
};

type WorkflowMediaItem = {
  mediaAssetId: string;
  message?: string | null;
};

type WorkflowAssignmentMode = "none" | "fixed" | "round_robin";
type WorkflowSnoozeAction = "none" | "snooze" | "unsnooze";

const LEAD_ATTRIBUTE_OPTIONS = WORKFLOW_CONTENT_ATTRIBUTE_OPTIONS;

type WorkflowDraft = {
  startStepId: string;
  variables?: WorkflowVariable[];
  steps: Array<{
    id: string;
    type: "ask" | "question" | "choice" | "action" | "reply" | "update" | "delay" | "follow_up" | "go_to" | "end";
    title?: string;
    position?: { x: number; y: number };
    prompt?: string;
    saveAs?: string | null;
    decisionSource?: "currentReply" | "savedValue";
    decisionSourceKey?: string | null;
    maxRetries?: number | null;
    expiresAfterMinutes?: number | null;
    onTimeoutStepId?: string | null;
    reply?: string;
    tags?: string[];
    assignOwnerId?: string | null;
    notifyAssignedOwner?: boolean;
    notifyAgentIds?: string[];
    notifyMessage?: string | null;
    assignmentMode?: WorkflowAssignmentMode;
    roundRobinAgentIds?: string[];
    overwriteExistingOwner?: boolean;
    snoozeAction?: WorkflowSnoozeAction;
    snoozeDurationMinutes?: number | null;
    snoozeReason?: string | null;
    leadStage?: string | null;
    leadAttributeKey?: string | null;
    leadAttributeValue?: string | null;
    leadAttributeValueSource?: "literal" | "savedValue";
    leadAttributeValueKey?: string | null;
    leadCustomAttributeKey?: string | null;
    delayMinutes?: number | null;
    businessHoursOnly?: boolean;
    cancelOnInbound?: boolean;
    cancelOnHumanReply?: boolean;
    emoji?: string | null;
    mediaAssetIds?: string[];
    mediaItems?: WorkflowMediaItem[];
    nextStepId?: string | null;
    targetStepId?: string | null;
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
      variables: normalizeWorkflowVariables(parsed.variables),
      steps: parsed.steps.map((step) => {
        if (step.type === "ask" || step.type === "question" || step.type === "choice") {
          return {
            ...step,
            saveAs: typeof step.saveAs === "string" ? step.saveAs.trim() : "",
            expiresAfterMinutes:
              typeof step.expiresAfterMinutes === "number" && step.expiresAfterMinutes > 0
                ? Math.round(step.expiresAfterMinutes)
                : null,
            onTimeoutStepId: typeof step.onTimeoutStepId === "string" ? step.onTimeoutStepId.trim() : "",
            ...(step.type === "question" || step.type === "choice"
              ? {
                  nextStepId: typeof step.nextStepId === "string" ? step.nextStepId.trim() : "",
                  decisionSource: step.decisionSource === "savedValue" ? "savedValue" : "currentReply",
                  decisionSourceKey: typeof step.decisionSourceKey === "string" ? step.decisionSourceKey.trim() : "",
                  fallbackReply: typeof step.fallbackReply === "string" ? step.fallbackReply : ""
                }
              : {})
          };
        }

        if (step.type === "reply") {
          return {
            ...step,
            mediaItems: normalizeWorkflowMediaItems(step.mediaItems, step.mediaAssetIds)
          };
        }

        if (step.type === "follow_up") {
          return {
            ...step,
            delayMinutes:
              typeof step.delayMinutes === "number" && step.delayMinutes > 0
                ? Math.round(step.delayMinutes)
                : null,
            cancelOnInbound: step.cancelOnInbound !== false,
            cancelOnHumanReply: Boolean(step.cancelOnHumanReply)
          };
        }

        if (step.type === "update") {
          const assignOwnerId = typeof step.assignOwnerId === "string" ? step.assignOwnerId.trim() || null : null;
          return {
            ...step,
            assignmentMode: normalizeWorkflowAssignmentMode(step.assignmentMode ?? (assignOwnerId ? "fixed" : "none")),
            assignOwnerId,
            notifyAssignedOwner: Boolean(step.notifyAssignedOwner),
            notifyAgentIds: normalizeWorkflowRoundRobinAgentIds(step.notifyAgentIds),
            notifyMessage: typeof step.notifyMessage === "string" ? step.notifyMessage : "",
            roundRobinAgentIds: normalizeWorkflowRoundRobinAgentIds(step.roundRobinAgentIds),
            overwriteExistingOwner: Boolean(step.overwriteExistingOwner),
            snoozeAction: normalizeWorkflowSnoozeAction(step.snoozeAction),
            snoozeDurationMinutes:
              typeof step.snoozeDurationMinutes === "number" && step.snoozeDurationMinutes > 0
                ? Math.round(step.snoozeDurationMinutes)
                : null,
            snoozeReason: typeof step.snoozeReason === "string" ? step.snoozeReason : "",
            leadAttributeKey: normalizeWorkflowLeadAttributeKey(step.leadAttributeKey),
            leadAttributeValue: typeof step.leadAttributeValue === "string" ? step.leadAttributeValue : "",
            leadAttributeValueSource: step.leadAttributeValueSource === "savedValue" ? "savedValue" : "literal",
            leadAttributeValueKey: typeof step.leadAttributeValueKey === "string" ? step.leadAttributeValueKey.trim() : "",
            leadCustomAttributeKey: typeof step.leadCustomAttributeKey === "string" ? step.leadCustomAttributeKey.trim() : ""
          };
        }

        if (step.type === "action") {
          return {
            ...step,
            notifyAssignedOwner: Boolean(step.notifyAssignedOwner),
            notifyAgentIds: normalizeWorkflowRoundRobinAgentIds(step.notifyAgentIds),
            notifyMessage: typeof step.notifyMessage === "string" ? step.notifyMessage : "",
            snoozeAction: normalizeWorkflowSnoozeAction(step.snoozeAction),
            snoozeDurationMinutes:
              typeof step.snoozeDurationMinutes === "number" && step.snoozeDurationMinutes > 0
                ? Math.round(step.snoozeDurationMinutes)
                : null,
            snoozeReason: typeof step.snoozeReason === "string" ? step.snoozeReason : ""
          };
        }

        return step;
      })
    };
  } catch {
    return null;
  }
}

function getWorkflowReplyValidationError(value: string) {
  const workflow = parseWorkflowDraft(value);
  if (!workflow) {
    return "Workflow definition is invalid.";
  }

  for (const step of workflow.steps) {
    if (step.type !== "reply" && step.type !== "follow_up") {
      continue;
    }

    const label = step.title?.trim() || step.id;
    const reply = step.reply?.trim() ?? "";
    const mediaItems = step.type === "reply" ? normalizeWorkflowMediaItems(step.mediaItems, step.mediaAssetIds) : [];

    if (!reply && !mediaItems.length) {
      return step.type === "follow_up"
        ? `Follow Up step "${label}" requires follow-up reply text.`
        : `Reply step "${label}" requires reply text or at least one media item.`;
    }
  }

  return null;
}

function getWorkflowUpdateContentInlineError(step: {
  leadAttributeKey?: string | null;
  leadAttributeValue?: string | null;
  leadAttributeValueSource?: "literal" | "savedValue";
  leadAttributeValueKey?: string | null;
  leadCustomAttributeKey?: string | null;
}) {
  const leadAttributeKey = step.leadAttributeKey?.trim() || null;
  if (!leadAttributeKey) {
    return null;
  }

  const leadAttributeValueSource = step.leadAttributeValueSource === "savedValue" ? "savedValue" : "literal";

  if (leadAttributeKey === "custom" && !step.leadCustomAttributeKey?.trim()) {
    return "Custom field key is required.";
  }

  if (leadAttributeValueSource === "savedValue") {
    return step.leadAttributeValueKey?.trim() ? null : "Saved answer key is required.";
  }

  if (!step.leadAttributeValue?.trim()) {
    return "Content field value is required.";
  }

  return validateWorkflowContentAttributeLiteral({
    attributeKey: leadAttributeKey,
    value: step.leadAttributeValue,
    customAttributeKey: step.leadCustomAttributeKey
  });
}

function getWorkflowNotificationInlineError(step: {
  notifyAssignedOwner?: boolean;
  notifyAgentIds?: string[];
  notifyMessage?: string | null;
}) {
  const notifyAgentIds = normalizeWorkflowRoundRobinAgentIds(step.notifyAgentIds);
  if (!step.notifyAssignedOwner && !notifyAgentIds.length) {
    return null;
  }

  return step.notifyMessage?.trim() ? null : "Notification message is required.";
}

function getWorkflowSavedAnswerKeySuggestions(attributeKey: string | null | undefined) {
  switch (attributeKey) {
    case "contact.displayName":
      return ["name", "full_name", "contact_name"];
    case "contact.email":
      return ["email", "email_address"];
    case "contact.tags":
      return ["tags", "interest_tags", "labels"];
    case "contact.addressLine1":
      return ["address", "address_line_1", "street_address"];
    case "contact.addressLine2":
      return ["address_line_2", "unit", "building"];
    case "contact.city":
      return ["city", "area", "location_city"];
    case "contact.state":
      return ["state", "province", "region"];
    case "contact.postalCode":
      return ["postal_code", "postcode", "zip"];
    case "contact.country":
      return ["country", "country_name"];
    case "budget":
    case "value":
      return ["budget", "price_range", "estimated_value"];
    case "priority":
      return ["priority", "lead_priority"];
    case "project":
      return ["project", "property_project"];
    case "preferredArea":
      return ["preferred_area", "area", "location"];
    case "financingStatus":
      return ["financing_status", "loan_status"];
    case "note":
      return ["note", "customer_note"];
    case "sourceDetail":
      return ["source_detail", "campaign_source"];
    case "lostReason":
      return ["lost_reason", "drop_reason"];
    case "custom":
      return ["interest", "occupation", "timeline"];
    default:
      return [] as string[];
  }
}

function getWorkflowReplySaveKeySuggestions(stepType: "ask" | "question" | "choice") {
  switch (stepType) {
    case "ask":
      return [
        "name",
        "phone",
        "email",
        "address_line_1",
        "address_line_2",
        "city",
        "state",
        "postal_code",
        "country",
        "budget",
        "note"
      ];
    case "question":
      return ["answer", "intent", "interest", "preferred_area", "budget", "city", "state", "postal_code"];
    case "choice":
      return ["selected_option", "menu_choice", "intent", "service_type", "property_type", "priority"];
  }
}

function getWorkflowSaveValidationError(value: string) {
  const workflow = parseWorkflowDraft(value);
  if (!workflow) {
    return "Workflow definition is invalid.";
  }

  const stepMap = new Map(workflow.steps.map((step) => [step.id, step] as const));
  if (!workflow.startStepId || !stepMap.has(workflow.startStepId)) {
    return "Choose a valid start step before saving the workflow.";
  }

  if (workflow.startStepId === "workflow-end") {
    return "Add at least one workflow step between Start and End before saving.";
  }

  if (!workflow.steps.some((step) => step.type !== "end")) {
    return "Add at least one workflow step between Start and End before saving.";
  }

  if (stepMap.size !== workflow.steps.length) {
    const seen = new Set<string>();
    for (const step of workflow.steps) {
      if (seen.has(step.id)) {
        return `Workflow step "${step.id}" is duplicated.`;
      }
      seen.add(step.id);
    }
  }

  for (const step of workflow.steps) {
    const targets =
      "branches" in step
        ? [
            ...(step.branches?.map((branch) => branch.nextStepId || "workflow-end") ?? []),
            step.nextStepId || null,
            step.fallbackNextStepId || null,
            step.onTimeoutStepId || null
          ]
        : "targetStepId" in step
          ? [step.targetStepId || null]
          : "nextStepId" in step
            ? [step.nextStepId || null, step.onTimeoutStepId || null]
            : [];

    for (const targetId of targets) {
      if (!targetId) {
        continue;
      }

      if (!stepMap.has(targetId)) {
        return `Step "${step.title || step.id}" points to a missing next step.`;
      }
    }
  }

  const reachableStepIds = new Set<string>();
  const queue = [workflow.startStepId];

  while (queue.length) {
    const stepId = queue.shift();
    if (!stepId || reachableStepIds.has(stepId)) {
      continue;
    }

    reachableStepIds.add(stepId);
    const step = stepMap.get(stepId);
    if (!step) {
      continue;
    }

    const targets =
      "branches" in step
        ? [
            ...(step.branches?.map((branch) => branch.nextStepId || "workflow-end") ?? []),
            step.nextStepId || null,
            step.fallbackNextStepId || null,
            step.onTimeoutStepId || null
          ]
        : "targetStepId" in step
          ? [step.targetStepId || null]
          : "nextStepId" in step
            ? [step.nextStepId || null, step.onTimeoutStepId || null]
            : [];

    for (const targetId of targets) {
      if (targetId) {
        queue.push(targetId);
      }
    }
  }

  for (const step of workflow.steps) {
    if (step.id === "workflow-end" && !reachableStepIds.has(step.id)) {
      continue;
    }

    if (!reachableStepIds.has(step.id)) {
      return `Step "${step.title || step.id}" is not connected to the start path.`;
    }

    if (step.type === "end") {
      continue;
    }

    const label = step.title?.trim() || step.id;

    if ((step.type === "question" || step.type === "choice" || step.type === "ask") && !(step.prompt?.trim())) {
      return `Question step "${label}" needs a prompt before saving.`;
    }

    if (
      (step.type === "question" || step.type === "choice" || step.type === "ask") &&
      step.onTimeoutStepId?.trim() &&
      (!(typeof step.expiresAfterMinutes === "number") || step.expiresAfterMinutes <= 0)
    ) {
      return `Question step "${label}" needs a timeout greater than 0 minutes before using a timeout route.`;
    }

    if ((step.type === "question" || step.type === "choice") && !(step.branches?.length)) {
      return `Question step "${label}" needs at least one branch before saving.`;
    }

    if (step.type === "question" || step.type === "choice") {
      for (const branch of step.branches ?? []) {
        const hasKeywords = (branch.keywords ?? []).some((keyword) => keyword.trim());
        if (!hasKeywords) {
          return `Branch "${branch.label || branch.id}" in "${label}" needs at least one keyword.`;
        }
      }
    }

    if (step.type === "delay" && (!(typeof step.delayMinutes === "number") || step.delayMinutes <= 0)) {
      return `Delay step "${label}" needs a delay greater than 0 minutes.`;
    }

    if (step.type === "follow_up") {
      if (!(typeof step.delayMinutes === "number") || step.delayMinutes <= 0) {
        return `Follow Up step "${label}" needs a delay greater than 0 minutes.`;
      }

      if (!step.reply?.trim()) {
        return `Follow Up step "${label}" needs follow-up reply text before saving.`;
      }
    }

    if (step.type === "go_to") {
      const targetStepId = step.targetStepId?.trim();
      if (!targetStepId) {
        return `Go to step "${label}" needs a valid target step.`;
      }

      if (!stepMap.has(targetStepId)) {
        return `Go to step "${label}" points to a missing target step.`;
      }
    }

    if (step.type === "update") {
      const assignmentMode = normalizeWorkflowAssignmentMode(step.assignmentMode);
      const assignOwnerId = step.assignOwnerId?.trim() || null;
      const notifyAgentIds = normalizeWorkflowRoundRobinAgentIds(step.notifyAgentIds);
      const roundRobinAgentIds = normalizeWorkflowRoundRobinAgentIds(step.roundRobinAgentIds);
      const snoozeAction = normalizeWorkflowSnoozeAction(step.snoozeAction);
      const leadAttributeKey = step.leadAttributeKey?.trim() || null;
      const leadAttributeValueSource = step.leadAttributeValueSource === "savedValue" ? "savedValue" : "literal";

      if (assignmentMode === "fixed" && !assignOwnerId) {
        return `Update step "${label}" needs an assigned agent before saving.`;
      }

      if (assignmentMode === "round_robin" && roundRobinAgentIds.length < 2) {
        return `Update step "${label}" needs at least two agents for round robin.`;
      }

      if ((step.notifyAssignedOwner || notifyAgentIds.length) && !step.notifyMessage?.trim()) {
        return `Update step "${label}" needs a notification message.`;
      }

      if (snoozeAction === "snooze" && (!step.snoozeDurationMinutes || step.snoozeDurationMinutes <= 0)) {
        return `Update step "${label}" needs a snooze duration in minutes.`;
      }

      if (leadAttributeKey) {
        if (leadAttributeKey === "custom" && !step.leadCustomAttributeKey?.trim()) {
          return `Update step "${label}" needs a custom field key.`;
        }

        if (leadAttributeValueSource === "savedValue" && !step.leadAttributeValueKey?.trim()) {
          return `Update step "${label}" needs a saved answer key.`;
        }

        if (leadAttributeValueSource === "literal" && !step.leadAttributeValue?.trim()) {
          return `Update step "${label}" needs a content field value.`;
        }

        if (leadAttributeValueSource === "literal") {
          const validationError = validateWorkflowContentAttributeLiteral({
            attributeKey: leadAttributeKey,
            value: step.leadAttributeValue,
            customAttributeKey: step.leadCustomAttributeKey
          });
          if (validationError) {
            return `Update step "${label}" ${validationError}`;
          }
        }
      }
    }

    if (step.type === "action") {
      const notifyAgentIds = normalizeWorkflowRoundRobinAgentIds(step.notifyAgentIds);
      const snoozeAction = normalizeWorkflowSnoozeAction(step.snoozeAction);
      if ((step.notifyAssignedOwner || notifyAgentIds.length) && !step.notifyMessage?.trim()) {
        return `Action step "${label}" needs a notification message.`;
      }

      if (snoozeAction === "snooze" && (!step.snoozeDurationMinutes || step.snoozeDurationMinutes <= 0)) {
        return `Action step "${label}" needs a snooze duration in minutes.`;
      }
    }
  }

  return getWorkflowReplyValidationError(value);
}

function getWorkflowActivationValidationError(value: string) {
  const saveValidationError = getWorkflowSaveValidationError(value);
  if (saveValidationError) {
    return saveValidationError;
  }

  const workflow = parseWorkflowDraft(value);
  if (!workflow) {
    return "Workflow definition is invalid.";
  }
  const stepMap = new Map(workflow.steps.map((step) => [step.id, step] as const));
  const reachableStepIds = new Set<string>();
  const queue = [workflow.startStepId];
  let reachesEndStep = false;

  while (queue.length) {
    const stepId = queue.shift();
    if (!stepId || reachableStepIds.has(stepId)) {
      continue;
    }

    reachableStepIds.add(stepId);
    const step = stepMap.get(stepId);
    if (!step) {
      continue;
    }

    if (step.type === "end") {
      reachesEndStep = true;
      continue;
    }

    const targets =
      "branches" in step
        ? [
            ...(step.branches?.map((branch) => branch.nextStepId || "workflow-end") ?? []),
            step.nextStepId || null,
            step.fallbackNextStepId || null,
            step.onTimeoutStepId || null
          ]
        : "targetStepId" in step
          ? [step.targetStepId || null]
          : "nextStepId" in step
            ? [step.nextStepId || null, step.onTimeoutStepId || null]
            : [];

    for (const targetId of targets) {
      if (!targetId) {
        continue;
      }

      if (!stepMap.has(targetId)) {
        return `Step "${step.title || step.id}" points to a missing next step.`;
      }

      queue.push(targetId);
    }
  }

  if (!reachesEndStep) {
    return "The active workflow must reach at least one end step from the start path.";
  }

  const reverseAdjacency = new Map<string, string[]>();
  for (const step of workflow.steps) {
    const targets =
      "branches" in step
        ? [
            ...(step.branches?.map((branch) => branch.nextStepId || "workflow-end") ?? []),
            step.nextStepId || null,
            step.fallbackNextStepId || null,
            step.onTimeoutStepId || null
          ]
        : "targetStepId" in step
          ? [step.targetStepId || null]
          : "nextStepId" in step
            ? [step.nextStepId || null, step.onTimeoutStepId || null]
            : [];

    for (const targetId of targets) {
      if (!targetId || !stepMap.has(targetId)) {
        continue;
      }

      const sources = reverseAdjacency.get(targetId) ?? [];
      sources.push(step.id);
      reverseAdjacency.set(targetId, sources);
    }
  }

  const canReachEndStepIds = new Set<string>();
  const endQueue = workflow.steps.filter((step) => step.type === "end").map((step) => step.id);
  while (endQueue.length) {
    const stepId = endQueue.shift();
    if (!stepId || canReachEndStepIds.has(stepId)) {
      continue;
    }

    canReachEndStepIds.add(stepId);
    for (const sourceId of reverseAdjacency.get(stepId) ?? []) {
      endQueue.push(sourceId);
    }
  }

  for (const step of workflow.steps) {
    if (step.id === "workflow-end" && !reachableStepIds.has(step.id)) {
      continue;
    }

    if (!reachableStepIds.has(step.id)) {
      return `Step "${step.title || step.id}" is not connected to the start path.`;
    }

    if (step.type === "end") {
      continue;
    }

    const label = step.title?.trim() || step.id;

    if (!canReachEndStepIds.has(step.id)) {
      return `Step "${label}" does not lead to an end step.`;
    }

    if ((step.type === "question" || step.type === "choice" || step.type === "ask") && !(step.prompt?.trim())) {
      return `Question step "${label}" needs a prompt before activation.`;
    }

    if (
      (step.type === "question" || step.type === "choice" || step.type === "ask") &&
      step.onTimeoutStepId?.trim() &&
      (!(typeof step.expiresAfterMinutes === "number") || step.expiresAfterMinutes <= 0)
    ) {
      return `Question step "${label}" needs a timeout greater than 0 minutes before using a timeout route.`;
    }

    if ((step.type === "question" || step.type === "choice") && !(step.branches?.length)) {
      return `Question step "${label}" needs at least one branch before activation.`;
    }

    if (step.type === "question" || step.type === "choice") {
      for (const branch of step.branches ?? []) {
        const hasKeywords = (branch.keywords ?? []).some((keyword) => keyword.trim());
        if (!hasKeywords) {
          return `Branch "${branch.label || branch.id}" in "${label}" needs at least one keyword.`;
        }
      }
    }

    if (step.type === "delay" && (!(typeof step.delayMinutes === "number") || step.delayMinutes <= 0)) {
      return `Delay step "${label}" needs a delay greater than 0 minutes.`;
    }

    if (step.type === "follow_up") {
      if (!(typeof step.delayMinutes === "number") || step.delayMinutes <= 0) {
        return `Follow Up step "${label}" needs a delay greater than 0 minutes.`;
      }

      if (!step.reply?.trim()) {
        return `Follow Up step "${label}" needs follow-up reply text before activation.`;
      }
    }

    if (step.type === "go_to") {
      const targetStepId = step.targetStepId?.trim();
      if (!targetStepId) {
        return `Go to step "${label}" needs a target step before activation.`;
      }

      if (!stepMap.has(targetStepId)) {
        return `Go to step "${label}" points to a missing target step.`;
      }

      if (!canReachEndStepIds.has(targetStepId)) {
        return `Go to step "${label}" creates a loop or dead-end path without an exit.`;
      }
    }
  }

  return getWorkflowReplyValidationError(value);
}

function getWorkflowWarnings(value: string) {
  const workflow = parseWorkflowDraft(value);
  if (!workflow) {
    return [] as string[];
  }

  const warnings: string[] = [];
  const variableUsage = getWorkflowVariableUsage(workflow);

  for (const step of workflow.steps) {
    if (step.type === "question" || step.type === "choice") {
      if (!step.fallbackReply?.trim()) {
        warnings.push(`Question step "${step.title?.trim() || step.id}" has no fallback reply for unclear answers.`);
      }

      for (const branch of step.branches ?? []) {
        if ((branch.keywords ?? []).length && (branch.keywords ?? []).every((keyword) => keyword.trim() === "*")) {
          warnings.push(`Branch "${branch.label || branch.id}" in "${step.title?.trim() || step.id}" only uses a wildcard match.`);
        }
      }
    }
  }

  if (!workflow.steps.some((step) => step.type === "update")) {
    warnings.push("Workflow does not update tags, owner, lead stage, or content fields anywhere.");
  }

  for (const variable of workflow.variables ?? []) {
    const usage = variableUsage.get(variable.key) ?? null;
    if (!usage || (!usage.usedInUpdate && !usage.usedInDecision && !usage.usedInReply)) {
      warnings.push(`Saved variable "${variable.key}" is not used later in any Update Contact, Saved value decision, or Send Reply placeholder.`);
    }
  }

  const replySteps = workflow.steps.filter((step) => step.type === "reply");
  if (replySteps.length === 1) {
    const stepMap = new Map(workflow.steps.map((step) => [step.id, step] as const));
    const replyStep = replySteps[0];
    const nextStepId = replyStep.nextStepId?.trim();
    if (nextStepId) {
      const nextStep = stepMap.get(nextStepId);
      if (nextStep?.type === "end") {
        warnings.push(`Reply step "${replyStep.title?.trim() || replyStep.id}" ends the workflow immediately after one message.`);
      }
    }
  }

  return Array.from(new Set(warnings));
}

type WorkflowVariableUsage = {
  usedInUpdate: boolean;
  usedInDecision: boolean;
  usedInReply: boolean;
};

function getWorkflowVariableUsage(workflow: WorkflowDraft) {
  const usage = new Map<string, WorkflowVariableUsage>();

  const ensureUsage = (key: string) => {
    const normalizedKey = key.trim();
    if (!normalizedKey) {
      return null;
    }

    const existing = usage.get(normalizedKey);
    if (existing) {
      return existing;
    }

    const next: WorkflowVariableUsage = {
      usedInUpdate: false,
      usedInDecision: false,
      usedInReply: false
    };
    usage.set(normalizedKey, next);
    return next;
  };

  const markReplyTemplateUsage = (value: string | null | undefined) => {
    if (!value) {
      return;
    }

    for (const match of value.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)) {
      const entry = ensureUsage(match[1] ?? "");
      if (entry) {
        entry.usedInReply = true;
      }
    }
  };

  for (const step of workflow.steps) {
    if (step.type === "update" && step.leadAttributeValueSource === "savedValue" && step.leadAttributeValueKey?.trim()) {
      const entry = ensureUsage(step.leadAttributeValueKey);
      if (entry) {
        entry.usedInUpdate = true;
      }
    }

    if ((step.type === "question" || step.type === "choice") && step.decisionSource === "savedValue" && step.decisionSourceKey?.trim()) {
      const entry = ensureUsage(step.decisionSourceKey);
      if (entry) {
        entry.usedInDecision = true;
      }
    }

    if ("reply" in step) {
      markReplyTemplateUsage(step.reply);
    }

    if ((step.type === "update" || step.type === "action") && step.notifyMessage?.trim()) {
      markReplyTemplateUsage(step.notifyMessage);
    }

    if (step.type === "question" || step.type === "choice") {
      markReplyTemplateUsage(step.fallbackReply);
      for (const branch of step.branches ?? []) {
        markReplyTemplateUsage(branch.reply);
      }
    }

    if (step.type === "reply") {
      for (const item of step.mediaItems ?? []) {
        markReplyTemplateUsage(item.message);
      }
    }
  }

  return usage;
}

function normalizeWorkflowMediaItems(mediaItems: unknown, fallbackMediaAssetIds?: unknown): WorkflowMediaItem[] {
  if (Array.isArray(mediaItems)) {
    return mediaItems
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
      .map((item) => ({
        mediaAssetId: typeof item.mediaAssetId === "string" ? item.mediaAssetId.trim() : "",
        message: typeof item.message === "string" ? item.message : ""
      }))
      .filter((item) => item.mediaAssetId);
  }

  if (!Array.isArray(fallbackMediaAssetIds)) {
    return [];
  }

  return fallbackMediaAssetIds
    .filter((item): item is string => typeof item === "string")
    .map((mediaAssetId) => mediaAssetId.trim())
    .filter(Boolean)
    .map((mediaAssetId) => ({
      mediaAssetId,
      message: ""
    }));
}

function normalizeWorkflowAssignmentMode(value: unknown): WorkflowAssignmentMode {
  return value === "round_robin" ? "round_robin" : value === "fixed" ? "fixed" : "none";
}

function normalizeWorkflowSnoozeAction(value: unknown): WorkflowSnoozeAction {
  return value === "snooze" ? "snooze" : value === "unsnooze" ? "unsnooze" : "none";
}

function normalizeWorkflowRoundRobinAgentIds(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as string[];
  }

  return Array.from(
    new Set(value.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean))
  );
}

function normalizeWorkflowLeadAttributeKey(value: unknown) {
  return normalizeWorkflowContentAttributeKey(value);
}

function syncWorkflowMediaItems(currentItems: WorkflowMediaItem[], nextMediaAssetIds: string[]) {
  const currentMap = new Map(currentItems.map((item) => [item.mediaAssetId, item] as const));
  return nextMediaAssetIds.map((mediaAssetId) => {
    const currentItem = currentMap.get(mediaAssetId);
    return {
      mediaAssetId,
      message: currentItem?.message ?? ""
    };
  });
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

function formatAgentRole(role: string) {
  return role
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatWorkflowNodeType(type: WorkflowDraft["steps"][number]["type"]) {
  if (type === "ask") {
    return "Ask For Input";
  }

  return type
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getWorkflowNodeTypeDescription(type: WorkflowDraft["steps"][number]["type"]) {
  switch (type) {
    case "reply":
      return "Sends a message and optional attachments to the contact.";
    case "follow_up":
      return "Waits for a set time, cancels if the contact replies, and sends a follow-up if they stay silent.";
    case "question":
      return "Asks a question and waits for the contact's answer.";
    case "choice":
      return "Presents choices and routes the contact based on matching keywords.";
    case "delay":
      return "Pauses the workflow for a set amount of time before continuing.";
    case "go_to":
      return "Jumps the workflow to another step.";
    case "update":
    case "action":
      return "Applies updates to the lead, assignment, or workflow state.";
    case "end":
      return "Closes the workflow path.";
    case "ask":
      return "Asks for one piece of information and saves the contact's next reply.";
    default:
      return "Configure what this node should do.";
  }
}

function getWorkflowMainActionDescription(type: WorkflowDraft["steps"][number]["type"]) {
  switch (type) {
    case "question":
    case "choice":
      return "Write the prompt the contact will see first.";
    case "reply":
      return "Compose the message, attachments, and emoji sent from this step.";
    case "follow_up":
      return "Set how long to wait and what follow-up message to send if the contact does not reply.";
    case "go_to":
      return "Choose the next step this node should jump to.";
    case "delay":
      return "Set how long the workflow should wait before moving on.";
    default:
      return "Configure the main action for this node.";
  }
}

function getWorkflowReplyDescription(type: WorkflowDraft["steps"][number]["type"]) {
  if (type === "reply") {
    return "Compose the message exactly as it should be sent, including attachments, emoji, and placeholders like {{name}}.";
  }

  if (type === "follow_up") {
    return "Write the delayed follow-up message that sends only if the contact does not reply before the timer ends.";
  }

  return "Define the reply text used by this node.";
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
