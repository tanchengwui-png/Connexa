export type ContactAddressInput = {
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
};

export type NormalizedContactAddress = {
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
};

const MAX_LENGTH = {
  addressLine1: 120,
  addressLine2: 120,
  city: 80,
  state: 80,
  postalCode: 20,
  country: 80
} as const;

const ADDRESS_TEXT_PATTERN = /^[\p{L}\p{N}\s,./#'()-]+$/u;
const POSTAL_CODE_PATTERN = /^[A-Za-z0-9 -]+$/;

export function normalizeContactAddress(input: ContactAddressInput): NormalizedContactAddress {
  return {
    addressLine1: normalizeAddressValue(input.addressLine1),
    addressLine2: normalizeAddressValue(input.addressLine2),
    city: normalizeAddressValue(input.city),
    state: normalizeAddressValue(input.state),
    postalCode: normalizeAddressValue(input.postalCode),
    country: normalizeAddressValue(input.country)
  };
}

export function validateContactAddress(input: ContactAddressInput) {
  const normalized = normalizeContactAddress(input);
  const hasAnyAddressField = Object.values(normalized).some(Boolean);

  if (!hasAnyAddressField) {
    return { normalized, error: null as string | null };
  }

  if (!normalized.addressLine1) {
    return { normalized, error: "Address line 1 is required when saving an address." };
  }

  if (normalized.addressLine1.length < 3) {
    return { normalized, error: "Address line 1 must be at least 3 characters." };
  }

  if (normalized.addressLine1.length > MAX_LENGTH.addressLine1) {
    return { normalized, error: `Address line 1 must be ${MAX_LENGTH.addressLine1} characters or fewer.` };
  }

  if (!isValidAddressText(normalized.addressLine1)) {
    return { normalized, error: "Address line 1 contains unsupported characters." };
  }

  if (normalized.addressLine2 && normalized.addressLine2.length > MAX_LENGTH.addressLine2) {
    return { normalized, error: `Address line 2 must be ${MAX_LENGTH.addressLine2} characters or fewer.` };
  }

  if (normalized.addressLine2 && !isValidAddressText(normalized.addressLine2)) {
    return { normalized, error: "Address line 2 contains unsupported characters." };
  }

  if (!normalized.city) {
    return { normalized, error: "City is required when saving an address." };
  }

  if (normalized.city.length < 2) {
    return { normalized, error: "City must be at least 2 characters." };
  }

  if (normalized.city.length > MAX_LENGTH.city) {
    return { normalized, error: `City must be ${MAX_LENGTH.city} characters or fewer.` };
  }

  if (!isValidAddressText(normalized.city)) {
    return { normalized, error: "City contains unsupported characters." };
  }

  if (!normalized.state) {
    return { normalized, error: "State is required when saving an address." };
  }

  if (normalized.state.length < 2) {
    return { normalized, error: "State must be at least 2 characters." };
  }

  if (normalized.state.length > MAX_LENGTH.state) {
    return { normalized, error: `State must be ${MAX_LENGTH.state} characters or fewer.` };
  }

  if (!isValidAddressText(normalized.state)) {
    return { normalized, error: "State contains unsupported characters." };
  }

  if (normalized.postalCode && normalized.postalCode.length > MAX_LENGTH.postalCode) {
    return { normalized, error: `Postal code must be ${MAX_LENGTH.postalCode} characters or fewer.` };
  }

  if (normalized.postalCode && !POSTAL_CODE_PATTERN.test(normalized.postalCode)) {
    return { normalized, error: "Postal code can only contain letters, numbers, spaces, and hyphens." };
  }

  if (!normalized.country) {
    return { normalized, error: "Country is required when saving an address." };
  }

  if (normalized.country.length < 2) {
    return { normalized, error: "Country must be at least 2 characters." };
  }

  if (normalized.country.length > MAX_LENGTH.country) {
    return { normalized, error: `Country must be ${MAX_LENGTH.country} characters or fewer.` };
  }

  if (!isValidAddressText(normalized.country)) {
    return { normalized, error: "Country contains unsupported characters." };
  }

  return { normalized, error: null as string | null };
}

function normalizeAddressValue(value?: string | null) {
  const normalized = value?.replace(/\s+/g, " ").trim() ?? "";
  return normalized || null;
}

function isValidAddressText(value: string) {
  const trimmed = value.trim();
  return Boolean(trimmed) && ADDRESS_TEXT_PATTERN.test(trimmed) && /[\p{L}\p{N}]/u.test(trimmed);
}
