import { AvailabilityOverrideType } from "@prisma/client";

export const WEEKDAY_OPTIONS = [
  { dayOfWeek: 0, label: "Sunday" },
  { dayOfWeek: 1, label: "Monday" },
  { dayOfWeek: 2, label: "Tuesday" },
  { dayOfWeek: 3, label: "Wednesday" },
  { dayOfWeek: 4, label: "Thursday" },
  { dayOfWeek: 5, label: "Friday" },
  { dayOfWeek: 6, label: "Saturday" }
] as const;

export const AVAILABILITY_OVERRIDE_OPTIONS = [
  { value: AvailabilityOverrideType.BLOCKED, label: "Blocked time" },
  { value: AvailabilityOverrideType.LEAVE, label: "Leave" },
  { value: AvailabilityOverrideType.CUSTOM_AVAILABLE, label: "Custom available" }
] as const;
