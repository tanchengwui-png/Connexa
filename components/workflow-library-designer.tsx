"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Definition, Sequence, Step } from "sequential-workflow-designer";
import { normalizeWorkflowContentAttributeKey } from "@/lib/workflow-content-attributes";

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

type WorkflowLibraryDesignerProps = {
  value: string;
  onChange: (value: string) => void;
  onSelectedStepIdChange?: (stepId: string | null) => void;
};

const WORKFLOW_END_ID = "workflow-end";
const ACTION_ICON = buildIconDataUri(`
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">
    <rect x="8" y="12" width="48" height="40" rx="12" fill="#13233b"/>
    <path d="M21 24h22M21 32h14M21 40h18" stroke="#7dd3fc" stroke-width="4" stroke-linecap="round"/>
    <circle cx="46" cy="32" r="7" fill="#22c55e"/>
  </svg>
`);
const REPLY_ICON = buildIconDataUri(`
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">
    <rect x="8" y="12" width="48" height="36" rx="12" fill="#13283f"/>
    <path d="M20 25h24M20 33h18" stroke="#e0f2fe" stroke-width="4" stroke-linecap="round"/>
    <path d="M25 48l8-6h11" stroke="#38bdf8" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
`);
const UPDATE_ICON = buildIconDataUri(`
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">
    <rect x="10" y="10" width="44" height="44" rx="12" fill="#132f2b"/>
    <path d="M21 24h22M21 32h22M21 40h14" stroke="#dcfce7" stroke-width="4" stroke-linecap="round"/>
    <circle cx="44" cy="40" r="6" fill="#22c55e"/>
  </svg>
`);
const ASK_ICON = buildIconDataUri(`
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">
    <rect x="8" y="10" width="48" height="36" rx="12" fill="#0f172a"/>
    <path d="M20 24h24M20 32h16" stroke="#f8fafc" stroke-width="4" stroke-linecap="round"/>
    <path d="M24 46l8-6h12" stroke="#38bdf8" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
`);
const DECISION_ICON = buildIconDataUri(`
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">
    <rect x="16" y="16" width="32" height="32" rx="10" transform="rotate(45 32 32)" fill="#172554"/>
    <path d="M26 32h12M32 26v12" stroke="#bfdbfe" stroke-width="4" stroke-linecap="round"/>
    <circle cx="20" cy="44" r="5" fill="#f59e0b"/>
    <circle cx="44" cy="20" r="5" fill="#22c55e"/>
  </svg>
`);
const CHOICE_ICON = buildIconDataUri(`
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">
    <rect x="10" y="10" width="44" height="44" rx="12" fill="#1f2937"/>
    <path d="M20 22h24M20 32h24M20 42h16" stroke="#f8fafc" stroke-width="4" stroke-linecap="round"/>
    <circle cx="46" cy="42" r="5" fill="#38bdf8"/>
  </svg>
`);
const DELAY_ICON = buildIconDataUri(`
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">
    <rect x="10" y="10" width="44" height="44" rx="12" fill="#162336"/>
    <circle cx="32" cy="32" r="14" stroke="#cbd5e1" stroke-width="4"/>
    <path d="M32 24v9l6 4" stroke="#cbd5e1" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
`);
const FOLLOW_UP_ICON = buildIconDataUri(`
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">
    <rect x="10" y="10" width="44" height="44" rx="12" fill="#10243a"/>
    <path d="M20 24h16M20 32h24" stroke="#e0f2fe" stroke-width="4" stroke-linecap="round"/>
    <circle cx="42" cy="42" r="10" stroke="#7dd3fc" stroke-width="4"/>
    <path d="M42 36v6l4 2" stroke="#7dd3fc" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
`);
const GOTO_ICON = buildIconDataUri(`
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">
    <rect x="10" y="12" width="44" height="40" rx="12" fill="#13283f"/>
    <path d="M20 32h20" stroke="#e0f2fe" stroke-width="4" stroke-linecap="round"/>
    <path d="M34 22l10 10-10 10" stroke="#38bdf8" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
`);

