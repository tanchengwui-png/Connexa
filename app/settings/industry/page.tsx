import { DashboardShell } from "@/components/dashboard-shell";
import { IndustrySetupForm } from "@/components/industry-setup-form";
import { requireManager } from "@/lib/auth/current-user";
import { prisma } from "@/lib/prisma";

export default async function IndustrySetupPage() {
  const manager = await requireManager();
  const workspace = await prisma.workspace.findUnique({
    where: {
      id: manager.workspaceId
    },
    select: {
      industryType: true,
      name: true
    }
  });

  if (!workspace) {
    throw new Error("No workspace found. Run the database seed first.");
  }

  return (
    <DashboardShell currentPath="/settings/industry">
      <section className="settings-dark-hero">
        <div className="settings-dark-copy">
          <span className="badge connexa-public-badge">Industry setup</span>
          <h1>Choose the industry profile that should shape the workspace.</h1>
          <p>
            This controls which business context appears beside the inbox and which workflow pack the
            workspace should grow into next.
          </p>
        </div>

        <div className="settings-dark-status">
          <div className="settings-dark-status-card">
            <span>Workspace</span>
            <strong>{workspace.name}</strong>
            <p>Current industry profile: {workspace.industryType.toLowerCase()}</p>
          </div>
        </div>
      </section>

      <section className="settings-dark-grid">
        <article className="content-card settings-dark-panel">
          <div className="card-header settings-dark-panel-head">
            <div>
              <h3 className="card-title">Industry profile</h3>
              <p className="muted">
                Property is fully wired today. Workshop can already be selected so the inbox and settings
                know which vertical context to render next.
              </p>
            </div>
          </div>

          <IndustrySetupForm initialIndustryType={workspace.industryType} />
        </article>

        <article className="content-card settings-dark-panel">
          <div className="card-header settings-dark-panel-head">
            <div>
              <h3 className="card-title">What this changes</h3>
              <p className="muted">The industry profile should affect context, not replace the inbox core.</p>
            </div>
          </div>

          <div className="panel-row">
            <div className="lead-row">
              <strong>Inbox side context</strong>
              <div className="table-subtle">
                The right sidebar can render property lead context today and branch to workshop job context later.
              </div>
            </div>
            <div className="lead-row">
              <strong>Lead setup defaults</strong>
              <div className="table-subtle">
                Pipeline labels, reminders, templates, and dashboard emphasis can be tuned per industry.
              </div>
            </div>
            <div className="lead-row">
              <strong>Shared product core stays intact</strong>
              <div className="table-subtle">
                Conversations, contacts, notes, tags, and automations stay generic while the workflow layer changes.
              </div>
            </div>
          </div>
        </article>
      </section>
    </DashboardShell>
  );
}
