"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type LeadSummary = {
  id: string;
  name: string;
  phone: string;
  title: string;
  project: string;
  stage: string;
  pipelineId: string | null;
  pipelineStageKey: string | null;
  stageLabel: string;
  priority: string;
  priorityLabel: string;
  ownerId: string | null;
  ownerName: string | null;
  preferredArea: string | null;
  budget: string | null;
  financingStatus: string | null;
  source: string;
  sourceDetail: string;
  value: number | null;
  currency: string;
  note: string | null;
  nextActionAtIso: string | null;
  nextActionLabel: string;
  lastActivityLabel: string;
  productName: string | null;
  customSummary: string;
  signal: string;
};

type AgentSummary = {
  id: string;
  name: string;
  role: string;
};

type LeadsWorkspaceProps = {
  agents: AgentSummary[];
  leads: LeadSummary[];
};

const STAGE_OPTIONS = [
  { value: "ALL", label: "All stages" },
  { value: "NEW_LEAD", label: "New lead" },
  { value: "CONTACTED", label: "Contacted" },
  { value: "QUALIFIED", label: "Qualified" },
  { value: "FOLLOW_UP", label: "Follow-up" },
  { value: "NEGOTIATION", label: "Negotiation" },
  { value: "CLOSED_WON", label: "Closed won" },
  { value: "CLOSED_LOST", label: "Closed lost" }
];

const PRIORITY_OPTIONS = [
  { value: "LOW", label: "Low" },
  { value: "MEDIUM", label: "Medium" },
  { value: "HIGH", label: "High" },
  { value: "URGENT", label: "Urgent" }
];

