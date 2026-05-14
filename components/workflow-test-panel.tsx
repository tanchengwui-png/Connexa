"use client";

import { useMemo, useState } from "react";

type WorkflowDraft = {
  startStepId: string;
  variables?: Array<{
    key: string;
    type: "text";
    description?: string | null;
  }>;
  steps: Array<{
    id: string;
    type: "ask" | "question" | "choice" | "action" | "delay" | "end";
    title?: string;
    prompt?: string;
    saveAs?: string | null;
    decisionSource?: "currentReply" | "savedValue";
    decisionSourceKey?: string | null;
    maxRetries?: number | null;
    reply?: string;
    tags?: string[];
    assignOwnerId?: string | null;
    leadStage?: string | null;
    delayMinutes?: number | null;
    businessHoursOnly?: boolean;
    cancelOnInbound?: boolean;
    cancelOnHumanReply?: boolean;
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

type WorkflowAskStep = WorkflowDraft["steps"][number] & { type: "ask" };
type WorkflowQuestionStep = WorkflowDraft["steps"][number] & { type: "question" | "choice" };

function isAskStep(step: WorkflowDraft["steps"][number]): step is WorkflowAskStep {
  return step.type === "ask";
}

function isQuestionStep(step: WorkflowDraft["steps"][number]): step is WorkflowQuestionStep {
  return step.type === "question" || step.type === "choice";
}

type WorkflowTestPanelProps = {
  value: string;
};

type TestEntry =
  | { kind: "system"; text: string }
  | { kind: "automation"; text: string; stepId?: string }
  | { kind: "subscriber"; text: string };

const WORKFLOW_END_ID = "workflow-end";

export function WorkflowTestPanel({ value }: WorkflowTestPanelProps) {
  const workflow = useMemo(() => parseWorkflowDraft(value), [value]);
  const [entries, setEntries] = useState<TestEntry[]>([]);
  const [pendingQuestionId, setPendingQuestionId] = useState<string | null>(null);
  const [replyInput, setReplyInput] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [retries, setRetries] = useState<Record<string, number>>({});

  const resetRun = () => {
    setEntries([]);
    setPendingQuestionId(null);
    setReplyInput("");
    setAnswers({});
    setRetries({});
  };

  const runFlow = (
    startStepId?: string | null,
    seededEntries?: TestEntry[],
    seededAnswers?: Record<string, string>,
    seededRetries?: Record<string, number>
  ) => {
    if (!workflow) {
      setEntries([{ kind: "system", text: "Workflow JSON is invalid. Fix it before testing." }]);
      setPendingQuestionId(null);
      return;
    }

    const stepMap = new Map(workflow.steps.map((step) => [step.id, step]));
    const nextEntries = [...(seededEntries ?? [])];
    const nextAnswers = { ...(seededAnswers ?? answers) };
    const nextRetries = { ...(seededRetries ?? retries) };
    let cursor = startStepId ?? workflow.startStepId;
    let safety = 0;

    while (cursor && cursor !== WORKFLOW_END_ID && safety < 30) {
      safety += 1;
      const step = stepMap.get(cursor);
      if (!step) {
        nextEntries.push({ kind: "system", text: `Step ${cursor} is missing.` });
        cursor = WORKFLOW_END_ID;
        break;
      }

      if (step.type === "action") {
        nextEntries.push({
          kind: "automation",
          text: formatActionStep(step),
          stepId: step.id
        });
        cursor = step.nextStepId ?? WORKFLOW_END_ID;
        continue;
      }

      if (step.type === "delay") {
        nextEntries.push({
          kind: "system",
          text: `Delay ${step.delayMinutes ?? 60} minute${(step.delayMinutes ?? 60) === 1 ? "" : "s"}, then continue.`
        });
        cursor = step.nextStepId ?? WORKFLOW_END_ID;
        continue;
      }

      if (isAskStep(step)) {
        nextEntries.push({
          kind: "automation",
          text: step.prompt?.trim() || step.title || "Ask step",
          stepId: step.id
        });
        setEntries(nextEntries);
        setAnswers(nextAnswers);
        setRetries(nextRetries);
        setPendingQuestionId(step.id);
        return;
      }

      if (isQuestionStep(step)) {
        if (step.decisionSource === "savedValue" && step.decisionSourceKey?.trim()) {
          const savedValue = nextAnswers[step.decisionSourceKey.trim()] ?? "";
          const branch = findMatchingBranch(step, savedValue);

          nextEntries.push({
            kind: "system",
            text: savedValue
              ? `Decision checked ${step.decisionSourceKey.trim()} = "${savedValue}".`
              : `Decision checked ${step.decisionSourceKey.trim()}, but no saved value was found.`
          });

          if (branch?.reply?.trim()) {
            nextEntries.push({
              kind: "automation",
              text: branch.reply.trim(),
              stepId: step.id
            });
          } else if (!branch && step.fallbackReply?.trim()) {
            nextEntries.push({
              kind: "automation",
              text: step.fallbackReply.trim(),
              stepId: step.id
            });
          }

          cursor = branch?.nextStepId ?? step.fallbackNextStepId ?? step.id;
          continue;
        }

        nextEntries.push({
          kind: "automation",
          text: step.prompt?.trim() || step.title || "Question step",
          stepId: step.id
        });
        setEntries(nextEntries);
        setAnswers(nextAnswers);
        setRetries(nextRetries);
        setPendingQuestionId(step.id);
        return;
      }

      if (step.type === "end") {
        cursor = WORKFLOW_END_ID;
        break;
      }
    }

    nextEntries.push({ kind: "system", text: "Workflow reached End." });
    setEntries(nextEntries);
    setAnswers(nextAnswers);
    setRetries(nextRetries);
    setPendingQuestionId(null);
  };

  const startRun = () => {
    resetRun();
    runFlow(undefined, [], {}, {});
  };

  const submitReply = (reply: string) => {
    if (!workflow || !pendingQuestionId) {
      return;
    }

    const step = workflow.steps.find(
      (item): item is WorkflowAskStep | WorkflowQuestionStep =>
        item.id === pendingQuestionId && (item.type === "ask" || item.type === "question" || item.type === "choice")
    );
    if (!step) {
      return;
    }

    const normalizedReply = reply.trim();
    if (!normalizedReply) {
      return;
    }

    const nextAnswers = { ...answers };
    const nextRetries = { ...retries };

    if (isAskStep(step)) {
      if (step.saveAs?.trim()) {
        nextAnswers[step.saveAs.trim()] = normalizedReply;
      }
      setReplyInput("");
      runFlow(step.nextStepId ?? WORKFLOW_END_ID, [...entries, { kind: "subscriber", text: normalizedReply }], nextAnswers, nextRetries);
      return;
    }

    const branch = findMatchingBranch(step, normalizedReply);

    const nextEntries: TestEntry[] = [...entries, { kind: "subscriber", text: normalizedReply }];

    if (branch?.reply?.trim()) {
      nextEntries.push({
        kind: "automation",
        text: branch.reply.trim(),
        stepId: step.id
      });
    } else if (!branch && step.fallbackReply?.trim()) {
      nextRetries[step.id] = (nextRetries[step.id] ?? 0) + 1;
      nextEntries.push({
        kind: "automation",
        text: step.fallbackReply.trim(),
        stepId: step.id
      });
      if (step.maxRetries && nextRetries[step.id] >= step.maxRetries) {
        nextEntries.push({
          kind: "system",
          text: `Maximum retries reached for ${step.title || step.id}. Workflow ended.`
        });
        setReplyInput("");
        setEntries(nextEntries);
        setAnswers(nextAnswers);
        setRetries(nextRetries);
        setPendingQuestionId(null);
        return;
      }
    } else if (branch) {
      nextRetries[step.id] = 0;
    }

    setReplyInput("");
    runFlow(branch?.nextStepId ?? step.fallbackNextStepId ?? step.id, nextEntries, nextAnswers, nextRetries);
  };

  return (
    <section className="lead-record-panel workflow-test-panel">
      <div className="lead-record-section-head">
        <strong>Workflow Test</strong>
        <span>Run the current workflow as a subscriber test without sending any real messages.</span>
      </div>

      <div className="workflow-test-toolbar">
        <button className="button button-primary compact-button" onClick={startRun} type="button">
          Run
        </button>
        <button className="button button-secondary compact-button" onClick={resetRun} type="button">
          Reset
        </button>
      </div>

      <div className="workflow-test-log">
        {entries.length ? (
          entries.map((entry, index) => (
            <div className={`workflow-test-entry ${entry.kind}`} key={`${entry.kind}-${index}`}>
              <span className="workflow-test-entry-role">
                {entry.kind === "automation" ? "Workflow" : entry.kind === "subscriber" ? "Subscriber" : "System"}
              </span>
              <p>{entry.text}</p>
            </div>
          ))
        ) : (
          <div className="workflow-test-empty">Click `Run` to test the current workflow.</div>
        )}
      </div>

      {Object.keys(answers).length ? (
        <div className="workflow-test-entry system">
          <span className="workflow-test-entry-role">State</span>
          <p>
            {Object.entries(answers)
              .map(([key, entryValue]) => `${key}: ${entryValue}`)
              .join(" · ")}
          </p>
        </div>
      ) : null}

      <div className="workflow-test-composer">
        <input
          className="lead-record-input"
          onChange={(event) => setReplyInput(event.target.value)}
          placeholder={pendingQuestionId ? "Type subscriber reply..." : "Run the workflow to enable replies"}
          value={replyInput}
        />
        <button
          className="button button-secondary compact-button"
          disabled={!pendingQuestionId || !replyInput.trim()}
          onClick={() => submitReply(replyInput)}
          type="button"
        >
          Send reply
        </button>
        <button
          className="button button-secondary compact-button"
          disabled={!pendingQuestionId}
          onClick={() => submitReply("yes")}
          type="button"
        >
          Yes
        </button>
        <button
          className="button button-secondary compact-button"
          disabled={!pendingQuestionId}
          onClick={() => submitReply("no")}
          type="button"
        >
          No
        </button>
      </div>
    </section>
  );
}

function parseWorkflowDraft(value: string): WorkflowDraft | null {
  try {
    const parsed = JSON.parse(value) as WorkflowDraft;
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.steps) || typeof parsed.startStepId !== "string") {
      return null;
    }
    return {
      ...parsed,
      variables: Array.isArray(parsed.variables) ? parsed.variables : []
    };
  } catch {
    return null;
  }
}

function formatActionStep(step: WorkflowDraft["steps"][number]): string {
  const parts = [step.title || step.id];
  if (step.reply?.trim()) {
    parts.push(`Reply: ${step.reply.trim()}`);
  }
  if (step.tags?.length) {
    parts.push(`Tags: ${step.tags.join(", ")}`);
  }
  if (step.leadStage) {
    parts.push(`Stage: ${step.leadStage}`);
  }
  return parts.join(" · ");
}

function findMatchingBranch(step: WorkflowQuestionStep, value: string) {
  const normalizedValue = value.trim().toLowerCase();
  return (
    step.branches?.find((item) =>
      item.keywords.some((keyword) => keyword.trim() && normalizedValue.includes(keyword.trim().toLowerCase()))
    ) ?? null
  );
}
