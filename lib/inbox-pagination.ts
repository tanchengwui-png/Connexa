export type InboxCursor = {
  timestamp: Date;
  id: string;
};

export function encodeInboxCursor(input: InboxCursor) {
  return Buffer.from(JSON.stringify([input.timestamp.toISOString(), input.id]), "utf8").toString("base64url");
}

export function decodeInboxCursor(value: string | null | undefined): InboxCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== 2 || typeof parsed[0] !== "string" || typeof parsed[1] !== "string") {
      return null;
    }
    const timestamp = new Date(parsed[0]);
    const id = parsed[1].trim();
    return Number.isNaN(timestamp.getTime()) || !id ? null : { timestamp, id };
  } catch {
    return null;
  }
}

export function clampInboxPageSize(value: string | number | null | undefined, fallback: number, maximum: number) {
  const parsed = typeof value === "number" ? value : Number.parseInt(value ?? "", 10);
  return Math.max(1, Math.min(maximum, Number.isFinite(parsed) ? parsed : fallback));
}
