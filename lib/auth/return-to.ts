export function getSafeReturnTo(value: unknown, fallback = "/inbox") {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.trim();
  if (!normalized.startsWith("/") || normalized.startsWith("//") || normalized.includes("\\")) {
    return fallback;
  }

  return normalized;
}
