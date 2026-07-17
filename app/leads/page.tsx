import { DashboardShell } from "@/components/dashboard-shell";
import { LeadsWorkspace } from "@/components/leads-workspace";
import { getLeadsWorkspaceData } from "@/lib/leads";

export default async function LeadsPage() {
  const { agents, leads } = await getLeadsWorkspaceData();

  return (
    <DashboardShell currentPath="/leads">
      <LeadsWorkspace agents={agents} leads={leads} />
    </DashboardShell>
  );
}
