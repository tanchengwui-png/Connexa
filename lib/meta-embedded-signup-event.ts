const TRUSTED_META_EMBEDDED_SIGNUP_ORIGINS = new Set([
  "https://www.facebook.com",
  "https://web.facebook.com",
  "https://business.facebook.com"
]);

export type MetaEmbeddedSignupEvent = {
  event: "FINISH" | "CANCEL" | "ERROR";
  wabaId: string | null;
  phoneNumberId: string | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readOptionalIdentifier(data: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

export function parseMetaEmbeddedSignupEvent(input: {
  origin: string;
  data: unknown;
}): MetaEmbeddedSignupEvent | null {
  if (!TRUSTED_META_EMBEDDED_SIGNUP_ORIGINS.has(input.origin)) {
    return null;
  }

  let payload: unknown = input.data;
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch {
      return null;
    }
  }

  const envelope = asRecord(payload);
  if (envelope?.type !== "WA_EMBEDDED_SIGNUP") {
    return null;
  }

  const event = typeof envelope.event === "string" ? envelope.event.trim().toUpperCase() : "";
  if (event !== "FINISH" && event !== "CANCEL" && event !== "ERROR") {
    return null;
  }

  const data = asRecord(envelope.data) ?? {};
  return {
    event,
    wabaId: readOptionalIdentifier(data, ["waba_id", "wabaId", "business_account_id"]),
    phoneNumberId: readOptionalIdentifier(data, ["phone_number_id", "phoneNumberId"])
  };
}
