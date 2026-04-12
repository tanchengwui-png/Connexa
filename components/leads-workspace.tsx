"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type LeadSummary = {
  id: string;
  name: string;
  phone: string;
  project: string;
  stage: string;
  stageLabel: string;
  priority: string;
  priorityLabel: string;
  ownerId: string | null;
  ownerName: string | null;
  preferredArea: string | null;
  budget: number | null;
  financingStatus: string | null;
  sourceDetail: string;
  nextActionAtIso: string | null;
  nextActionLabel: string;
  lastActivityLabel: string;
  productName: string | null;
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
  { value: "QUALIFIED", label: "Qualified" },
  { value: "SITE_VISIT_BOOKED", label: "Site visit booked" },
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
        lead.project.toLowerCase().includes(normalizedQuery) ||
        lead.phone.toLowerCase().includes(normalizedQuery) ||
        (lead.preferredArea ?? "").toLowerCase().includes(normalizedQuery);

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
          stage: patch.stage ?? lead.stage,
          project: lead.project
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

  return (
    <section className="content-card leads-workspace-card">
      <div className="card-header leads-workspace-head">
        <div>
          <h3 className="card-title">Lead workspace</h3>
          <p className="muted">Manage active opportunities directly from the list, then open the full record when needed.</p>
        </div>
        <span className="product-catalog-count">
          {filteredLeads.length} {filteredLeads.length === 1 ? "lead" : "leads"}
        </span>
      </div>

      <div className="leads-toolbar">
        <input
          className="search-input"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search lead, phone, project, or area..."
          type="search"
          value={query}
        />
        <select className="lead-record-input app-select" onChange={(event) => setStageFilter(event.target.value)} value={stageFilter}>
          {STAGE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <select className="lead-record-input app-select" onChange={(event) => setOwnerFilter(event.target.value)} value={ownerFilter}>
          <option value="ALL">All owners</option>
          <option value="UNASSIGNED">Unassigned</option>
          {agents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name}
            </option>
          ))}
        </select>
      </div>

      {error ? <div className="form-error">{error}</div> : null}

      <div className="lead-workspace-list">
        {filteredLeads.length ? (
          filteredLeads.map((lead) => (
            <article className="lead-workspace-row" key={lead.id}>
              <div className="lead-workspace-main">
                <div className="lead-workspace-top">
                  <div>
                    <strong>{lead.name}</strong>
                    <p className="muted">{lead.phone}</p>
                  </div>
                  <span className="timeline-time">{lead.lastActivityLabel}</span>
                </div>

                <div className="lead-workspace-project">
                  <span className="lead-chip">{lead.stageLabel}</span>
                  <span className="lead-chip">{lead.priorityLabel}</span>
                  {lead.productName ? <span className="lead-chip">{lead.productName}</span> : null}
                </div>

                <div className="lead-workspace-copy">
                  <strong>{lead.project}</strong>
                  <span>{lead.preferredArea ?? "Area not captured"} • {lead.financingStatus ?? "Financing not captured"}</span>
                  <span>{lead.nextActionLabel} • {lead.sourceDetail}</span>
                  <p>{lead.signal}</p>
                </div>
              </div>

              <div className="lead-workspace-side">
                <label className="contact-assignment-label">
                  <span>Owner</span>
                  <select
                    className="lead-record-input app-select contact-assignment-select"
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

                <a className="button button-secondary lead-workspace-open" href={`/leads/${lead.id}`}>
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
  );
}
