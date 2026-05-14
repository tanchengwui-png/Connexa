import { findAgentAvailability, listWorkspaceAvailabilityAgents, replaceAgentAvailability } from "@/lib/db-availability";
import { AVAILABILITY_OVERRIDE_OPTIONS, WEEKDAY_OPTIONS } from "@/lib/availability-constants";
import { AvailabilityOverrideType } from "@/lib/db-types";

const AVAILABILITY_TIME_ZONE = "Asia/Kuala_Lumpur";

const WEEKDAY_INDEX_BY_NAME: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6
};

export type AvailabilityRuleInput = {
  dayOfWeek: number;
  enabled: boolean;
  startTime: string;
  endTime: string;
};

export type AvailabilityOverrideInput = {
  id?: string;
  type: AvailabilityOverrideType;
  startAt: string;
  endAt: string;
  note?: string;
};

export async function getAgentAvailability(agentId: string) {
  const agent = await findAgentAvailability(agentId);

  if (!agent) {
    throw new Error("Agent not found.");
  }

  const rulesByDay = new Map(agent.availabilityRules.map((rule) => [rule.dayOfWeek, rule]));

  return {
    weeklyRules: WEEKDAY_OPTIONS.map(({ dayOfWeek, label }) => {
      const rule = rulesByDay.get(dayOfWeek);
      return {
        dayOfWeek,
        label,
        enabled: rule?.enabled ?? false,
        startTime: rule?.startTime ?? "09:00",
        endTime: rule?.endTime ?? "18:00"
      };
    }),
    overrides: agent.availabilityOverrides.map((override) => ({
      id: override.id,
      type: override.type,
      label: formatOverrideType(override.type),
      startAtIso: override.startAt.toISOString(),
      endAtIso: override.endAt.toISOString(),
      startAtLabel: formatDateTime(override.startAt),
      endAtLabel: formatDateTime(override.endAt),
      note: override.note ?? ""
    }))
  };
}

export async function saveAgentAvailability(
  agentId: string,
  input: {
    weeklyRules: AvailabilityRuleInput[];
    overrides: AvailabilityOverrideInput[];
  }
) {
  validateWeeklyRules(input.weeklyRules);
  validateOverrides(input.overrides);

  await replaceAgentAvailability(agentId, {
    weeklyRules: input.weeklyRules.map((rule) => ({
      dayOfWeek: rule.dayOfWeek,
      enabled: rule.enabled,
      startTime: rule.startTime,
      endTime: rule.endTime
    })),
    overrides: input.overrides.map((override) => ({
      type: override.type,
      startAt: new Date(override.startAt),
      endAt: new Date(override.endAt),
      note: cleanNullableText(override.note)
    }))
  });
}

export async function getWorkspaceAvailabilitySummary(workspaceId: string) {
  const agents = await listWorkspaceAvailabilityAgents(workspaceId);

  return agents.map((agent) => ({
    agentId: agent.agentId,
    agentName: agent.agentName,
    status: deriveAvailabilityStatus({
      rules: agent.availabilityRules,
      overrides: agent.availabilityOverrides.map((override) => ({
        type: override.type,
        startAt: override.startAt,
        endAt: override.endAt
      }))
    })
  }));
}

export function deriveAvailabilityStatus(input: {
  rules: Array<Pick<AvailabilityRuleInput, "dayOfWeek" | "enabled" | "startTime" | "endTime">>;
  overrides: Array<{ type: AvailabilityOverrideType; startAt: Date; endAt: Date }>;
}) {
  const now = new Date();
  const dayName = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    timeZone: AVAILABILITY_TIME_ZONE
  }).format(now);
  const dayOfWeek = WEEKDAY_INDEX_BY_NAME[dayName] ?? 0;
  const currentMinutes = getMinutesInTimeZone(now);

  const activeOverride = input.overrides.find((override) => now >= override.startAt && now <= override.endAt);
  if (activeOverride) {
    if (activeOverride.type === AvailabilityOverrideType.CUSTOM_AVAILABLE) {
      return {
        tone: "available" as const,
        label: `Available until ${formatTime(activeOverride.endAt)}`
      };
    }

    return {
      tone: "away" as const,
      label:
        activeOverride.type === AvailabilityOverrideType.LEAVE
          ? `On leave until ${formatDateTime(activeOverride.endAt)}`
          : `Blocked until ${formatDateTime(activeOverride.endAt)}`
    };
  }

  const todayRule = input.rules.find((rule) => rule.dayOfWeek === dayOfWeek);
  if (!todayRule || !todayRule.enabled) {
    return {
      tone: "off" as const,
      label: "Off today"
    };
  }

  const startMinutes = toMinutes(todayRule.startTime);
  const endMinutes = toMinutes(todayRule.endTime);

  if (currentMinutes < startMinutes) {
    return {
      tone: "scheduled" as const,
      label: `Starts at ${todayRule.startTime}`
    };
  }

  if (currentMinutes > endMinutes) {
    return {
      tone: "off" as const,
      label: "Shift ended"
    };
  }

  return {
    tone: "available" as const,
    label: `Available until ${todayRule.endTime}`
  };
}

function validateWeeklyRules(rules: AvailabilityRuleInput[]) {
  if (rules.length !== WEEKDAY_OPTIONS.length) {
    throw new Error("Availability requires one rule for each day of the week.");
  }

  const uniqueDays = new Set<number>();

  for (const rule of rules) {
    if (!Number.isInteger(rule.dayOfWeek) || rule.dayOfWeek < 0 || rule.dayOfWeek > 6) {
      throw new Error("Invalid weekday in availability rules.");
    }

    if (uniqueDays.has(rule.dayOfWeek)) {
      throw new Error("Duplicate weekday in availability rules.");
    }

    uniqueDays.add(rule.dayOfWeek);

    if (!isValidTime(rule.startTime) || !isValidTime(rule.endTime)) {
      throw new Error("Availability times must use HH:MM.");
    }

    if (toMinutes(rule.endTime) <= toMinutes(rule.startTime)) {
      throw new Error("End time must be later than start time.");
    }
  }
}

function validateOverrides(overrides: AvailabilityOverrideInput[]) {
  for (const override of overrides) {
    if (!Object.values(AvailabilityOverrideType).includes(override.type)) {
      throw new Error("Invalid availability override type.");
    }

    const startAt = new Date(override.startAt);
    const endAt = new Date(override.endAt);

    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
      throw new Error("Availability overrides need valid start and end dates.");
    }

    if (endAt <= startAt) {
      throw new Error("Availability override end time must be after the start time.");
    }
  }
}

function formatOverrideType(type: AvailabilityOverrideType) {
  switch (type) {
    case AvailabilityOverrideType.BLOCKED:
      return "Blocked time";
    case AvailabilityOverrideType.LEAVE:
      return "Leave";
    case AvailabilityOverrideType.CUSTOM_AVAILABLE:
      return "Custom available";
    default:
      return "Override";
  }
}

function formatDateTime(date: Date) {
  return new Intl.DateTimeFormat("en-MY", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: AVAILABILITY_TIME_ZONE
  }).format(date);
}

function formatTime(date: Date) {
  return new Intl.DateTimeFormat("en-MY", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: AVAILABILITY_TIME_ZONE
  }).format(date);
}

function cleanNullableText(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function isValidTime(value: string) {
  return /^\d{2}:\d{2}$/.test(value);
}

function toMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function getMinutesInTimeZone(date: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: AVAILABILITY_TIME_ZONE
  }).formatToParts(date);

  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");

  return hour * 60 + minute;
}
