type CalendarAppointment = {
  id: string;
  title: string;
  type: string;
  startAt: string;
  endAt: string;
  contactName: string;
  propertyName: string | null;
  location: string | null;
  note: string | null;
  conversationId: string | null;
  leadId: string | null;
};

type CalendarAppointmentsPanelProps = {
  appointments: CalendarAppointment[];
};

export function CalendarAppointmentsPanel({ appointments }: CalendarAppointmentsPanelProps) {
  return (
    <section className="content-card settings-dark-panel">
      <div className="card-header settings-dark-panel-head">
        <div>
          <h3 className="card-title">Scheduled appointments</h3>
          <p className="muted">Customer-facing visits, calls, and meetings linked from inbox conversations.</p>
        </div>
      </div>

      <div className="calendar-appointment-list">
        {appointments.length ? (
          appointments.map((appointment) => (
            <article className="calendar-appointment-card" key={appointment.id}>
              <div className="calendar-appointment-head">
                <div>
                  <strong>{appointment.title}</strong>
                  <p className="muted">{appointment.contactName}</p>
                </div>
                <span className="team-availability-pill scheduled">{appointment.type}</span>
              </div>
              <div className="calendar-appointment-meta">
                <span>{appointment.startAt}</span>
                <span>{appointment.endAt}</span>
                <span>{appointment.propertyName ?? "No linked property"}</span>
                <span>{appointment.location ?? "Location not set"}</span>
              </div>
              {appointment.note ? <p className="calendar-appointment-note">{appointment.note}</p> : null}
              <div className="calendar-appointment-actions">
                {appointment.conversationId ? (
                  <a className="inbox-search-tool" href={`/inbox?conversationId=${appointment.conversationId}`}>
                    Open conversation
                  </a>
                ) : null}
                {appointment.leadId ? (
                  <a className="inbox-search-tool" href={`/leads/${appointment.leadId}`}>
                    Open lead
                  </a>
                ) : null}
              </div>
            </article>
          ))
        ) : (
          <div className="availability-empty-state table-subtle">No upcoming appointments yet.</div>
        )}
      </div>
    </section>
  );
}
