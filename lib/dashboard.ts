import { LeadPriority, LeadSource, LeadStage } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { MALAYSIA_TIME_ZONE } from "@/lib/malaysia-time";
import { requireCurrentWorkspaceId } from "@/lib/auth/current-user";
import { getLeadCustomString, parseLeadCustomData } from "@/lib/lead-custom-fields";

const sourceLabels: Record<LeadSource, string> = {
  WHATSAPP: "WhatsApp",
  META_ADS: "Meta ads",
  WEBSITE: "Website",
  QR_CODE: "QR code",
  REFERRAL: "Referral",
  MANUAL: "Manual",
  IMPORT: "Import",
  MARKETPLACE: "Marketplace",
  OTHER: "Other",
  PROPERTY_PORTAL: "Property portals",
  WEBSITE_CHAT: "Website chat",
  REFERRAL_QR: "Referral QR"
};

const stageLabels: Record<LeadStage, string> = {
  NEW_LEAD: "New lead",
  CONTACTED: "Contacted",
  QUALIFIED: "Qualified",
  FOLLOW_UP: "Follow-up",
  NEGOTIATION: "Negotiation",
  CLOSED_WON: "Closed won",
  CLOSED_LOST: "Closed lost",
  SITE_VISIT_BOOKED: "Site visit booked"
};

const priorityLabels: Record<LeadPriority, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  URGENT: "Urgent"
};