export function WorkflowLibraryDesigner({
  value,
  onChange,
  onSelectedStepIdChange
}: WorkflowLibraryDesignerProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const designerRef = useRef<{
    destroy(): void;
    replaceDefinition(definition: Definition): Promise<void>;
    onDefinitionChanged: { subscribe(listener: (event: { definition: Definition }) => void): void };
    onSelectedStepIdChanged: { subscribe(listener: (stepId: string | null) => void): void };
  } | null>(null);
  const lastSerializedRef = useRef<string>("");
  const draftRef = useRef<WorkflowDraft>(buildDefaultWorkflowDraft());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);

  const parsedDraft = useMemo(() => parseWorkflowDraft(value) ?? buildDefaultWorkflowDraft(), [value]);

  useEffect(() => {
    draftRef.current = parsedDraft;
  }, [parsedDraft]);

  useEffect(() => {
    let isActive = true;

    async function setup() {
      if (!hostRef.current) {
        return;
      }

      const { Designer } = await import("sequential-workflow-designer");
      if (!isActive || !hostRef.current) {
        return;
      }

      const definition = workflowDraftToDefinition(parsedDraft);
      lastSerializedRef.current = JSON.stringify(parsedDraft, null, 2);
      hostRef.current.innerHTML = "";

      const designer = Designer.create(hostRef.current, definition, {
        theme: "light",
        undoStackSize: 20,
        toolbox: {
          isCollapsed: true,
          labelProvider: (step) => {
            if (step.type === "reply") {
              return "Send Reply";
            }
            if (step.type === "update") {
              return "Update Contact";
            }
            if (step.type === "action") {
              return "Reply + Update";
            }
            if (step.type === "delay") {
              return "Delay";
            }
            if (step.type === "follow_up") {
              return "Follow Up";
            }
            if (step.type === "go_to") {
              return "Go To Step";
            }
            if (step.type === "ask") {
              return "Ask for Input";
            }
            if (step.type === "decision") {
              return "Yes / No Branch";
            }
            if (step.type === "choice") {
              return "Numbered Menu";
            }
            return step.name;
          },
          descriptionProvider: (step) => {
            if (step.type === "reply") {
              return "Send a reply and continue to the next step.";
            }
            if (step.type === "update") {
              return "Apply tags, assign an owner, or move the lead stage without sending a message.";
            }
            if (step.type === "action") {
              return "Legacy combined step for sending a reply and updating the contact record.";
            }
            if (step.type === "delay") {
              return "Pause the workflow, then resume automatically after the selected wait time.";
            }
            if (step.type === "follow_up") {
              return "Wait for the selected time, cancel if the contact replies, otherwise send a follow-up message.";
            }
            if (step.type === "go_to") {
              return "Jump to any existing node, including back to the main menu.";
            }
            if (step.type === "ask") {
              return "Ask for one piece of information, wait for the answer, and save it into a workflow variable.";
            }
            if (step.type === "decision") {
              return "Ask a yes/no question and branch the conversation based on the reply.";
            }
            if (step.type === "choice") {
              return "Route options like 1, 2, 3, 4, or 5 into different paths.";
            }
            return "";
          },
          groups: [
            {
              name: "Conversation Building Blocks",
              steps: [
                {
                  componentType: "task",
                  type: "reply",
                  name: "Send Reply",
                  properties: {
                    reply: "",
                    emoji: "",
                    mediaAssetIds: [],
                    mediaItems: [],
                    nextStepId: ""
                  }
                },
                {
                  componentType: "task",
                  type: "ask",
                  name: "Ask for Input",
                  properties: {
                    prompt: "Ask the customer for one detail.",
                    saveAs: "",
                    expiresAfterMinutes: "",
                    onTimeoutStepId: "",
                    nextStepId: ""
                  }
                },
                {
                  componentType: "task",
                  type: "update",
                  name: "Update Contact",
                  properties: {
                    tags: [],
                    leadStage: "",
                    assignOwnerId: "",
                    notifyAssignedOwner: false,
                    notifyAgentIds: [],
                    notifyMessage: "",
                    assignmentMode: "none",
                    roundRobinAgentIds: [],
                    overwriteExistingOwner: false,
                    leadAttributeKey: "",
                    leadAttributeValue: "",
                    leadAttributeValueSource: "literal",
                    leadAttributeValueKey: "",
                    leadCustomAttributeKey: "",
                    nextStepId: ""
                  }
                },
                {
                  componentType: "task",
                  type: "delay",
                  name: "Delay",
                  properties: {
                    delayMinutes: "1440",
                    businessHoursOnly: false,
                    cancelOnInbound: true,
                    cancelOnHumanReply: false,
                    nextStepId: ""
                  }
                },
                {
                  componentType: "task",
                  type: "follow_up",
                  name: "Follow Up",
                  properties: {
                    delayMinutes: "60",
                    reply: "Following up on my last message.",
                    nextStepId: "",
                    cancelOnInbound: true,
                    cancelOnHumanReply: false
                  }
                },
                {
                  componentType: "task",
                  type: "go_to",
                  name: "Go To Step",
                  properties: {
                    targetStepId: ""
                  }
                },
                {
                  componentType: "switch",
                  type: "decision",
                  name: "Yes / No Branch",
                  properties: {
                    prompt: "Ask a yes/no question.",
                    saveAs: "",
                    decisionSource: "currentReply",
                    decisionSourceKey: "",
                    maxRetries: "",
                    expiresAfterMinutes: "",
                    onTimeoutStepId: "",
                    fallbackReply: "Please answer yes or no.",
                    nextStepId: "",
                    yesKeywords: ["yes", "y"],
                    yesReply: "",
                    yesTags: [],
                    noKeywords: ["no", "n"],
                    noReply: "",
                    noTags: []
                  },
                  branches: {
                    yes: [],
                    no: []
                  }
                } as unknown as Step,
                {
                  componentType: "switch",
                  type: "choice",
                  name: "Numbered Menu",
                  properties: {
                    prompt: "Ask the customer to choose 1, 2, 3, 4, or 5.",
                    saveAs: "",
                    decisionSource: "currentReply",
                    decisionSourceKey: "",
                    maxRetries: "",
                    expiresAfterMinutes: "",
                    onTimeoutStepId: "",
                    fallbackReply: "Please reply with one of the listed options.",
                    nextStepId: "",
                    branchDefinitions: [
                      { id: "1", label: "Option 1", keywords: ["1"], reply: "", tags: [] },
                      { id: "2", label: "Option 2", keywords: ["2"], reply: "", tags: [] },
                      { id: "3", label: "Option 3", keywords: ["3"], reply: "", tags: [] }
                    ]
                  },
                  branches: {
                    "1": [],
                    "2": [],
                    "3": []
                  }
                } as unknown as Step
              ]
            }
          ]
        },
        steps: {
          canDeleteStep: (step) => step.id !== WORKFLOW_END_ID,
          canInsertStep: (_step, targetSequence) => targetSequence.length < 5,
          iconUrlProvider: (_componentType, type) => {
            if (type === "reply") {
              return REPLY_ICON;
            }
            if (type === "update") {
              return UPDATE_ICON;
            }
            if (type === "action") {
              return ACTION_ICON;
            }
            if (type === "delay") {
              return DELAY_ICON;
            }
            if (type === "follow_up") {
              return FOLLOW_UP_ICON;
            }
            if (type === "go_to") {
              return GOTO_ICON;
            }
            if (type === "ask") {
              return ASK_ICON;
            }
            if (type === "decision") {
              return DECISION_ICON;
            }
            if (type === "choice") {
              return CHOICE_ICON;
            }
            return null;
          }
        },
        editors: false,
        controlBar: true,
        contextMenu: true
      });

      designer.onDefinitionChanged.subscribe((event) => {
        const nextDraft = definitionToWorkflowDraft(event.definition, draftRef.current);
        const nextSerialized = JSON.stringify(nextDraft, null, 2);
        lastSerializedRef.current = nextSerialized;
        onChange(nextSerialized);
      });

      designer.onSelectedStepIdChanged.subscribe((stepId) => {
        onSelectedStepIdChange?.(stepId === WORKFLOW_END_ID ? null : stepId);
      });

      designerRef.current = designer;
      setLoadError(null);
      setIsReady(true);
    }

    setup().catch((error) => {
      if (!isActive) {
        return;
      }
      setLoadError(error instanceof Error ? error.message : "Unable to load workflow designer.");
      setIsReady(false);
    });

    return () => {
      isActive = false;
      designerRef.current?.destroy();
      designerRef.current = null;
      setIsReady(false);
      if (hostRef.current) {
        hostRef.current.innerHTML = "";
      }
    };
  }, []);

  useEffect(() => {
    const designer = designerRef.current;
    if (!designer) {
      return;
    }

    const normalizedValue = JSON.stringify(parsedDraft, null, 2);
    if (lastSerializedRef.current === normalizedValue) {
      return;
    }

    lastSerializedRef.current = normalizedValue;
    designer.replaceDefinition(workflowDraftToDefinition(parsedDraft)).catch(() => {
      setLoadError("Unable to update workflow designer.");
    });
  }, [parsedDraft]);

  return (
    <div className="workflow-library-shell">
      {loadError ? <div className="form-error">{loadError}</div> : null}
      {!loadError && !isReady ? <div className="workflow-library-loading">Loading workflow designer...</div> : null}
      <div className="workflow-library-designer" ref={hostRef} />
    </div>
  );
}

