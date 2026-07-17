export function isGenericWhatsAppChannelLabel(value: string | null | undefined) {
  const normalized = value?.trim();
  if (!normalized) {
    return true;
  }

  return /^phone\s*\d+$/i.test(normalized) || /^number\s*\d+$/i.test(normalized);
}

export function sanitizeWhatsAppChannelDisplayName(value: string | null | undefined) {
  const normalized = value?.trim();
  if (!normalized || isGenericWhatsAppChannelLabel(normalized)) {
    return null;
  }

  return normalized;
}

export function getPreferredWhatsAppChannelLabel(input: {
  displayName?: string | null;
  fallbackLabel?: string | null;
  phoneNumber?: string | null;
}) {
  const displayName = sanitizeWhatsAppChannelDisplayName(input.displayName);
  if (displayName) {
    return displayName;
  }

  const phoneNumber = input.phoneNumber?.trim();
  if (phoneNumber) {
    return phoneNumber;
  }

  return input.fallbackLabel?.trim() || null;
}
