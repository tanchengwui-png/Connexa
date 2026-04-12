import { AvailabilitySettingsCard } from "@/components/availability-settings-card";
import { CalendarAppointmentsPanel } from "@/components/calendar-appointments-panel";
import { DashboardShell } from "@/components/dashboard-shell";
import { getAgentAppointments } from "@/lib/appointments";
import { requireCurrentAgent } from "@/lib/auth/current-user";
import { getAgentAvailability } from "@/lib/availability";

export default async function CalendarPage() {
  const agent = await requireCurrentAgent();
  const [availability, appointments] = await Promise.all([
    getAgentAvailability(agent.id),
    getAgentAppointments(agent.id)
  ]);
  const calendarAppointments = appointments.map((appointment) => ({
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
      <section className="settings-dark-hero">
        <div className="settings-dark-copy">
          <span className="badge connexa-public-badge">Team calendar</span>
          <h1>Availability needs its own operational surface.</h1>
          <p>
            Keep weekly working hours, leave blocks, and temporary availability in one dedicated calendar page so
            schedules stay visible before assignment decisions happen.
          </p>
        </div>

        <div className="settings-dark-status">
          <div className="settings-dark-status-card">
            <span>Your schedule</span>
            <strong>{agent.name}</strong>
            <p>Maintain your own working calendar here, while managers keep a read-only view from the Team page.</p>
          </div>
        </div>
      </section>

      <AvailabilitySettingsCard
        agentName={agent.name}
        appointments={calendarAppointments}
        overrides={availability.overrides}
        weeklyRules={availability.weeklyRules}
      />

      <CalendarAppointmentsPanel appointments={calendarAppointments} />
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
    hour12: false
  }).format(date);
}