function buildDefaultWorkflowDraft(): WorkflowDraft {
  return {
    startStepId: WORKFLOW_END_ID,
    variables: [],
    steps: [
      {
        id: WORKFLOW_END_ID,
        type: "end",
        title: "End",
        reply: ""
      }
    ]
  };
}

function parseWorkflowDraft(value: string): WorkflowDraft | null {
  try {
    const parsed = JSON.parse(value) as WorkflowDraft;
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.steps) || typeof parsed.startStepId !== "string") {
      return null;
    }
    return {
      ...parsed,
      variables: readWorkflowVariables(parsed.variables),
      steps: parsed.steps.map((step) => {
        if (step.type === "ask" || step.type === "question" || step.type === "choice") {
          return {
            ...step,
            saveAs: readNullableString(step.saveAs),
            expiresAfterMinutes: readNullableInteger(step.expiresAfterMinutes),
            onTimeoutStepId: readNullableString(step.onTimeoutStepId),
            ...(step.type === "question" || step.type === "choice"
              ? {
                  decisionSource: readDecisionSource(step.decisionSource),
                  decisionSourceKey: readNullableString(step.decisionSourceKey),
                  maxRetries: readNullableInteger(step.maxRetries),
                  fallbackReply: readNullableString(step.fallbackReply),
                  fallbackNextStepId: readNullableString(step.fallbackNextStepId)
                }
              : {})
          };
        }

        if (step.type === "update") {
          return {
            ...step,
            assignmentMode: readWorkflowAssignmentMode(step.assignmentMode ?? (step.assignOwnerId ? "fixed" : "none")),
            roundRobinAgentIds: readStringArray(step.roundRobinAgentIds),
            overwriteExistingOwner: readBoolean(step.overwriteExistingOwner),
            leadAttributeKey: readLeadAttributeKey(step.leadAttributeKey),
            leadAttributeValue: readNullableString(step.leadAttributeValue),
            leadAttributeValueSource: step.leadAttributeValueSource === "savedValue" ? "savedValue" : "literal",
            leadAttributeValueKey: readNullableString(step.leadAttributeValueKey),
            leadCustomAttributeKey: readNullableString(step.leadCustomAttributeKey)
          };
        }

        if (step.type === "follow_up") {
          return {
            ...step,
            delayMinutes: readNullableInteger(step.delayMinutes),
            cancelOnInbound: readBoolean(step.cancelOnInbound, true),
            cancelOnHumanReply: readBoolean(step.cancelOnHumanReply)
          };
        }

        return step;
      })
    };
  } catch {
    return null;
  }
}

