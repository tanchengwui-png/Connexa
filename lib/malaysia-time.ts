export const MALAYSIA_TIME_ZONE = "Asia/Kuala_Lumpur";

const MALAYSIA_OFFSET_HOURS = 8;
const MALAYSIA_OFFSET_MS = MALAYSIA_OFFSET_HOURS * 60 * 60 * 1000;

type MalaysiaDateInput = Date | string;

type MalaysiaDateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function toDate(value: MalaysiaDateInput) {
  return value instanceof Date ? value : new Date(value);
}

function pad(value: number) {
  return `${value}`.padStart(2, "0");
}

export function getMalaysiaDateTimeParts(value: MalaysiaDateInput): MalaysiaDateParts {
  const date = toDate(value);
  const shifted = new Date(date.getTime() + MALAYSIA_OFFSET_MS);

  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds()
  };
}

export function createMalaysiaDate(input: {
  year: number;
  month: number;
  day: number;
  hour?: number;
  minute?: number;
  second?: number;
}) {
  return new Date(
    Date.UTC(
      input.year,
      input.month - 1,
      input.day,
      (input.hour ?? 0) - MALAYSIA_OFFSET_HOURS,
      input.minute ?? 0,
      input.second ?? 0
    )
  );
}

export function formatMalaysiaDateTimeLocalInput(value: MalaysiaDateInput | null | undefined) {
  if (!value) {
    return "";
  }

  const date = toDate(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const parts = getMalaysiaDateTimeParts(date);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

export function parseMalaysiaDateTimeLocalInput(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) {
    return null;
  }

  const [, year, month, day, hour, minute] = match;
  const date = createMalaysiaDate({
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute)
  });

  return Number.isNaN(date.getTime()) ? null : date;
}

export function getMalaysiaDateKey(value: MalaysiaDateInput) {
  const parts = getMalaysiaDateTimeParts(value);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

export function getMalaysiaDayOfWeek(value: MalaysiaDateInput) {
  const date = toDate(value);
  return new Date(date.getTime() + MALAYSIA_OFFSET_MS).getUTCDay();
}

export function startOfMalaysiaDay(value: MalaysiaDateInput) {
  const parts = getMalaysiaDateTimeParts(value);
  return createMalaysiaDate({
    year: parts.year,
    month: parts.month,
    day: parts.day
  });
}

export function startOfMalaysiaMonth(value: MalaysiaDateInput) {
  const parts = getMalaysiaDateTimeParts(value);
  return createMalaysiaDate({
    year: parts.year,
    month: parts.month,
    day: 1
  });
}

export function addMalaysiaDays(
  value: MalaysiaDateInput,
  days: number,
  time?: {
    hour?: number;
    minute?: number;
    second?: number;
  }
) {
  const parts = getMalaysiaDateTimeParts(value);

  return createMalaysiaDate({
    year: parts.year,
    month: parts.month,
    day: parts.day + days,
    hour: time?.hour ?? parts.hour,
    minute: time?.minute ?? parts.minute,
    second: time?.second ?? parts.second
  });
}

export function addMalaysiaMonths(value: MalaysiaDateInput, months: number) {
  const parts = getMalaysiaDateTimeParts(value);

  return createMalaysiaDate({
    year: parts.year,
    month: parts.month + months,
    day: 1
  });
}
