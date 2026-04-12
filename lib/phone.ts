export function normalizeStoredPhone(value: string) {
  return value.replace(/[^\d]/g, "");
}

export function buildStoredPhone(countryCode: string, localNumber: string) {
  const dialCode = normalizeStoredPhone(countryCode);
  const subscriber = normalizeStoredPhone(localNumber).replace(/^0+/, "");

  if (!dialCode || !subscriber) {
    return "";
  }

  return `${dialCode}${subscriber}`;
}

export function formatPhoneForDisplay(value: string) {
  const digits = normalizeStoredPhone(value);

  if (!digits) {
    return "";
  }

  return `+${digits}`;
}
