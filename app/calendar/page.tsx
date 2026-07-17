import { AvailabilitySettingsCard } from "@/components/availability-settings-card";
import { CalendarAppointmentsPanel } from "@/components/calendar-appointments-panel";
import { DashboardShell } from "@/components/dashboard-shell";
import { MorePageIntro } from "@/components/more-page-intro";
import { getAgentAppointments } from "@/lib/appointments";
import { requireCurrentAgent } from "@/lib/auth/current-user";
import { getAgentAvailability } from "@/lib/availability";

export default async function CalendarPage() {
  const agent = await requireCurrentAgent();
  const [availability, appointments] = await Promise.all([
    getAgentAvailability(agent.id),
    getAgentAppointments(agent.id)
  ]);
  type AgentAppointment = (typeof appointments)[number];
  const calendarAppointments = appointments.map((appointment: AgentAppointment) => ({
    id: appointment.id,
    title: appointment.title,
    type: formatAppointmentType(appointment.type),
    startAtIso: appointment.startAt.toISOString(),
    endAtIso: appointment.endAt.toISOString(),
    startAt: formatAppointmentDateTime(appointment.startAt),
    endAt: formatAppointmentDateTime(appointment.endAt),
    contactName: appointment.contact.displayName,
    propertyName: appointment.product?.name ?? null,
    location: appointment.location ?? appointment.product?.location ?? null,
    note: appointment.note ?? null,
    conversationId: appointment.conversationId,
    leadId: appointment.leadId
  }));

  return (
    <DashboardShell currentPath="/calendar">
      <div className="more-page-stack">
        <MorePageIntro
          badge="Calendar"
          title="Availability, visits, and working windows in one place."
          description="Keep weekly hours, one-off blocks, and customer appointments on the same operational page so managers and agents work from the same schedule."
        />

        <section className="calendar-page-primary">
          <AvailabilitySettingsCard
            agentName={agent.name}
            appointments={calendarAppointments}
            overrides={availability.overrides}
            weeklyRules={availability.weeklyRules}
          />
        </section>

        <section className="calendar-page-secondary">
          <CalendarAppointmentsPanel appointments={calendarAppointments} />
        </section>
      </div>
    </DashboardShell>
  );
}

function formatAppointmentType(type: string) {
  return type
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatAppointmentDateTime(date: Date) {
  return new Intl.DateTimeFormat("en-MY", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Kuala_Lumpur"
  }).format(date);
}
