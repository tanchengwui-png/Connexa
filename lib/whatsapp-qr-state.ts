const DEFAULT_WHATSAPP_QR_MAX_AGE_MS = 60_000;

function toTimestamp(value: Date | string | number | null | undefined) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (!value) return null;
  const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function getWhatsAppQrMaxAgeMs() {
  return Math.max(
    30_000,
    Number.parseInt(
      process.env.WHATSAPP_QR_MAX_AGE_MS ?? String(DEFAULT_WHATSAPP_QR_MAX_AGE_MS),
      10
    ) || DEFAULT_WHATSAPP_QR_MAX_AGE_MS
  );
}

export function resolveWhatsAppQrPresentation(input: {
  runtimePresent: boolean;
  runtimeStatus: string;
  qrCodeDataUrl: string | null | undefined;
  qrCodeGeneratedAt: Date | string | number | null | undefined;
  now?: number;
  maxAgeMs?: number;
}) {
  const generatedAt = toTimestamp(input.qrCodeGeneratedAt);
  const now = input.now ?? Date.now();
  const maxAgeMs = Math.max(1, input.maxAgeMs ?? getWhatsAppQrMaxAgeMs());
  const expiresAt = generatedAt === null ? null : generatedAt + maxAgeMs;
  const isFresh =
    input.runtimePresent &&
    input.runtimeStatus === "QR_READY" &&
    Boolean(input.qrCodeDataUrl) &&
    generatedAt !== null &&
    expiresAt !== null &&
    now < expiresAt;
  const qrCodeExpired =
    input.runtimeStatus === "QR_READY" &&
    Boolean(input.qrCodeDataUrl) &&
    !isFresh;

  return {
    qrCodeDataUrl: isFresh ? input.qrCodeDataUrl ?? null : null,
    qrCodeGeneratedAt: generatedAt === null ? null : new Date(generatedAt).toISOString(),
    qrCodeExpiresAt: expiresAt === null ? null : new Date(expiresAt).toISOString(),
    qrCodeExpired
  };
}
