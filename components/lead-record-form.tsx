"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatMalaysiaDateTimeLocalInput, parseMalaysiaDateTimeLocalInput } from "@/lib/malaysia-time";

type AgentSummary = {
  id: string;
  name: string;
};

type LeadActivitySummary = {
  id: string;
  type: string;
  title: string;
  description: string | null;
  createdBy: string | null;
  createdAtIso: string;
};

type LeadRecordFormProps = {
  agents: AgentSummary[];
  currentAgent: AgentSummary;
  lead: {
    id: string;
    name: string;
    phone: string;
    source: string;
    sourceDetail: string | null;
    stage: string;
    pipelineId: string | null;
    pipelineStageKey: string | null;
    priority: string;
    value: number | null;
    currency: string;
    ownerId: string | null;
    owner: string | null;
    nextActionAtIso: string | null;
    nextActionType: string | null;
    nextActionNote: string | null;
    note: string | null;
    lastActivityAtIso: string;
    createdAtIso: string;
    activities: LeadActivitySummary[];
    customData: Record<string, unknown>;
  };
};

const stageOptions = [
  { label: "New lead", value: "NEW_LEAD" },
  { label: "Contacted", value: "CONTACTED" },
  { label: "Qualified", value: "QUALIFIED" },
  { label: "Follow-up", value: "FOLLOW_UP" },
  { label: "Negotiation", value: "NEGOTIATION" },
  { label: "Closed won", value: "CLOSED_WON" },
  { label: "Closed lost", value: "CLOSED_LOST" }
] as const;

const nextActionOptions = [
  { label: "Call customer", value: "CALL_CUSTOMER" },
  { label: "Send quotation", value: "SEND_QUOTATION" },
  { label: "Follow-up", value: "FOLLOW_UP" },
  { label: "Book appointment", value: "BOOK_APPOINTMENT" },
  { label: "Send payment link", value: "SEND_PAYMENT_LINK" },
  { label: "Custom", value: "CUSTOM" }
] as const;

const sourceOptions = [
  { label: "WhatsApp", value: "WHATSAPP" },
  { label: "Meta ads", value: "META_ADS" },
  { label: "Website", value: "WEBSITE" },
  { label: "QR code", value: "QR_CODE" },
  { label: "Referral", value: "REFERRAL" },
  { label: "Manual", value: "MANUAL" },
  { label: "Import", value: "IMPORT" },
  { label: "Marketplace", value: "MARKETPLACE" },
  { label: "Other", value: "OTHER" }
] as const;

const priorityOptions = [
  { label: "Low", value: "LOW" },
  { label: "Medium", value: "MEDIUM" },
  { label: "High", value: "HIGH" },
  { label: "Urgent", value: "URGENT" }
] as const;

