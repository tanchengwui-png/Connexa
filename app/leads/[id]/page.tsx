import { notFound } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { LeadRecordForm } from "@/components/lead-record-form";
import { parseLeadCustomData } from "@/lib/lead-custom-fields";
import { getLeadRecord, getLeadsWorkspaceData } from "@/lib/leads";

type LeadRecordPageProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function LeadRecordPage({ params }: LeadRecordPageProps) {
  const { id } = await params;
  const [lead, workspaceData] = await Promise.all([getLeadRecord(id), getLeadsWorkspaceData()]);

  if (!lead) {
    notFound();
  }

  return (
    <DashboardShell currentPath="/leads">
      <section className="hero">
        <div>
          <span className="badge">Lead record</span>
          <h2>Manage the opportunity outside the inbox.</h2>
          <p className="muted">
            Use this record for qualification, source, value, custom fields, and next actions. The
            inbox stays focused on queue handling and fast replies.
          </p>
        </div>
      </section>

      <LeadRecordForm
        agents={workspaceData.agents}
        currentAgent={workspaceData.currentAgent}
        lead={{
          id: lead.id,
          name: lead.name,
          phone: lead.phone,
          source: lead.source,
          sourceDetail: lead.sourceDetail,
          stage: lead.stage,
          pipelineId: lead.pipelineId,
          pipelineStageKey: lead.pipelineStageKey,
          priority: lead.priority,
          value: lead.value,
          currency: lead.currency,
          ownerId: lead.ownerId,
          nextActionAtIso: lead.nextActionAt ? lead.nextActionAt.toISOString() : null,
          nextActionType: lead.nextActionType,
          nextActionNote: lead.nextActionNote,
          owner: lead.owner?.name ?? null,
          note: lead.note,
          lastActivityAtIso: lead.lastActivityAt.toISOString(),
          createdAtIso: lead.createdAt.toISOString(),
          activities: lead.activities.map((activity) => ({
            id: activity.id,
            type: activity.type,
            title: activity.title,
            description: activity.description,
            createdBy: activity.createdBy?.name ?? null,
            createdAtIso: activity.createdAt.toISOString()
          })),
          customData: buildLeadCustomData(lead.customData, {
            project: lead.project,
            preferredArea: lead.preferredArea,
            budget: lead.budget,
            financingStatus: lead.financingStatus,
            siteVisitAt: lead.siteVisitAt ? lead.siteVisitAt.toISOString() : null,
            industryType: lead.industryType
          })
        }}
      />
    </DashboardShell>
  );
}

function buildLeadCustomData(value: string | null, legacy: Record<string, unknown>) {
  const customData = parseLeadCustomData(value);

  for (const [key, entryValue] of Object.entries(legacy)) {
    if (customData[key] === undefined && entryValue !== null && entryValue !== undefined && entryValue !== "") {
      customData[key] = key === "budget" ? String(entryValue) : entryValue;
    }
  }

  return customData;
}