function workflowDraftToDefinition(draft: WorkflowDraft): Definition {
  const stepMap = new Map(draft.steps.map((step) => [step.id, step]));

  const buildSequence = (stepId: string | null | undefined): Sequence => {
    if (!stepId || stepId === WORKFLOW_END_ID) {
      return [];
    }

    const step = stepMap.get(stepId);
    if (!step || step.type === "end") {
      return [];
    }

    if (step.type === "ask") {
      return [
        {
          id: step.id,
          componentType: "task",
          type: "ask",
          name: step.title || step.id,
          properties: {
            prompt: step.prompt ?? "",
            saveAs: step.saveAs ?? "",
            expiresAfterMinutes: step.expiresAfterMinutes ? `${step.expiresAfterMinutes}` : "",
            onTimeoutStepId: step.onTimeoutStepId ?? "",
            nextStepId: step.nextStepId ?? ""
          }
        },
        ...buildSequence(step.nextStepId)
      ];
    }

    if (step.type === "delay") {
      return [
        {
          id: step.id,
          componentType: "task",
          type: "delay",
          name: step.title || step.id,
          properties: {
            delayMinutes: step.delayMinutes ? `${step.delayMinutes}` : "60",
            businessHoursOnly: Boolean(step.businessHoursOnly),
            cancelOnInbound: step.cancelOnInbound !== false,
            cancelOnHumanReply: Boolean(step.cancelOnHumanReply),
            nextStepId: step.nextStepId ?? ""
          }
        },
        ...buildSequence(step.nextStepId)
      ];
    }

    if (step.type === "follow_up") {
      return [
        {
          id: step.id,
          componentType: "task",
          type: "follow_up",
          name: step.title || step.id,
          properties: {
            delayMinutes: step.delayMinutes ? `${step.delayMinutes}` : "60",
            reply: step.reply ?? "",
            nextStepId: step.nextStepId ?? "",
            cancelOnInbound: step.cancelOnInbound !== false,
            cancelOnHumanReply: Boolean(step.cancelOnHumanReply)
          }
        },
        ...buildSequence(step.nextStepId)
      ];
    }

    if (step.type === "question" || step.type === "choice") {
      const normalizedBranches = step.type === "question"
        ? [
            step.branches?.find((branch) => branch.id === "yes") ?? step.branches?.[0] ?? { id: "yes", label: "Yes", keywords: ["yes", "y"] },
            step.branches?.find((branch) => branch.id === "no") ?? step.branches?.[1] ?? { id: "no", label: "No", keywords: ["no", "n"] }
          ]
        : step.branches?.length
          ? step.branches
          : [{ id: "1", label: "Option 1", keywords: ["1"] }];

      const branchDefinitions = normalizedBranches.map((branch) => ({
        id: branch.id,
        label: branch.label,
        keywords: branch.keywords ?? [],
        reply: branch.reply ?? "",
        tags: branch.tags ?? []
      }));

      return [
        {
          id: step.id,
          componentType: "switch",
          type: step.type === "choice" ? "choice" : "decision",
          name: step.title || step.id,
          properties: {
            prompt: step.prompt ?? "",
            saveAs: step.saveAs ?? "",
            decisionSource: step.decisionSource ?? "currentReply",
            decisionSourceKey: step.decisionSourceKey ?? "",
            maxRetries: step.maxRetries ? `${step.maxRetries}` : "",
            expiresAfterMinutes: step.expiresAfterMinutes ? `${step.expiresAfterMinutes}` : "",
            onTimeoutStepId: step.onTimeoutStepId ?? "",
            fallbackReply: step.fallbackReply ?? "",
            fallbackNextStepId: step.fallbackNextStepId ?? "",
            nextStepId: step.nextStepId ?? "",
            yesKeywords: normalizedBranches[0]?.keywords ?? ["yes", "y"],
            yesReply: normalizedBranches[0]?.reply ?? "",
            yesTags: normalizedBranches[0]?.tags ?? [],
            noKeywords: normalizedBranches[1]?.keywords ?? ["no", "n"],
            noReply: normalizedBranches[1]?.reply ?? "",
            noTags: normalizedBranches[1]?.tags ?? [],
            branchDefinitions: branchDefinitions
          },
          branches: Object.fromEntries(
            normalizedBranches.map((branch) => [branch.id, buildSequence(branch.nextStepId)])
          )
        } as Step & { branches: Record<string, Sequence> }
        ,
        ...buildSequence(step.nextStepId)
      ];
    }

    if (step.type === "reply") {
      return [
        {
          id: step.id,
          componentType: "task",
          type: "reply",
          name: step.title || step.id,
          properties: {
            reply: step.reply ?? "",
            emoji: step.emoji ?? "",
            mediaAssetIds: step.mediaAssetIds ?? [],
            mediaItems: step.mediaItems ?? [],
            nextStepId: step.nextStepId ?? ""
          }
        },
        ...buildSequence(step.nextStepId)
      ];
    }

    if (step.type === "go_to") {
      return [
        {
          id: step.id,
          componentType: "task",
          type: "go_to",
          name: step.title || step.id,
          properties: {
            targetStepId: step.targetStepId ?? ""
          }
        }
      ];
    }

    if (step.type === "update") {
      return [
        {
          id: step.id,
          componentType: "task",
          type: "update",
          name: step.title || step.id,
          properties: {
            tags: step.tags ?? [],
            leadStage: step.leadStage ?? "",
            assignOwnerId: step.assignOwnerId ?? "",
            notifyAssignedOwner: Boolean(step.notifyAssignedOwner),
            notifyAgentIds: step.notifyAgentIds ?? [],
            notifyMessage: step.notifyMessage ?? "",
            assignmentMode: step.assignmentMode ?? "none",
            roundRobinAgentIds: step.roundRobinAgentIds ?? [],
            overwriteExistingOwner: Boolean(step.overwriteExistingOwner),
            snoozeAction: step.snoozeAction ?? "none",
            snoozeDurationMinutes: step.snoozeDurationMinutes ?? null,
            snoozeReason: step.snoozeReason ?? "",
            leadAttributeKey: step.leadAttributeKey ?? "",
            leadAttributeValue: step.leadAttributeValue ?? "",
            leadAttributeValueSource: step.leadAttributeValueSource ?? "literal",
            leadAttributeValueKey: step.leadAttributeValueKey ?? "",
            leadCustomAttributeKey: step.leadCustomAttributeKey ?? "",
            nextStepId: step.nextStepId ?? ""
          }
        },
        ...buildSequence(step.nextStepId)
      ];
    }

    return [
      {
        id: step.id,
        componentType: "task",
        type: "action",
        name: step.title || step.id,
        properties: {
          reply: step.reply ?? "",
          tags: step.tags ?? [],
          leadStage: step.leadStage ?? "",
          assignOwnerId: step.assignOwnerId ?? "",
          notifyAssignedOwner: Boolean(step.notifyAssignedOwner),
          notifyAgentIds: step.notifyAgentIds ?? [],
          notifyMessage: step.notifyMessage ?? "",
          snoozeAction: step.snoozeAction ?? "none",
          snoozeDurationMinutes: step.snoozeDurationMinutes ?? null,
          snoozeReason: step.snoozeReason ?? "",
          nextStepId: step.nextStepId ?? ""
        }
      },
      ...buildSequence(step.nextStepId)
    ];
  };

  return {
    properties: {
      startStepId: draft.startStepId
    },
    sequence: buildSequence(draft.startStepId)
  };
}