export function LeadRecordForm({ agents, currentAgent, lead }: LeadRecordFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: lead.name,
    phone: lead.phone,
    source: normalizeSource(lead.source),
    sourceDetail: lead.sourceDetail ?? "",
    stage: normalizeStage(lead.stage),
    pipelineId: lead.pipelineId ?? "",
    priority: lead.priority,
    value: lead.value === null ? "" : `${lead.value}`,
    currency: lead.currency || "MYR",
    ownerId: lead.ownerId ?? "",
    nextActionType: lead.nextActionType ?? "FOLLOW_UP",
    nextActionAt: formatMalaysiaDateTimeLocalInput(lead.nextActionAtIso),
    nextActionNote: lead.nextActionNote ?? "",
    note: lead.note ?? "",
    customData: stringifyForTextarea(lead.customData)
  });

  const parsedCustomData = useMemo(() => parseJsonObject(form.customData), [form.customData]);
  const heat = computeLeadHeat(lead.lastActivityAtIso, form.priority);
  const owner = agents.find((agent) => agent.id === form.ownerId) ?? null;
  const valueDisplay = form.value.trim() ? formatMoney(Number(form.value), form.currency) : "No value set";
  const timeline = lead.activities.length
    ? lead.activities
    : [
        {
          id: "created",
          type: "LEAD_CREATED",
          title: "Lead created",
          description: "Initial lead record was created.",
          createdBy: null,
          createdAtIso: lead.createdAtIso
        }
      ];

  return (
    <article className="content-card lead-record-page-card">
      <div className="card-header">
        <div>
          <h3 className="card-title">Lead record</h3>
          <p className="muted">Run the next sales move from stage, owner, next action, priority, and value.</p>
        </div>
        <a className="button button-secondary" href="/inbox">
          Back to inbox
        </a>
      </div>

      <div className="lead-record-hero">
        <div>
          <span className={`badge ${heat.className}`}>{heat.label}</span>
          <h2>{lead.name}</h2>
          <p className="muted">{lead.phone}</p>
        </div>
        <div className="lead-record-meta">
          <div className="lead-record-meta-card">
            <span>Owner</span>
            <strong>{owner?.name ?? "Unassigned"}</strong>
          </div>
          <div className="lead-record-meta-card">
            <span>Value</span>
            <strong>{valueDisplay}</strong>
          </div>
        </div>
      </div>

      <section className="lead-record-panel">
        <div className="lead-record-section-head">
          <strong>Sales workflow</strong>
          <span>Primary fields for moving this lead forward.</span>
        </div>

        <div className="lead-record-form-grid">
          <label className="lead-record-field">
            <span>Stage</span>
            <select className="lead-record-input app-select" onChange={(event) => setForm((current) => ({ ...current, stage: event.target.value }))} value={form.stage}>
              {stageOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>

          <label className="lead-record-field">
            <span>Owner</span>
            <select className="lead-record-input app-select" onChange={(event) => setForm((current) => ({ ...current, ownerId: event.target.value }))} value={form.ownerId}>
              <option value="">Unassigned</option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>{agent.name}</option>
              ))}
            </select>
          </label>

          <div className="lead-record-field">
            <span>Assign</span>
            <button className="button button-secondary" onClick={() => setForm((current) => ({ ...current, ownerId: currentAgent.id }))} type="button">
              Assign to me
            </button>
          </div>

          <label className="lead-record-field">
            <span>Priority</span>
            <select className="lead-record-input app-select" onChange={(event) => setForm((current) => ({ ...current, priority: event.target.value }))} value={form.priority}>
              {priorityOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>

          <label className="lead-record-field">
            <span>Estimated deal value</span>
            <input className="lead-record-input" inputMode="numeric" onChange={(event) => setForm((current) => ({ ...current, value: event.target.value }))} placeholder="Estimated deal value" value={form.value} />
          </label>

          <label className="lead-record-field">
            <span>Currency</span>
            <input className="lead-record-input" maxLength={3} onChange={(event) => setForm((current) => ({ ...current, currency: event.target.value.toUpperCase() }))} value={form.currency} />
          </label>

          <label className="lead-record-field">
            <span>Next action type</span>
            <select className="lead-record-input app-select" onChange={(event) => setForm((current) => ({ ...current, nextActionType: event.target.value }))} value={form.nextActionType}>
              {nextActionOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>

          <label className="lead-record-field">
            <span>Next Action</span>
            <input className="lead-record-input" onChange={(event) => setForm((current) => ({ ...current, nextActionAt: event.target.value }))} type="datetime-local" value={form.nextActionAt} />
          </label>

          <label className="lead-record-field lead-record-field-wide">
            <span>Next action note</span>
            <input className="lead-record-input" onChange={(event) => setForm((current) => ({ ...current, nextActionNote: event.target.value }))} placeholder="Optional context for the next action" value={form.nextActionNote} />
          </label>
        </div>
      </section>

      <div className="lead-record-layout">
        <div>
          <section className="lead-record-panel">
            <div className="lead-record-section-head">
              <strong>Lead details</strong>
              <span>Identity and source fields stay available without competing with sales workflow controls.</span>
            </div>

            <div className="lead-record-form-grid">
              <label className="lead-record-field">
                <span>Name</span>
                <input className="lead-record-input" onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} value={form.name} />
              </label>

              <label className="lead-record-field">
                <span>Phone</span>
                <input className="lead-record-input" onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} value={form.phone} />
              </label>

              <label className="lead-record-field">
                <span>Source</span>
                <select className="lead-record-input app-select" onChange={(event) => setForm((current) => ({ ...current, source: event.target.value }))} value={form.source}>
                  {sourceOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>

              <label className="lead-record-field">
                <span>Pipeline ID</span>
                <input className="lead-record-input" onChange={(event) => setForm((current) => ({ ...current, pipelineId: event.target.value }))} placeholder="Default pipeline" value={form.pipelineId} />
              </label>

              <label className="lead-record-field lead-record-field-wide">
                <span>Source detail</span>
                <input
                  className="lead-record-input"
                  onChange={(event) => setForm((current) => ({ ...current, sourceDetail: event.target.value }))}
                  placeholder={form.source === "WHATSAPP" ? "Inbox conversation" : ""}
                  value={form.sourceDetail}
                />
              </label>
            </div>
          </section>

          <section className="lead-record-panel">
            <div className="lead-record-section-head">
              <strong>Notes</strong>
              <span>Internal opportunity context.</span>
            </div>
            <textarea className="lead-record-input lead-record-textarea" onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))} value={form.note} />
          </section>
        </div>

        <aside className="lead-record-panel">
          <div className="lead-record-section-head">
            <strong>Activity Timeline</strong>
            <span>Recent changes on this lead.</span>
          </div>
          <div className="inbox-detail-feed">
            {timeline.map((activity) => (
              <div className="inbox-detail-feed-item" key={activity.id}>
                <div className="inbox-detail-feed-head">
                  <strong>{activity.title}</strong>
                  <span>{formatDateTime(activity.createdAtIso)}</span>
                </div>
                <p>{activity.description ?? formatActivityType(activity.type)}</p>
                {activity.createdBy ? <span className="table-subtle">By {activity.createdBy}</span> : null}
              </div>
            ))}
          </div>
        </aside>
      </div>

      {error ? <div className="form-error">{error}</div> : null}
      {success ? <div className="form-success">{success}</div> : null}

      <div className="lead-record-actions">
        <button className="button button-primary" disabled={isPending} onClick={() => saveLead()} type="button">
          {isPending ? "Saving..." : "Save lead"}
        </button>
      </div>
    </article>
  );

  function saveLead() {
    if (!form.name.trim()) {
      setError("Name is required.");
      return;
    }

    if (!form.phone.trim()) {
      setError("Phone is required.");
      return;
    }

    if (!parsedCustomData.value) {
      setError(parsedCustomData.error ?? "Custom data must be valid JSON.");
      return;
    }

    setError(null);
    setSuccess(null);

    startTransition(async () => {
      const response = await fetch(`/api/leads/${lead.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          name: form.name.trim(),
          phone: form.phone.trim(),
          source: form.source,
          sourceDetail: form.sourceDetail.trim() || (form.source === "WHATSAPP" ? "Inbox conversation" : null),
          stage: form.stage,
          pipelineId: form.pipelineId.trim() || null,
          priority: form.priority,
          value: form.value.trim() ? Number(form.value.trim()) : null,
          currency: form.currency.trim() || "MYR",
          ownerId: form.ownerId || null,
          nextActionType: form.nextActionType || null,
          nextActionAt: form.nextActionAt ? parseMalaysiaDateTimeLocalInput(form.nextActionAt)?.toISOString() ?? null : null,
          nextActionNote: form.nextActionNote.trim() || null,
          note: form.note.trim() || null,
          customData: parsedCustomData.value
        })
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(payload?.error ?? "Unable to save lead.");
        return;
      }

      setSuccess("Lead saved.");
      router.refresh();
    });
  }
}

function stringifyForTextarea(value: Record<string, unknown>) {
  return JSON.stringify(value, null, 2);
}

function parseJsonObject(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { value: null, error: "Custom data must be a JSON object." };
    }
    return { value: parsed as Record<string, unknown>, error: null };
  } catch {
    return { value: null, error: "Custom data must be valid JSON." };
  }
}

function normalizeSource(source: string) {
  const legacyMap: Record<string, string> = {
    PROPERTY_PORTAL: "MARKETPLACE",
    WEBSITE_CHAT: "WHATSAPP",
    REFERRAL_QR: "QR_CODE"
  };
  const normalized = legacyMap[source] ?? source;
  return sourceOptions.some((option) => option.value === normalized) ? normalized : "OTHER";
}

function normalizeStage(stage: string) {
  return stageOptions.some((option) => option.value === stage) ? stage : "FOLLOW_UP";
}

function computeLeadHeat(lastActivityAtIso: string, priority: string) {
  const ageMs = Date.now() - new Date(lastActivityAtIso).getTime();
  const oneDay = 24 * 60 * 60 * 1000;
  const sevenDays = 7 * oneDay;

  if (ageMs <= oneDay && (priority === "HIGH" || priority === "URGENT")) {
    return { label: "Hot lead", className: "hot-badge" };
  }

  if (ageMs <= sevenDays) {
    return { label: "Warm lead", className: "" };
  }

  return { label: "Cold lead", className: "" };
}

function formatMoney(value: number, currency: string) {
  if (!Number.isFinite(value)) {
    return "No value set";
  }

  return new Intl.NumberFormat("en-MY", {
    style: "currency",
    currency: currency || "MYR",
    maximumFractionDigits: 0
  }).format(value);
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-MY", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Kuala_Lumpur"
  }).format(new Date(value));
}

function formatActivityType(type: string) {
  return type
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
