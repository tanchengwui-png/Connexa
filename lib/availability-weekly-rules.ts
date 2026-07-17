export const DEFAULT_AVAILABILITY_START_TIME = "09:00";
export const DEFAULT_AVAILABILITY_END_TIME = "18:00";

export type WeeklyAvailabilityRule = {
  dayOfWeek: number;
  label: string;
  enabled: boolean;
  startTime: string;
  endTime: string;
  allDay: boolean;
};

export function createWeeklyAvailabilityRule(input: {
  dayOfWeek: number;
  label: string;
  enabled?: boolean;
  startTime?: string;
  endTime?: string;
  allDay?: boolean;
}) {
  return {
    dayOfWeek: input.dayOfWeek,
    label: input.label,
    enabled: input.enabled ?? false,
    startTime: input.startTime ?? DEFAULT_AVAILABILITY_START_TIME,
    endTime: input.endTime ?? DEFAULT_AVAILABILITY_END_TIME,
    allDay: input.allDay ?? false
  } satisfies WeeklyAvailabilityRule;
}

export function getWeeklyAvailabilityRuleLabel(rule: Pick<WeeklyAvailabilityRule, "enabled" | "allDay" | "startTime" | "endTime">) {
  if (!rule.enabled) {
    return "Off day";
  }

  if (rule.allDay) {
    return "All day";
  }

  return `${rule.startTime} - ${rule.endTime}`;
}

export function areWeeklyAvailabilityTimeInputsDisabled(
  rule: Pick<WeeklyAvailabilityRule, "enabled" | "allDay">,
  pending = false
) {
  return pending || !rule.enabled || rule.allDay;
}

export function isWeeklyAvailabilityAllDayDisabled(rule: Pick<WeeklyAvailabilityRule, "enabled">, pending = false) {
  return pending || !rule.enabled;
}

export function toggleWeeklyAvailabilityAllDay(rule: WeeklyAvailabilityRule, nextAllDay: boolean) {
  return {
    ...rule,
    allDay: nextAllDay
  } satisfies WeeklyAvailabilityRule;
}

export function serializeWeeklyAvailabilityRuleForSave(
  rule: Pick<WeeklyAvailabilityRule, "dayOfWeek" | "enabled" | "allDay" | "startTime" | "endTime">
) {
  return {
    dayOfWeek: rule.dayOfWeek,
    enabled: rule.enabled,
    allDay: rule.allDay,
    startTime: rule.startTime,
    endTime: rule.endTime
  };
}
