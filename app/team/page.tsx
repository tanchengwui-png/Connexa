import { DashboardShell } from "@/components/dashboard-shell";
import { InviteForm } from "@/components/invite-form";
import { PendingInvitesCard } from "@/components/pending-invites-card";
import { TeamMembersCard } from "@/components/team-members-card";
import { getDashboardData } from "@/lib/dashboard";
import { getTeamPageData } from "@/lib/team";

export default async function TeamPage() {
  const { teamBoard, timeline } = await getDashboardData();
  const { workspaceName, agents, invites, teamCapacity, availabilitySummary } = await getTeamPageData();

  return (
    <DashboardShell currentPath="/team">
      <section className="hero">
        <div>
          <span className="badge">Team Workspace</span>
          <h2>Managers need ownership visibility more than extra feature depth.</h2>
          <p className="muted">
            Shared inbox software becomes operational only when managers can see owner
            load, overdue conversations, and response health clearly.
          </p>
        </div>
      </section>

      <section className="lower-grid">
        <article className="table-card">
          <div className="card-header">
            <div>
              <h3 className="card-title">Agent board</h3>
              <p className="muted">Response time and conversation load are the first team metrics to expose.</p>
            </div>
          </div>

          <div className="table-head agent-board-head">
            <span>Agent</span>
            <span>Open leads</span>
            <span>Booked visits</span>
            <span>Response time</span>
          </div>

          {teamBoard.map((agent) => (
            <div className="table-row agent-board-row" key={agent.agent}>
              <span className="agent-board-name">{agent.agent}</span>
              <strong>{agent.openLeads}</strong>
              <strong>{agent.bookedVisits}</strong>
              <span>{agent.responseTime}</span>
            </div>
          ))}
        </article>

        <article className="timeline-card">
          <div className="card-header">
            <div>
              <h3 className="card-title">Escalations</h3>
              <p className="muted">The first manager automations should focus on overdue conversations and missed ownership.</p>
            </div>
          </div>

          <div className="timeline-list">
            {timeline.map((item) => (
              <div className="timeline-row" key={item.title}>
                <div className="timeline-topline">
                  <strong>{item.title}</strong>
                  <span className="timeline-time">{item.time}</span>
                </div>
                <div className="table-subtle">{item.description}</div>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="lower-grid">
        <article className="content-card">
          <div className="card-header">
            <div>
              <h3 className="card-title">Today&apos;s availability</h3>
              <p className="muted">Read-only view of each teammate&apos;s working calendar and temporary blocks.</p>
            </div>
          </div>

          <div className="team-availability-list">
            {availabilitySummary.map((item) => (
              <div className="team-availability-row" key={item.agentId}>
                <strong>{item.agentName}</strong>
                <span className={`team-availability-pill ${item.status.tone}`}>{item.status.label}</span>
              </div>
            ))}
          </div>
        </article>

        <article className="content-card">
          <div className="card-header">
            <div>
              <h3 className="card-title">Invite teammates</h3>
              <p className="muted">Send a branded invite email to join {workspaceName}.</p>
            </div>
            <span className="product-catalog-count team-capacity-pill">
              {teamCapacity.memberLimit === null
                ? `${teamCapacity.activeMembers} members`
                : `${teamCapacity.seatsUsed} / ${teamCapacity.memberLimit} seats`}
            </span>
          </div>

          <div className="team-capacity-note">
            <strong>{teamCapacity.planLabel} plan</strong>
            <span>
              {teamCapacity.memberLimit === null
                ? `${teamCapacity.activeMembers} active members, unlimited team seats.`
                : `${teamCapacity.activeMembers} active members and ${teamCapacity.pendingInvites} pending invite${teamCapacity.pendingInvites === 1 ? "" : "s"} reserve ${teamCapacity.seatsUsed} of ${teamCapacity.memberLimit} seats.`}
            </span>
          </div>

          <InviteForm
            capacityLabel={teamCapacity.planLabel}
            disabled={teamCapacity.isAtCapacity}
            memberLimit={teamCapacity.memberLimit}
          />
        </article>

        <PendingInvitesCard invites={invites} />
      </section>

      <TeamMembersCard members={agents} workspaceName={workspaceName} />
    </DashboardShell>
  );
}
