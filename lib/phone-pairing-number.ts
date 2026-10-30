import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/max";

export function normalizeWhatsAppWebPairingPhone(input: { countryCode: string; phoneNumber: string }) {
  const countryCode = input.countryCode.trim().toUpperCase() as CountryCode;
  const rawNumber = input.phoneNumber.trim();
  const parsed = rawNumber.startsWith("+")
    ? parsePhoneNumberFromString(rawNumber)
    : parsePhoneNumberFromString(rawNumber, countryCode);

  if (!parsed || !parsed.isPossible() || !parsed.isValid()) {
    throw new Error("WHATSAPP_PHONE_PAIRING_INVALID_NUMBER");
  }

  return {
    countryCode: parsed.country ?? countryCode,
    internationalDigits: parsed.number.replace(/^\+/, ""),
    maskedPhoneNumber: maskPhoneNumber(parsed.number)
  };
}

export function maskPhoneNumber(value: string) {
  const normalized = value.replace(/[^\d]/g, "");
  if (!normalized) return "";

  const visibleTail = normalized.slice(-3);
  return `+${"•".repeat(Math.max(6, normalized.length - visibleTail.length))}${visibleTail}`;
}
