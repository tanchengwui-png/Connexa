import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

export function verifyMetaWebhookSignature(input: {
  appSecret: string;
  rawBody: string | Buffer;
  signatureHeader: string | null | undefined;
}) {
  const appSecret = input.appSecret.trim();
  const signature = input.signatureHeader?.trim() ?? "";
  if (!appSecret || !signature.startsWith("sha256=")) {
    return false;
  }

  const supplied = signature.slice("sha256=".length);
  if (!/^[a-f0-9]{64}$/i.test(supplied)) {
    return false;
  }

  const expected = createHmac("sha256", appSecret).update(input.rawBody).digest("hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  const suppliedBuffer = Buffer.from(supplied, "hex");
  return expectedBuffer.length === suppliedBuffer.length && timingSafeEqual(expectedBuffer, suppliedBuffer);
}

export function buildMetaWebhookIdempotencyKey(input: {
  integrationIdentity: string;
  entryId?: string | null;
  field?: string | null;
  providerEventId?: string | null;
  eventType: string;
  occurredAt?: string | number | null;
  payloadDigest: string;
}) {
  return sha256(
    [
      input.integrationIdentity,
      input.entryId ?? "",
      input.field ?? "",
      input.providerEventId ?? "",
      input.eventType,
      `${input.occurredAt ?? ""}`,
      input.payloadDigest
    ].join("|")
  );
}

export function redactMetaWebhookPayload(payload: Record<string, unknown>) {
  const entries = Array.isArray(payload.entry) ? payload.entry : [];
  return {
    object: typeof payload.object === "string" ? payload.object : null,
    entryCount: entries.length,
    changeCount: entries.reduce((count, entry) => {
      if (!entry || typeof entry !== "object") {
        return count;
      }
      return count + (Array.isArray((entry as { changes?: unknown[] }).changes) ? (entry as { changes: unknown[] }).changes.length : 0);
    }, 0)
  };
}
