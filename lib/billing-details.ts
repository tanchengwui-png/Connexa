export const DEFAULT_BILLING_COUNTRY = "Malaysia";

export type BillingDetails = {
  billingName: string;
  billingPhoneNumber: string;
  billingAddressLine1: string;
  billingAddressLine2: string;
  billingCity: string;
  billingState: string;
  billingPostcode: string;
  billingCountry: string;
  billingTaxId: string;
};

export type BillingDetailsField = keyof BillingDetails;

export type BillingDetailsErrors = Partial<Record<BillingDetailsField, string>>;

const REQUIRED_FIELDS: Array<{ field: BillingDetailsField; label: string }> = [
  { field: "billingName", label: "Billing name or company name" },
  { field: "billingPhoneNumber", label: "Phone number" },
  { field: "billingAddressLine1", label: "Billing address line 1" },
  { field: "billingCity", label: "City" },
  { field: "billingState", label: "State" },
  { field: "billingPostcode", label: "Postcode" },
  { field: "billingCountry", label: "Country" }
];

export function createEmptyBillingDetails(
  overrides: Partial<BillingDetails> = {}
): BillingDetails {
  return {
    billingName: "",
    billingPhoneNumber: "",
    billingAddressLine1: "",
    billingAddressLine2: "",
    billingCity: "",
    billingState: "",
    billingPostcode: "",
    billingCountry: DEFAULT_BILLING_COUNTRY,
    billingTaxId: "",
    ...overrides
  };
}

export function normalizeBillingDetails(
  input: Partial<Record<BillingDetailsField, unknown>>
): BillingDetails {
  const getText = (field: BillingDetailsField) => String(input[field] ?? "").trim();

  return {
    billingName: getText("billingName"),
    billingPhoneNumber: getText("billingPhoneNumber"),
    billingAddressLine1: getText("billingAddressLine1"),
    billingAddressLine2: getText("billingAddressLine2"),
    billingCity: getText("billingCity"),
    billingState: getText("billingState"),
    billingPostcode: normalizeMalaysianPostcode(getText("billingPostcode")),
    billingCountry: getText("billingCountry") || DEFAULT_BILLING_COUNTRY,
    billingTaxId: getText("billingTaxId")
  };
}

export function validateBillingDetails(details: BillingDetails): BillingDetailsErrors {
  const errors: BillingDetailsErrors = {};

  for (const field of REQUIRED_FIELDS) {
    if (!details[field.field]) {
      errors[field.field] = `${field.label} is required.`;
    }
  }

  if (details.billingPostcode && !isValidMalaysianPostcode(details.billingPostcode)) {
    errors.billingPostcode = "Enter a valid Malaysian postcode.";
  }

  return errors;
}

export function getBillingDetailsErrorMessage(errors: BillingDetailsErrors) {
  const firstKey = Object.keys(errors)[0] as BillingDetailsField | undefined;
  return firstKey ? errors[firstKey] ?? "Billing details are invalid." : null;
}

export function hasBillingDetailsErrors(errors: BillingDetailsErrors) {
  return Object.keys(errors).length > 0;
}

export function isValidMalaysianPostcode(value: string) {
  return /^\d{5}$/.test(normalizeMalaysianPostcode(value));
}

function normalizeMalaysianPostcode(value: string) {
  return value.replace(/\s+/g, "");
}
