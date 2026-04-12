"use client";

import { AvailabilityOverrideType } from "@prisma/client";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AVAILABILITY_OVERRIDE_OPTIONS } from "@/lib/availability-constants";
import { INBOX_LAYERS } from "@/components/inbox/layers";
import { useToast } from "@/components/toast-provider";

type WeeklyRule = {
  dayOfWeek: number;
  label: string;
  enabled: boolean;
  startTime: string;
  endTime: string;
};

type AvailabilityOverride = {
  id: string;
  type: AvailabilityOverrideType;
  label: string;
  startAtIso: string;
  endAtIso: string;
  startAtLabel: string;
  endAtLabel: string;
  note: string;
};

type AvailabilitySettingsCardProps = {
  agentName: string;
  appointments: CalendarAppointment[];
  weeklyRules: WeeklyRule[];
  overrides: AvailabilityOverride[];
};

type CalendarAppointment = {
  id: string;
  title: string;
  type: string;
  startAtIso: string;
  endAtIso: string;
  startAt: string;
  endAt: string;
  contactName: string;
  propertyName: string | null;
  location: string | null;
  note: string | null;
  conversationId: string | null;
  leadId: string | null;
};

type DraftOverride = {
  id: string;
  type: AvailabilityOverrideType;
  startAt: string;
  endAt: string;
  note: string;
};

type QuickAddDraft = Omit<DraftOverride, "id">;

