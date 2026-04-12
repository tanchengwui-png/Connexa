"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Definition, Sequence, Step } from "sequential-workflow-designer";

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
        theme: "dark",
        undoStackSize: 20,
        toolbox: {
          isCollapsed: false,
          labelProvider: (step) => {
            if (step.type === "action") {
              return "Reply + Update";
            }
            if (step.type === "ask") {
              return "Ask + Save Reply";
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
            if (step.type === "action") {
              return "Send a reply, tag the contact, assign an owner, or move the lead stage.";
            }
            if (step.type === "ask") {
              return "Ask a question, wait for the answer, and store it for later steps.";
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
                  type: "ask",
                  name: "Ask + Save Reply",
                  properties: {
                    prompt: "Ask the customer a question.",
                    saveAs: "",
                    nextStepId: ""
                  }
                },
                {
                  componentType: "task",
                  type: "action",
                  name: "Reply + Update",
                  properties: {
                    reply: "",
                    tags: [],
                    leadStage: "",
                    assignOwnerId: ""
                  }
                },
                {
                  componentType: "switch",
                  type: "decision",
                  name: "Yes / No Branch",
                  properties: {
                    prompt: "Ask a yes/no question.",
                    maxRetries: "",
                    fallbackReply: "Please answer yes or no.",
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
                    maxRetries: "",
                    fallbackReply: "Please reply with one of the listed options.",
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
            if (type === "action") {
              return ACTION_ICON;
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
      variables: readWorkflowVariables(parsed.variables)
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
            nextStepId: step.nextStepId ?? ""
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
            maxRetries: step.maxRetries ? `${step.maxRetries}` : "",
            fallbackReply: step.fallbackReply ?? "",
            fallbackNextStepId: step.fallbackNextStepId ?? "",
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
          assignOwnerId: step.assignOwnerId ?? ""
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
        fallbackReply: readString(step.properties.fallbackReply),
        fallbackNextStepId: readNullableString(step.properties.fallbackNextStepId),
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