export function LeadsWorkspace({ agents, leads }: LeadsWorkspaceProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [stageFilter, setStageFilter] = useState("ALL");
  const [ownerFilter, setOwnerFilter] = useState("ALL");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const filteredLeads = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return leads.filter((lead) => {
      const matchesQuery =
        !normalizedQuery ||
        lead.name.toLowerCase().includes(normalizedQuery) ||
        lead.title.toLowerCase().includes(normalizedQuery) ||
        lead.phone.toLowerCase().includes(normalizedQuery) ||
        (lead.customSummary ?? "").toLowerCase().includes(normalizedQuery);

      const matchesStage = stageFilter === "ALL" || lead.stage === stageFilter;
      const matchesOwner = ownerFilter === "ALL" || (ownerFilter === "UNASSIGNED" ? !lead.ownerId : lead.ownerId === ownerFilter);

      return matchesQuery && matchesStage && matchesOwner;
    });
  }, [leads, ownerFilter, query, stageFilter]);

  const handleQuickUpdate = (
    lead: LeadSummary,
    patch: Partial<Pick<LeadSummary, "ownerId" | "priority" | "stage">>
  ) => {
    setError(null);
    startTransition(async () => {
      const response = await fetch(`/api/leads/${lead.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          ownerId: patch.ownerId !== undefined ? patch.ownerId : lead.ownerId,
          priority: patch.priority ?? lead.priority,
          stage: patch.stage ?? lead.stage
        })
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(payload?.error ?? "Unable to update lead.");
        return;
      }

      router.refresh();
    });
  };

  const unassignedCount = filteredLeads.filter((lead) => !lead.ownerId).length;
  const newLeadCount = filteredLeads.filter((lead) => lead.stage === "NEW_LEAD").length;
  const hasActiveFilters = Boolean(query.trim() || stageFilter !== "ALL" || ownerFilter !== "ALL");

  return (
    <section className="auth-page-stack leads-page">
      <section className="auth-page-hero auth-page-hero-compact leads-hero">
        <div className="auth-page-hero-copy">
          <span className="auth-page-kicker">Pipeline management</span>
          <h1>Leads</h1>
          <p>Qualify, assign, and advance active opportunities from a faster list-first workspace.</p>
          <div className="auth-page-hero-metrics">
            <span className="auth-page-hero-stat">
              <strong>{filteredLeads.length}</strong>
              <small>{filteredLeads.length === 1 ? "visible lead" : "visible leads"}</small>
            </span>
            <span className="auth-page-hero-stat">
              <strong>{newLeadCount}</strong>
              <small>{newLeadCount === 1 ? "New lead" : "New leads"}</small>
            </span>
            <span className="auth-page-hero-stat">
              <strong>{unassignedCount}</strong>
              <small>unassigned</small>
            </span>
          </div>
        </div>
      </section>

      <section className="content-card leads-workspace-card leads-panel">
      <div className="card-header leads-workspace-head">
        <div>
          <h3 className="card-title">Pipeline view</h3>
          <p className="muted">Manage active opportunities directly from the list, then open the full record when needed.</p>
        </div>
      </div>

      <div className="leads-toolbar">
        <input
          aria-label="Search leads"
          className="search-input"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search lead, phone, source, or custom fields..."
          type="search"
          value={query}
        />
        <select aria-label="Filter leads by stage" className="lead-record-input app-select" onChange={(event) => setStageFilter(event.target.value)} value={stageFilter}>
          {STAGE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <select aria-label="Filter leads by owner" className="lead-record-input app-select" onChange={(event) => setOwnerFilter(event.target.value)} value={ownerFilter}>
          <option value="ALL">All owners</option>
          <option value="UNASSIGNED">Unassigned</option>
          {agents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name}
            </option>
          ))}
        </select>
      </div>

      <p className="leads-result-summary">{hasActiveFilters ? `Showing ${filteredLeads.length} filtered active lead${filteredLeads.length === 1 ? "" : "s"}` : `Showing ${filteredLeads.length} active lead${filteredLeads.length === 1 ? "" : "s"}`}</p>

      {error ? <div className="form-error">{error}</div> : null}

      <div className="lead-workspace-list">
        {filteredLeads.length ? (
          filteredLeads.map((lead) => (
            <article className="lead-workspace-row" key={lead.id}>
              <div className="lead-workspace-main">
                <div className="lead-workspace-top">
                  <div>
                    <strong title={lead.name || lead.phone}>{lead.name || lead.phone}</strong>
                    <p className="muted">{lead.name ? lead.phone : "No contact name"}</p>
                  </div>
                </div>
              </div>

              <div className="lead-workspace-activity">
                <strong>{lead.lastActivityLabel || "No activity yet"}</strong>
                <span>Next action: {lead.nextActionLabel || "Not set"}</span>
              </div>

              <div className="lead-workspace-side">
                <label className="contact-assignment-label">
                  <span>Owner</span>
                  <select
                    className="lead-record-input app-select contact-assignment-select"
                    aria-label={`Owner for ${lead.name || lead.phone}`}
                    defaultValue={lead.ownerId ?? ""}
                    disabled={isPending}
                    onChange={(event) =>
                      handleQuickUpdate(lead, { ownerId: event.target.value || null })
                    }
                  >
                    <option value="">Unassigned</option>
                    {agents.map((agent) => (
                      <option key={agent.id} value={agent.id}>
                        {agent.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="contact-assignment-label">
                  <span>Stage</span>
                  <select
                    className="lead-record-input app-select contact-assignment-select"
                    aria-label={`Stage for ${lead.name || lead.phone}`}
                    defaultValue={lead.stage}
                    disabled={isPending}
                    onChange={(event) => handleQuickUpdate(lead, { stage: event.target.value })}
                  >
                    {STAGE_OPTIONS.filter((option) => option.value !== "ALL").map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="contact-assignment-label">
                  <span>Priority</span>
                  <select
                    className="lead-record-input app-select contact-assignment-select"
                    aria-label={`Priority for ${lead.name || lead.phone}`}
                    defaultValue={lead.priority}
                    disabled={isPending}
                    onChange={(event) => handleQuickUpdate(lead, { priority: event.target.value })}
                  >
                    {PRIORITY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <a aria-label={`Open lead record for ${lead.name || lead.phone}`} className="button button-secondary lead-workspace-open" href={`/leads/${lead.id}`}>
                  Open lead record
                </a>
              </div>
            </article>
          ))
        ) : (
          <div className="lead-record-empty">No leads match the current filters.</div>
        )}
      </div>
      </section>
    </section>
  );
}