function definitionToWorkflowDraft(definition: Definition, previousDraft?: WorkflowDraft): WorkflowDraft {
  const steps: WorkflowDraft["steps"] = [];

  const walkSequence = (sequence: Sequence, nextStepId: string): string => {
    let tail = nextStepId;
    for (let index = sequence.length - 1; index >= 0; index -= 1) {
      const step = sequence[index];
      tail = convertStep(step, tail);
    }
    return tail;
  };

  const convertStep = (step: Step, nextStepId: string): string => {
    if (step.componentType === "switch") {
      const branches = (step as Step & { branches?: Record<string, Sequence> }).branches ?? {};
      const isChoice = step.type === "choice";
      const branchDefinitions = readBranchDefinitions(step.properties.branchDefinitions, isChoice);
      const nextBranches = branchDefinitions.map((branch) => ({
        id: branch.id,
        label: branch.label,
        keywords: branch.keywords,
        reply: branch.reply,
        nextStepId: walkSequence(branches[branch.id] ?? [], WORKFLOW_END_ID),
        tags: branch.tags
      }));

      steps.push({
        id: step.id,
        type: isChoice ? "choice" : "question",
        title: step.name,
        prompt: readString(step.properties.prompt),
        saveAs: readNullableString(step.properties.saveAs),
        decisionSource: readDecisionSource(step.properties.decisionSource),
        decisionSourceKey: readNullableString(step.properties.decisionSourceKey),
        maxRetries: readNullableInteger(step.properties.maxRetries),
        expiresAfterMinutes: readNullableInteger(step.properties.expiresAfterMinutes),
        onTimeoutStepId: readNullableString(step.properties.onTimeoutStepId),
        fallbackReply: readString(step.properties.fallbackReply),
        fallbackNextStepId: readNullableString(step.properties.fallbackNextStepId),
        nextStepId,
        branches: nextBranches
      });
      return step.id;
    }

    if (step.type === "ask") {
      steps.push({
        id: step.id,
        type: "ask",
        title: step.name,
        prompt: readString(step.properties.prompt),
        saveAs: readNullableString(step.properties.saveAs),
        expiresAfterMinutes: readNullableInteger(step.properties.expiresAfterMinutes),
        onTimeoutStepId: readNullableString(step.properties.onTimeoutStepId),
        nextStepId
      });
      return step.id;
    }

    if (step.type === "delay") {
      steps.push({
        id: step.id,
        type: "delay",
        title: step.name,
        delayMinutes: readNullableInteger(step.properties.delayMinutes),
        businessHoursOnly: readBoolean(step.properties.businessHoursOnly),
        cancelOnInbound: readBoolean(step.properties.cancelOnInbound, true),
        cancelOnHumanReply: readBoolean(step.properties.cancelOnHumanReply),
        nextStepId
      });
      return step.id;
    }

    if (step.type === "follow_up") {
      steps.push({
        id: step.id,
        type: "follow_up",
        title: step.name,
        delayMinutes: readNullableInteger(step.properties.delayMinutes),
        reply: readString(step.properties.reply),
        cancelOnInbound: readBoolean(step.properties.cancelOnInbound, true),
        cancelOnHumanReply: readBoolean(step.properties.cancelOnHumanReply),
        nextStepId
      });
      return step.id;
    }

    if (step.type === "reply") {
      steps.push({
        id: step.id,
        type: "reply",
        title: step.name,
        reply: readString(step.properties.reply),
        emoji: readNullableString(step.properties.emoji),
        mediaAssetIds: readStringArray(step.properties.mediaAssetIds),
        mediaItems: readWorkflowMediaItems(step.properties.mediaItems, step.properties.mediaAssetIds),
        nextStepId
      });
      return step.id;
    }

    if (step.type === "go_to") {
      steps.push({
        id: step.id,
        type: "go_to",
        title: step.name,
        targetStepId: readNullableString(step.properties.targetStepId)
      });
      return step.id;
    }

    if (step.type === "update") {
      steps.push({
        id: step.id,
        type: "update",
        title: step.name,
        tags: readStringArray(step.properties.tags),
        assignOwnerId: readNullableString(step.properties.assignOwnerId),
        notifyAssignedOwner: readBoolean(step.properties.notifyAssignedOwner),
        notifyAgentIds: readStringArray(step.properties.notifyAgentIds),
        notifyMessage: readNullableString(step.properties.notifyMessage),
        assignmentMode: readWorkflowAssignmentMode(step.properties.assignmentMode),
        roundRobinAgentIds: readStringArray(step.properties.roundRobinAgentIds),
        overwriteExistingOwner: readBoolean(step.properties.overwriteExistingOwner),
        snoozeAction: readWorkflowSnoozeAction(step.properties.snoozeAction),
        snoozeDurationMinutes: readNullableNumber(step.properties.snoozeDurationMinutes),
        snoozeReason: readNullableString(step.properties.snoozeReason),
        leadStage: readNullableString(step.properties.leadStage),
        leadAttributeKey: readLeadAttributeKey(step.properties.leadAttributeKey),
        leadAttributeValue: readNullableString(step.properties.leadAttributeValue),
        leadAttributeValueSource: step.properties.leadAttributeValueSource === "savedValue" ? "savedValue" : "literal",
        leadAttributeValueKey: readNullableString(step.properties.leadAttributeValueKey),
        leadCustomAttributeKey: readNullableString(step.properties.leadCustomAttributeKey),
        nextStepId
      });
      return step.id;
    }

    steps.push({
      id: step.id,
      type: "action",
      title: step.name,
      reply: readString(step.properties.reply),
      tags: readStringArray(step.properties.tags),
      assignOwnerId: readNullableString(step.properties.assignOwnerId),
      notifyAssignedOwner: readBoolean(step.properties.notifyAssignedOwner),
      notifyAgentIds: readStringArray(step.properties.notifyAgentIds),
      notifyMessage: readNullableString(step.properties.notifyMessage),
      snoozeAction: readWorkflowSnoozeAction(step.properties.snoozeAction),
      snoozeDurationMinutes: readNullableNumber(step.properties.snoozeDurationMinutes),
      snoozeReason: readNullableString(step.properties.snoozeReason),
      leadStage: readNullableString(step.properties.leadStage),
      nextStepId
    });
    return step.id;
  };

  const startStepId = walkSequence(definition.sequence, WORKFLOW_END_ID);
  steps.push({
    id: WORKFLOW_END_ID,
    type: "end",
    title: "End",
    reply: ""
  });

  return {
    startStepId: startStepId || WORKFLOW_END_ID,
    variables: readWorkflowVariables(previousDraft?.variables),
    steps
  };
}