const CALENDAR_WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function AvailabilitySettingsCard({
  agentName,
  appointments,
  weeklyRules,
  overrides
}: AvailabilitySettingsCardProps) {
  const router = useRouter();
  const { success } = useToast();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isMounted, setIsMounted] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => startOfMonth(new Date()));
  const [selectedDay, setSelectedDay] = useState(() => startOfDay(new Date()));
  const [quickAddDraft, setQuickAddDraft] = useState<QuickAddDraft | null>(null);
  const [editDraft, setEditDraft] = useState<DraftOverride | null>(null);
  const [ruleDrafts, setRuleDrafts] = useState(weeklyRules);
  const [overrideDrafts, setOverrideDrafts] = useState<DraftOverride[]>(
    overrides.map((override) => ({
      id: override.id,
      type: override.type,
      startAt: toLocalDateTimeValue(override.startAtIso),
      endAt: toLocalDateTimeValue(override.endAtIso),
      note: override.note
    }))
  );

  const hasRulesEnabled = useMemo(() => ruleDrafts.some((rule) => rule.enabled), [ruleDrafts]);
  const calendarDays = useMemo(
    () => buildCalendarDays(calendarMonth, ruleDrafts, overrideDrafts, appointments, selectedDay),
    [appointments, calendarMonth, overrideDrafts, ruleDrafts, selectedDay]
  );
  const selectedDaySchedule = useMemo(
    () => buildDaySchedule(selectedDay, ruleDrafts, overrideDrafts, appointments),
    [appointments, overrideDrafts, ruleDrafts, selectedDay]
  );
  const selectedDayTimeSlots = useMemo(() => buildTimeSlots(selectedDay), [selectedDay]);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (!editDraft) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setEditDraft(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [editDraft]);

  const updateRule = (dayOfWeek: number, patch: Partial<WeeklyRule>) => {
    setRuleDrafts((current) =>
      current.map((rule) => (rule.dayOfWeek === dayOfWeek ? { ...rule, ...patch } : rule))
    );
  };

  const updateOverride = (id: string, patch: Partial<DraftOverride>) => {
    setOverrideDrafts((current) => current.map((override) => (override.id === id ? { ...override, ...patch } : override)));
  };

  const removeOverride = (id: string) => {
    setOverrideDrafts((current) => current.filter((override) => override.id !== id));
  };

  const openEditOverride = (overrideId: string) => {
    const override = overrideDrafts.find((item) => item.id === overrideId);
    if (!override) {
      return;
    }

    setEditDraft({ ...override });
  };

  const openQuickAdd = (seedDate?: Date) => {
    const seed = seedDate ? new Date(seedDate) : new Date();
    seed.setMinutes(0, 0, 0);
    if (seedDate) {
      seed.setHours(9, 0, 0, 0);
    }
    const end = new Date(seed.getTime() + 60 * 60 * 1000);

    setQuickAddDraft({
      type: AvailabilityOverrideType.BLOCKED,
      startAt: toLocalDateTimeValue(seed.toISOString()),
      endAt: toLocalDateTimeValue(end.toISOString()),
      note: ""
    });
  };

  const commitQuickAdd = () => {
    if (!quickAddDraft) {
      return;
    }

    setOverrideDrafts((current) => [
      ...current,
      {
        id: `new-${Date.now()}`,
        ...quickAddDraft
      }
    ]);
    setQuickAddDraft(null);
  };

  const commitEditOverride = () => {
    if (!editDraft) {
      return;
    }

    updateOverride(editDraft.id, {
      type: editDraft.type,
      startAt: editDraft.startAt,
      endAt: editDraft.endAt,
      note: editDraft.note
    });
    setEditDraft(null);
  };

  const deleteEditOverride = () => {
    if (!editDraft) {
      return;
    }

    removeOverride(editDraft.id);
    setEditDraft(null);
  };

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const response = await fetch("/api/settings/availability", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        weeklyRules: ruleDrafts.map((rule) => ({
          dayOfWeek: rule.dayOfWeek,
          enabled: rule.enabled,
          startTime: rule.startTime,
          endTime: rule.endTime
        })),
        overrides: overrideDrafts.map((override) => ({
          type: override.type,
          startAt: new Date(override.startAt).toISOString(),
          endAt: new Date(override.endAt).toISOString(),
          note: override.note
        }))
      })
    });

    const payload = (await response.json().catch(() => null)) as { error?: string } | null;

    if (!response.ok) {
      setError(payload?.error ?? "Unable to save availability.");
      setPending(false);
      return;
    }

    success("Availability saved", "Your working schedule and override blocks have been updated.");
    router.refresh();
    setPending(false);
  }

  return (
    <article className="content-card settings-dark-panel availability-settings-card">
      <div className="card-header settings-dark-panel-head">
        <div>
          <h3 className="card-title">My availability</h3>
          <p className="muted">
            Set your weekly working hours and add one-off blocked periods for leave, site visits, or temporary availability.
          </p>
        </div>
        <span className="product-catalog-count availability-settings-pill">
          {hasRulesEnabled ? agentName : "Schedule not set"}
        </span>
      </div>

      <form className="availability-settings-form" onSubmit={handleSubmit}>
        <section className="availability-settings-section">
          <div className="availability-settings-section-head availability-settings-section-head-actions">
            <div>
              <strong>Availability calendar</strong>
              <span className="table-subtle">
                See your default weekly schedule and one-off overrides on a monthly calendar.
              </span>
            </div>
            <div className="availability-calendar-nav">
              <button className="inbox-search-tool" onClick={() => openQuickAdd()} type="button">
                Add block
              </button>
              <button
                className="inbox-search-tool"
                onClick={() => setCalendarMonth((current) => addMonths(current, -1))}
                type="button"
              >
                Prev
              </button>
              <strong>{formatMonthLabel(calendarMonth)}</strong>
              <button
                className="inbox-search-tool"
                onClick={() => setCalendarMonth((current) => addMonths(current, 1))}
                type="button"
              >
                Next
              </button>
            </div>
          </div>

          {quickAddDraft ? (
            <div className="availability-quick-add">
              <div className="availability-quick-add-grid">
                <label className="contact-assignment-label">
                  <span>Type</span>
                  <select
                    className="lead-record-input app-select"
                    disabled={pending}
                    onChange={(event) =>
                      setQuickAddDraft((current) =>
                        current ? { ...current, type: event.target.value as AvailabilityOverrideType } : current
                      )
                    }
                    value={quickAddDraft.type}
                  >
                    {AVAILABILITY_OVERRIDE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="contact-assignment-label">
                  <span>Start</span>
                  <input
                    className="lead-record-input"
                    disabled={pending}
                    onChange={(event) =>
                      setQuickAddDraft((current) =>
                        current ? { ...current, startAt: event.target.value } : current
                      )
                    }
                    type="datetime-local"
                    value={quickAddDraft.startAt}
                  />
                </label>

                <label className="contact-assignment-label">
                  <span>End</span>
                  <input
                    className="lead-record-input"
                    disabled={pending}
                    onChange={(event) =>
                      setQuickAddDraft((current) =>
                        current ? { ...current, endAt: event.target.value } : current
                      )
                    }
                    type="datetime-local"
                    value={quickAddDraft.endAt}
                  />
                </label>
              </div>

              <div className="availability-quick-add-actions">
                <label className="control-block availability-override-note">
                  <span className="control-label">Note</span>
                  <input
                    className="control-input"
                    disabled={pending}
                    onChange={(event) =>
                      setQuickAddDraft((current) =>
                        current ? { ...current, note: event.target.value } : current
                      )
                    }
                    placeholder="Optional note for managers"
                    type="text"
                    value={quickAddDraft.note}
                  />
                </label>
                <div className="availability-quick-add-buttons">
                  <button
                    className="inbox-search-tool"
                    disabled={pending}
                    onClick={() => setQuickAddDraft(null)}
                    type="button"
                  >
                    Cancel
                  </button>
                  <button
                    className="button button-primary"
                    disabled={pending}
                    onClick={commitQuickAdd}
                    type="button"
                  >
                    Add to calendar
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          <div className="availability-calendar-shell">
            <div className="availability-calendar">
              {CALENDAR_WEEKDAY_LABELS.map((label) => (
                <div className="availability-calendar-weekday" key={label}>
                  {label}
                </div>
              ))}

              {calendarDays.map((day) => (
                <div
                  className={`availability-calendar-day${day.isCurrentMonth ? "" : " muted-day"}${day.isToday ? " today" : ""}${day.isSelected ? " selected" : ""}`}
                  key={day.key}
                  onClick={() => setSelectedDay(startOfDay(day.date))}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelectedDay(startOfDay(day.date));
                    }
                  }}
                >
                  <div className="availability-calendar-day-top">
                    <strong>{day.date.getDate()}</strong>
                    <button
                      className="availability-calendar-add"
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelectedDay(startOfDay(day.date));
                        openQuickAdd(day.date);
                      }}
                      type="button"
                    >
                      Add
                    </button>
                  </div>

                  <div className="availability-calendar-body">
                    <span className={`availability-calendar-default ${day.defaultTone}`}>
                      {day.defaultLabel}
                    </span>

                    {day.appointmentCount ? (
                      <span className="availability-calendar-appointment-count">
                        {day.appointmentCount} appointment{day.appointmentCount > 1 ? "s" : ""}
                      </span>
                    ) : null}

                    {day.overrides.map((override) => (
                      <button
                        className={`availability-calendar-override availability-calendar-override-button ${override.tone}`}
                        key={override.id}
                        onClick={(event) => {
                          event.stopPropagation();
                          openEditOverride(override.id);
                        }}
                        type="button"
                      >
                        <strong>{override.label}</strong>
                        <span>{override.timeLabel}</span>
                        {override.note ? <p>{override.note}</p> : null}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <aside className="availability-day-panel">
              <div className="availability-day-panel-head">
                <div>
                  <strong>{formatDayPanelLabel(selectedDay)}</strong>
                  <span className="table-subtle">
                    Default hours: {selectedDaySchedule.defaultLabel}
                  </span>
                </div>
                <button
                  className="inbox-search-tool"
                  onClick={() => openQuickAdd(selectedDay)}
                  type="button"
                >
                  Add block
                </button>
              </div>

              <div className="availability-day-summary">
                <div className="availability-day-summary-card">
                  <span>Appointments</span>
                  <strong>{selectedDaySchedule.appointmentCount}</strong>
                </div>
                <div className="availability-day-summary-card">
                  <span>Blocks</span>
                  <strong>{selectedDaySchedule.overrideCount}</strong>
                </div>
              </div>

              <div className="availability-day-slot-panel">
                <div className="availability-day-slot-head">
                  <strong>Time selection</strong>
                  <span className="table-subtle">Pick a start time to prefill a new block for this day.</span>
                </div>
                <div className="availability-day-slot-grid">
                  {selectedDayTimeSlots.map((slot) => (
                    <button
                      className="availability-day-slot-button"
                      key={slot.label}
                      onClick={() => openQuickAdd(slot.date)}
                      type="button"
                    >
                      {slot.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="availability-day-timeline">
                {selectedDaySchedule.items.length ? (
                  selectedDaySchedule.items.map((item) =>
                    item.kind === "override" ? (
                      <button
                        className={`availability-day-item availability-day-item-button ${item.tone}`}
                        key={item.key}
                        onClick={() => openEditOverride(item.id)}
                        type="button"
                      >
                        <div className="availability-day-item-head">
                          <strong>{item.title}</strong>
                          <span>{item.timeLabel}</span>
                        </div>
                        {item.note ? <p>{item.note}</p> : null}
                      </button>
                    ) : (
                      <article className="availability-day-item appointment" key={item.key}>
                        <div className="availability-day-item-head">
                          <strong>{item.title}</strong>
                          <span>{item.timeLabel}</span>
                        </div>
                        <span className="availability-day-item-meta">
                          {item.type} with {item.contactName}
                        </span>
                        {item.propertyName ? (
                          <span className="availability-day-item-meta">{item.propertyName}</span>
                        ) : null}
                        {item.location ? (
                          <span className="availability-day-item-meta">{item.location}</span>
                        ) : null}
                        {item.note ? <p>{item.note}</p> : null}
                        {item.conversationId || item.leadId ? (
                          <div className="availability-day-item-actions">
                            {item.conversationId ? (
                              <a className="inbox-search-tool" href={`/inbox?conversationId=${item.conversationId}`}>
                                Open conversation
                              </a>
                            ) : null}
                            {item.leadId ? (
                              <a className="inbox-search-tool" href={`/leads/${item.leadId}`}>
                                Open lead
                              </a>
                            ) : null}
                          </div>
                        ) : null}
                      </article>
                    )
                  )
                ) : (
                  <div className="availability-empty-state table-subtle">
                    No blocked time or appointments on this day yet.
                  </div>
                )}
              </div>
            </aside>
          </div>
        </section>

        <section className="availability-settings-section">
          <div className="availability-settings-section-head">
            <strong>Weekly schedule</strong>
            <span className="table-subtle">Managers will see this as your default working calendar.</span>
          </div>

          <div className="availability-rule-list">
            {ruleDrafts.map((rule) => (
              <div className="availability-rule-row" key={rule.dayOfWeek}>
                <label className="availability-rule-toggle">
                  <input
                    checked={rule.enabled}
                    onChange={(event) => updateRule(rule.dayOfWeek, { enabled: event.target.checked })}
                    type="checkbox"
                  />
                  <span>{rule.label}</span>
                </label>

                <div className="availability-rule-time">
                  <input
                    className="lead-record-input"
                    disabled={!rule.enabled || pending}
                    onChange={(event) => updateRule(rule.dayOfWeek, { startTime: event.target.value })}
                    type="time"
                    value={rule.startTime}
                  />
                  <span className="table-subtle">to</span>
                  <input
                    className="lead-record-input"
                    disabled={!rule.enabled || pending}
                    onChange={(event) => updateRule(rule.dayOfWeek, { endTime: event.target.value })}
                    type="time"
                    value={rule.endTime}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="availability-settings-section">
          <div className="availability-settings-section-head availability-settings-section-head-actions">
            <div>
              <strong>Date overrides</strong>
              <span className="table-subtle">Use overrides for leave, blocked time, or extra availability outside the normal weekly template.</span>
            </div>
            <button className="inbox-search-tool" onClick={() => openQuickAdd()} type="button">
              Add override
            </button>
          </div>

          <div className="availability-override-list">
            {overrideDrafts.length === 0 ? (
              <div className="availability-empty-state table-subtle">No overrides yet.</div>
            ) : (
              overrideDrafts.map((override) => (
                <div className="availability-override-card" key={override.id}>
                  <div className="availability-override-grid">
                    <label className="contact-assignment-label">
                      <span>Type</span>
                      <select
                        className="lead-record-input app-select"
                        disabled={pending}
                        onChange={(event) =>
                          updateOverride(override.id, { type: event.target.value as AvailabilityOverrideType })
                        }
                        value={override.type}
                      >
                        {AVAILABILITY_OVERRIDE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="contact-assignment-label">
                      <span>Start</span>
                      <input
                        className="lead-record-input"
                        disabled={pending}
                        onChange={(event) => updateOverride(override.id, { startAt: event.target.value })}
                        type="datetime-local"
                        value={override.startAt}
                      />
                    </label>

                    <label className="contact-assignment-label">
                      <span>End</span>
                      <input
                        className="lead-record-input"
                        disabled={pending}
                        onChange={(event) => updateOverride(override.id, { endAt: event.target.value })}
                        type="datetime-local"
                        value={override.endAt}
                      />
                    </label>
                  </div>

                  <div className="availability-override-meta">
                    <label className="control-block availability-override-note">
                      <span className="control-label">Note</span>
                      <input
                        className="control-input"
                        disabled={pending}
                        onChange={(event) => updateOverride(override.id, { note: event.target.value })}
                        placeholder="Optional note for managers"
                        type="text"
                        value={override.note}
                      />
                    </label>
                    <button
                      className="inbox-search-tool product-delete-button"
                      disabled={pending}
                      onClick={() => removeOverride(override.id)}
                      type="button"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        {overrides.length > 0 ? (
          <section className="availability-settings-section">
            <div className="availability-settings-section-head">
              <strong>Current overrides</strong>
              <span className="table-subtle">What managers see right now.</span>
            </div>
            <div className="availability-current-list">
              {overrides.map((override) => (
                <div className="availability-current-row" key={override.id}>
                  <strong>{override.label}</strong>
                  <span className="table-subtle">
                    {override.startAtLabel} to {override.endAtLabel}
                    {override.note ? ` | ${override.note}` : ""}
                  </span>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {error ? <div className="form-error">{error}</div> : null}

        <button className="button button-primary" disabled={pending} type="submit">
          {pending ? "Saving availability..." : "Save availability"}
        </button>
      </form>
      {editDraft && isMounted
        ? createPortal(
            <div className="inbox-dialog-backdrop" onClick={() => setEditDraft(null)} style={{ zIndex: INBOX_LAYERS.modal }}>
              <div
                aria-modal="true"
                className="inbox-dialog confirmation-dialog availability-edit-dialog"
                onClick={(event) => event.stopPropagation()}
                role="dialog"
                style={{ zIndex: INBOX_LAYERS.modal + 1 }}
              >
                <div className="inbox-dialog-head">
                  <div>
                    <strong>Edit calendar block</strong>
                    <p>Update the time range, type, or note for this appointment block.</p>
                  </div>
                </div>

                <div className="availability-edit-grid">
                  <label className="contact-assignment-label">
                    <span>Type</span>
                    <select
                      className="lead-record-input app-select"
                      disabled={pending}
                      onChange={(event) =>
                        setEditDraft((current) =>
                          current ? { ...current, type: event.target.value as AvailabilityOverrideType } : current
                        )
                      }
                      value={editDraft.type}
                    >
                      {AVAILABILITY_OVERRIDE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="contact-assignment-label">
                    <span>Start</span>
                    <input
                      className="lead-record-input"
                      disabled={pending}
                      onChange={(event) =>
                        setEditDraft((current) => (current ? { ...current, startAt: event.target.value } : current))
                      }
                      type="datetime-local"
                      value={editDraft.startAt}
                    />
                  </label>

                  <label className="contact-assignment-label">
                    <span>End</span>
                    <input
                      className="lead-record-input"
                      disabled={pending}
                      onChange={(event) =>
                        setEditDraft((current) => (current ? { ...current, endAt: event.target.value } : current))
                      }
                      type="datetime-local"
                      value={editDraft.endAt}
                    />
                  </label>

                  <label className="control-block availability-edit-note">
                    <span className="control-label">Note</span>
                    <input
                      className="control-input"
                      disabled={pending}
                      onChange={(event) =>
                        setEditDraft((current) => (current ? { ...current, note: event.target.value } : current))
                      }
                      placeholder="Optional note for managers"
                      type="text"
                      value={editDraft.note}
                    />
                  </label>
                </div>

                <div className="inbox-dialog-actions">
                  <button className="inbox-dialog-secondary" onClick={deleteEditOverride} type="button">
                    Delete
                  </button>
                  <div className="inbox-dialog-actions-right">
                    <button className="inbox-dialog-secondary" onClick={() => setEditDraft(null)} type="button">
                      Cancel
                    </button>
                    <button className="inbox-dialog-primary" onClick={commitEditOverride} type="button">
                      Save appointment
                    </button>
                  </div>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </article>
  );
}

function toLocalDateTimeValue(isoString: string) {
  const date = new Date(isoString);
  const offset = date.getTimezoneOffset();
  const localDate = new Date(date.getTime() - offset * 60 * 1000);
  return localDate.toISOString().slice(0, 16);
}

function buildCalendarDays(
  month: Date,
  weeklyRules: WeeklyRule[],
  overrides: DraftOverride[],
  appointments: CalendarAppointment[],
  selectedDay: Date
) {
  const firstOfMonth = startOfMonth(month);
  const firstDay = new Date(firstOfMonth);
  firstDay.setDate(firstDay.getDate() - firstOfMonth.getDay());

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(firstDay);
    date.setDate(firstDay.getDate() + index);

    const matchingRule = weeklyRules.find((rule) => rule.dayOfWeek === date.getDay());
    const appointmentCount = appointments.filter((appointment) =>
      isSameCalendarDay(new Date(appointment.startAtIso), date)
    ).length;
    const dayOverrides = overrides
      .filter((override) => isSameCalendarDay(new Date(override.startAt), date))
      .map((override) => ({
        id: override.id,
        label: getOverrideBadgeLabel(override.type),
        tone: getOverrideTone(override.type),
        timeLabel: `${formatLocalTime(override.startAt)} - ${formatLocalTime(override.endAt)}`,
        note: override.note.trim()
      }));

    return {
      key: date.toISOString(),
      date,
      isCurrentMonth: date.getMonth() === month.getMonth(),
      isToday: isSameCalendarDay(date, new Date()),
      isSelected: isSameCalendarDay(date, selectedDay),
      appointmentCount,
      defaultLabel:
        matchingRule && matchingRule.enabled ? `${matchingRule.startTime} - ${matchingRule.endTime}` : "Off day",
      defaultTone: matchingRule && matchingRule.enabled ? "working" : "off",
      overrides: dayOverrides
    };
  });
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function buildTimeSlots(day: Date) {
  return Array.from({ length: 14 }, (_, index) => {
    const slot = new Date(day);
    slot.setHours(index + 8, 0, 0, 0);
    return {
      date: slot,
      label: formatLocalTime(slot.toISOString())
    };
  });
}

function addMonths(date: Date, delta: number) {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}

function formatMonthLabel(date: Date) {
  return new Intl.DateTimeFormat("en-MY", {
    month: "long",
    year: "numeric"
  }).format(date);
}

function formatDayPanelLabel(date: Date) {
  return new Intl.DateTimeFormat("en-MY", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric"
  }).format(date);
}

function buildDaySchedule(
  day: Date,
  weeklyRules: WeeklyRule[],
  overrides: DraftOverride[],
  appointments: CalendarAppointment[]
) {
  const matchingRule = weeklyRules.find((rule) => rule.dayOfWeek === day.getDay());
  const defaultLabel =
    matchingRule && matchingRule.enabled ? `${matchingRule.startTime} - ${matchingRule.endTime}` : "Off day";

  const overrideItems = overrides
    .filter((override) => isSameCalendarDay(new Date(override.startAt), day))
    .map((override) => ({
      key: `override-${override.id}`,
      id: override.id,
      kind: "override" as const,
      tone: getOverrideTone(override.type),
      title: getOverrideBadgeLabel(override.type),
      timeLabel: `${formatLocalTime(override.startAt)} - ${formatLocalTime(override.endAt)}`,
      note: override.note.trim(),
      sortAt: new Date(override.startAt).getTime()
    }));

  const appointmentItems = appointments
    .filter((appointment) => isSameCalendarDay(new Date(appointment.startAtIso), day))
    .map((appointment) => ({
      key: `appointment-${appointment.id}`,
      kind: "appointment" as const,
      title: appointment.title,
      type: appointment.type,
      timeLabel: `${formatLocalTime(appointment.startAtIso)} - ${formatLocalTime(appointment.endAtIso)}`,
      note: appointment.note?.trim() ?? "",
      contactName: appointment.contactName,
      propertyName: appointment.propertyName,
      location: appointment.location,
      conversationId: appointment.conversationId,
      leadId: appointment.leadId,
      sortAt: new Date(appointment.startAtIso).getTime()
    }));

  return {
    defaultLabel,
    appointmentCount: appointmentItems.length,
    overrideCount: overrideItems.length,
    items: [...overrideItems, ...appointmentItems].sort((left, right) => left.sortAt - right.sortAt)
  };
}

function isSameCalendarDay(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function getOverrideBadgeLabel(type: AvailabilityOverrideType) {
  switch (type) {
    case AvailabilityOverrideType.LEAVE:
      return "Leave";
    case AvailabilityOverrideType.CUSTOM_AVAILABLE:
      return "Extra available";
    case AvailabilityOverrideType.BLOCKED:
    default:
      return "Blocked";
  }
}

function getOverrideTone(type: AvailabilityOverrideType) {
  switch (type) {
    case AvailabilityOverrideType.LEAVE:
      return "leave";
    case AvailabilityOverrideType.CUSTOM_AVAILABLE:
      return "available";
    case AvailabilityOverrideType.BLOCKED:
    default:
      return "blocked";
  }
}

function formatLocalTime(value: string) {
  const date = new Date(value);

  return new Intl.DateTimeFormat("en-MY", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}