export async function getDashboardData() {
  const workspaceId = await requireCurrentWorkspaceId();
  const workspace = await prisma.workspace.findUnique({
    where: {
      id: workspaceId
    },
    include: {
      agents: {
        orderBy: {
          name: "asc"
        }
      },
      leads: {
        include: {
          contact: true,
          owner: true
        },
        orderBy: {
          lastActivityAt: "desc"
        }
      }
    }
  });

  if (!workspace) {
    throw new Error("No workspace found. Run the database seed first.");
  }

  const leads = workspace.leads;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const newLeadsToday = leads.filter((lead) => lead.createdAt >= today).length;
  const bookedVisits = leads.filter((lead) => lead.stage === LeadStage.SITE_VISIT_BOOKED).length;
  const responseTracked = leads.filter((lead) => typeof lead.responseMinutes === "number");
  const fastResponses = responseTracked.filter((lead) => (lead.responseMinutes ?? 999) <= 5).length;
  const fastResponseRate =
    responseTracked.length === 0 ? 0 : Math.round((fastResponses / responseTracked.length) * 100);
  const overdueFollowUps = leads.filter(
    (lead) => lead.nextActionAt && lead.nextActionAt < new Date() && lead.stage !== LeadStage.CLOSED_WON && lead.stage !== LeadStage.CLOSED_LOST
  ).length;

  const metrics = [
    {
      label: "New leads today",
      value: `${newLeadsToday}`,
      detail: `${leads.length} total leads in workspace`
    },
    {
      label: "Booked site visits",
      value: `${bookedVisits}`,
      detail: "Scheduled visits or appointments from lead workflows"
    },
    {
      label: "Response under 5 min",
      value: `${fastResponseRate}%`,
      detail: `${fastResponses} of ${responseTracked.length} leads answered inside target`
    },
    {
      label: "Next actions overdue",
      value: `${overdueFollowUps}`,
      detail: "Leads that need follow-up attention now"
    }
  ];

  const pipeline = [
    {
      name: "New lead",
      count: leads.filter((lead) => lead.stage === LeadStage.NEW_LEAD).length,
      summary: "Fresh inbound leads that still need qualification or assignment."
    },
    {
      name: "Qualified",
      count: leads.filter((lead) => lead.stage === LeadStage.QUALIFIED).length,
      summary: "Budget, area, and financing status already captured."
    },
    {
      name: "Follow-up risk",
      count: overdueFollowUps,
      summary: "Conversations where the next action is overdue."
    }
  ];

  const totalLeads = leads.length || 1;
  const sourceMix = Object.values(LeadSource).map((source) => {
    const count = leads.filter((lead) => lead.source === source).length;
    return {
      source: sourceLabels[source],
      share: Math.round((count / totalLeads) * 100)
    };
  });

  const hotLeads = [...leads]
    .sort((a, b) => {
      const priorityRank = { URGENT: 4, HIGH: 3, MEDIUM: 2, LOW: 1 } as const;
      const priorityDiff = priorityRank[b.priority] - priorityRank[a.priority];
      if (priorityDiff !== 0) {
        return priorityDiff;
      }

      if (a.nextActionAt && b.nextActionAt) {
        return a.nextActionAt.getTime() - b.nextActionAt.getTime();
      }

      if (a.nextActionAt) {
        return -1;
      }

      if (b.nextActionAt) {
        return 1;
      }

      return b.lastActivityAt.getTime() - a.lastActivityAt.getTime();
    })
    .slice(0, 4)
    .map((lead) => {
      const customData = parseLeadCustomData(lead.customData);
      const preferredArea = getLeadCustomString(customData, "preferredArea") ?? lead.preferredArea;
      const financingStatus = getLeadCustomString(customData, "financingStatus") ?? lead.financingStatus;

      return {
        name: lead.name,
        stage: stageLabels[lead.stage],
        priority: priorityLabels[lead.priority],
        project: getLeadCustomString(customData, "project") ?? lead.project,
        preferredArea: preferredArea ?? "Custom fields not captured",
        financingStatus: financingStatus ?? "Lead details not captured",
        nextActionAt: lead.nextActionAt ? formatUpcomingAction(lead.nextActionAt) : "No next action set",
        sourceDetail: lead.sourceDetail ?? sourceLabels[lead.source],
        signal: lead.note ?? lead.lastMessage ?? "No recent activity logged yet.",
        owner: lead.owner?.name ?? "Unassigned",
        id: lead.id
      };
    });

  const inbox = leads.slice(0, 5).map((lead) => ({
    name: lead.name,
    lastMessage: lead.lastMessage ?? "No message captured yet.",
    channel: sourceLabels[lead.source],
    age: formatRelativeAge(lead.lastActivityAt)
  }));

  const teamBoard = workspace.agents.map((agent) => {
    const ownedLeads = leads.filter((lead) => lead.ownerId === agent.id);
    const trackedResponses = ownedLeads.filter((lead) => typeof lead.responseMinutes === "number");
    const avgResponse =
      trackedResponses.length === 0
        ? null
        : Math.round(
            trackedResponses.reduce((total, lead) => total + (lead.responseMinutes ?? 0), 0) /
              trackedResponses.length
          );

    return {
      agent: agent.name,
      openLeads: ownedLeads.filter(
        (lead) => lead.stage !== LeadStage.CLOSED_WON && lead.stage !== LeadStage.CLOSED_LOST
      ).length,
      bookedVisits: ownedLeads.filter((lead) => lead.stage === LeadStage.SITE_VISIT_BOOKED).length,
      responseTime: avgResponse === null ? "No data" : `${avgResponse} min`
    };
  });

  const timeline = leads.slice(0, 3).map((lead) => ({
    title: `${lead.name} updated`,
    description: lead.note ?? lead.lastMessage ?? `${stageLabels[lead.stage]} stage updated.`,
    time: formatTime(lead.lastActivityAt)
  }));

  return {
    workspaceName: workspace.name,
    metrics,
    pipeline,
    sourceMix,
    hotLeads,
    inbox,
    teamBoard,
    timeline
  };
}

function formatRelativeAge(date: Date) {
  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.max(1, Math.round(diffMs / (1000 * 60)));

  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }

  const diffDays = Math.round(diffHours / 24);
  return `${diffDays}d ago`;
}

function formatTime(date: Date) {
  return new Intl.DateTimeFormat("en-MY", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: MALAYSIA_TIME_ZONE
  }).format(date);
}

function formatUpcomingAction(date: Date) {
  const diffMs = date.getTime() - Date.now();
  const diffMinutes = Math.round(diffMs / (1000 * 60));

  if (diffMinutes < 0) {
    const overdueMinutes = Math.abs(diffMinutes);
    if (overdueMinutes < 60) {
      return `Overdue ${overdueMinutes}m`;
    }

    const overdueHours = Math.round(overdueMinutes / 60);
    return `Overdue ${overdueHours}h`;
  }

  if (diffMinutes < 60) {
    return `Due in ${Math.max(1, diffMinutes)}m`;
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) {
    return `Due in ${diffHours}h`;
  }

  return `Due ${new Intl.DateTimeFormat("en-MY", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: MALAYSIA_TIME_ZONE
  }).format(date)}`;
}