function readWorkflowVariables(value: unknown): WorkflowVariable[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seenKeys = new Set<string>();
  const variables: WorkflowVariable[] = [];

  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const record = entry as Record<string, unknown>;
    const key = readString(record.key).trim() || readString(record.label).trim();
    if (!key || seenKeys.has(key)) {
      continue;
    }

    seenKeys.add(key);
    variables.push({
      key,
      type: readWorkflowVariableType(record.type),
      description: readNullableString(record.description)
    });
  }

  return variables;
}

function readWorkflowVariableType(value: unknown): WorkflowVariableType {
  return "text";
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function readStringArray(value: unknown, fallback: string[] = []): string[] {
  if (!Array.isArray(value)) {
    return fallback;
  }

  return value.filter((item): item is string => typeof item === "string");
}

function readDecisionSource(value: unknown): "currentReply" | "savedValue" {
  return value === "savedValue" ? "savedValue" : "currentReply";
}

function readNullableInteger(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return Math.round(parsed);
}

function readNullableNumber(value: unknown): number | null {
  return readNullableInteger(value);
}

function readBoolean(value: unknown, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    if (value === "true") {
      return true;
    }
    if (value === "false") {
      return false;
    }
  }

  return fallback;
}

function readWorkflowAssignmentMode(value: unknown): WorkflowAssignmentMode {
  return value === "round_robin" ? "round_robin" : value === "fixed" ? "fixed" : "none";
}

function readWorkflowSnoozeAction(value: unknown): WorkflowSnoozeAction {
  return value === "snooze" ? "snooze" : value === "unsnooze" ? "unsnooze" : "none";
}

function readLeadAttributeKey(value: unknown) {
  return normalizeWorkflowContentAttributeKey(typeof value === "string" ? value : null);
}

function readWorkflowMediaItems(value: unknown, fallbackIds: unknown): WorkflowMediaItem[] {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
      .map((item) => ({
        mediaAssetId: readString(item.mediaAssetId).trim(),
        message: readNullableString(item.message)
      }))
      .filter((item) => item.mediaAssetId);
  }

  return readStringArray(fallbackIds).map((mediaAssetId) => ({
    mediaAssetId,
    message: ""
  }));
}

function readBranchDefinitions(
  value: unknown,
  isChoice: boolean
): Array<{ id: string; label: string; keywords: string[]; reply: string; tags: string[] }> {
  if (Array.isArray(value)) {
    const parsed = value
      .map((item) => {
        if (!item || typeof item !== "object") {
          return null;
        }
        const record = item as Record<string, unknown>;
        const id = typeof record.id === "string" && record.id.trim() ? record.id.trim() : null;
        if (!id) {
          return null;
        }
        return {
          id,
          label: typeof record.label === "string" && record.label.trim() ? record.label.trim() : id,
          keywords: readStringArray(record.keywords, [id]),
          reply: readString(record.reply),
          tags: readStringArray(record.tags)
        };
      })
      .filter((item): item is { id: string; label: string; keywords: string[]; reply: string; tags: string[] } => Boolean(item));
    if (parsed.length) {
      return parsed;
    }
  }

  if (isChoice) {
    return [{ id: "1", label: "Option 1", keywords: ["1"], reply: "", tags: [] }];
  }

  return [
    {
      id: "yes",
      label: "Yes",
      keywords: readStringArray((value as Record<string, unknown> | undefined)?.yesKeywords, ["yes", "y"]),
      reply: "",
      tags: []
    },
    {
      id: "no",
      label: "No",
      keywords: readStringArray((value as Record<string, unknown> | undefined)?.noKeywords, ["no", "n"]),
      reply: "",
      tags: []
    }
  ];
}

function buildIconDataUri(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
