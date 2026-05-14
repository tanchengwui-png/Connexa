export const WORKFLOW_CONTENT_ATTRIBUTE_OPTIONS = [
  { label: "Contact name", value: "contact.displayName" },
  { label: "Contact email", value: "contact.email" },
  { label: "Contact tags", value: "contact.tags" },
  { label: "Contact address line 1", value: "contact.addressLine1" },
  { label: "Contact address line 2", value: "contact.addressLine2" },
  { label: "Contact city", value: "contact.city" },
  { label: "Contact state", value: "contact.state" },
  { label: "Contact postal code", value: "contact.postalCode" },
  { label: "Contact country", value: "contact.country" },
  { label: "Lead project", value: "project" },
  { label: "Lead preferred area", value: "preferredArea" },
  { label: "Lead financing status", value: "financingStatus" },
  { label: "Lead budget", value: "budget" },
  { label: "Lead estimated value", value: "value" },
  { label: "Lead priority", value: "priority" },
  { label: "Lead note", value: "note" },
  { label: "Lead source detail", value: "sourceDetail" },
  { label: "Lead lost reason", value: "lostReason" },
  { label: "Lead custom data field", value: "custom" }
] as const;

export type WorkflowContentAttributeKey = (typeof WORKFLOW_CONTENT_ATTRIBUTE_OPTIONS)[number]["value"];

const ATTRIBUTE_KEY_SET = new Set<string>(WORKFLOW_CONTENT_ATTRIBUTE_OPTIONS.map((option) => option.value));
const PRIORITY_VALUES = new Set(["LOW", "MEDIUM", "HIGH", "URGENT"]);

export function normalizeWorkflowContentAttributeKey(value: unknown) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return ATTRIBUTE_KEY_SET.has(normalized) ? (normalized as WorkflowContentAttributeKey) : null;
}

export function getWorkflowContentAttributeHelperText(attributeKey: string | null | undefined) {
  switch (attributeKey) {
    case "contact.email":
      return "Use a valid email address such as prospect@example.com.";
    case "budget":
    case "value":
      return "Use a numeric amount such as 500000, 500k, or 1.2m.";
    case "priority":
      return "Allowed values: LOW, MEDIUM, HIGH, or URGENT.";
    case "contact.tags":
      return "Use comma-separated tags. Duplicate tags are removed automatically.";
    case "contact.addressLine1":
      return "Street address or primary location line. Up to 120 characters.";
    case "contact.addressLine2":
      return "Optional unit, building, floor, or secondary location line.";
    case "contact.city":
      return "City or locality name between 2 and 80 characters.";
    case "contact.state":
      return "State, province, or region between 2 and 80 characters.";
    case "contact.postalCode":
      return "Letters, numbers, spaces, and hyphens only. Up to 20 characters.";
    case "contact.country":
      return "Country name between 2 and 80 characters.";
    case "contact.displayName":
      return "Use a readable contact name between 2 and 120 characters.";
    case "custom":
      return "Custom field values are stored as text in the lead custom data record.";
    default:
      return "The typed value will be validated before the workflow can save or run.";
  }
}

export function getWorkflowContentAttributePlaceholder(attributeKey: string | null | undefined) {
  switch (attributeKey) {
    case "contact.email":
      return "prospect@example.com";
    case "budget":
    case "value":
      return "500k";
    case "priority":
      return "HIGH";
    case "contact.tags":
      return "vip, investor";
    case "contact.addressLine1":
      return "12 Jalan Ampang";
    case "contact.addressLine2":
      return "Unit 8-2";
    case "contact.city":
      return "Kuala Lumpur";
    case "contact.state":
      return "Wilayah Persekutuan";
    case "contact.postalCode":
      return "50450";
    case "contact.country":
      return "Malaysia";
    case "project":
      return "Residensi Sentral";
    case "preferredArea":
      return "Mont Kiara";
    case "financingStatus":
      return "Pre-approved";
    case "note":
      return "Prefers weekend viewings.";
    case "sourceDetail":
      return "Campaign landing page";
    case "lostReason":
      return "Budget not aligned";
    default:
      return "Value";
  }
}

export function validateWorkflowContentAttributeLiteral(input: {
  attributeKey: string | null | undefined;
  value: string | null | undefined;
  customAttributeKey?: string | null | undefined;
}) {
  const attributeKey = normalizeWorkflowContentAttributeKey(input.attributeKey);
  if (!attributeKey) {
    return null;
  }

  const value = normalizeWorkflowContentAttributeText(input.value);
  if (!value) {
    return "Content field value is required.";
  }

  if (attributeKey === "custom") {
    const customKey = normalizeWorkflowContentAttributeText(input.customAttributeKey);
    if (!customKey) {
      return "Custom field key is required.";
    }
    if (customKey.length > 80) {
      return "Custom field key must be 80 characters or fewer.";
    }
  }

  return validateNormalizedWorkflowContentAttributeValue(attributeKey, value);
}

export function normalizeWorkflowContentAttributeText(value: string | null | undefined) {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

export function validateNormalizedWorkflowContentAttributeValue(
  attributeKey: WorkflowContentAttributeKey,
  value: string
) {
  switch (attributeKey) {
    case "contact.displayName":
      return validateStringRange(value, 2, 120, "Contact name");
    case "contact.email":
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
        ? null
        : "Contact email must be a valid email address.";
    case "contact.tags":
      return validateTagList(value);
    case "contact.addressLine1":
      return validateAddressField(value, 3, 120, "Contact address line 1", true);
    case "contact.addressLine2":
      return validateAddressField(value, 1, 120, "Contact address line 2", false);
    case "contact.city":
      return validateAddressField(value, 2, 80, "Contact city", true);
    case "contact.state":
      return validateAddressField(value, 2, 80, "Contact state", true);
    case "contact.postalCode":
      return /^[A-Za-z0-9 -]{1,20}$/.test(value)
        ? null
        : "Contact postal code can only contain letters, numbers, spaces, and hyphens.";
    case "contact.country":
      return validateAddressField(value, 2, 80, "Contact country", true);
    case "budget":
    case "value":
      return parseWorkflowAmount(value) !== null
        ? null
        : "Amount must be a valid number such as 500000, 500k, or 1.2m.";
    case "priority":
      return PRIORITY_VALUES.has(value.toUpperCase())
        ? null
        : "Lead priority must be LOW, MEDIUM, HIGH, or URGENT.";
    case "note":
    case "sourceDetail":
    case "lostReason":
      return validateStringRange(value, 2, 500, getWorkflowContentAttributeLabel(attributeKey));
    case "project":
    case "preferredArea":
    case "financingStatus":
    case "custom":
      return validateStringRange(value, 2, 120, getWorkflowContentAttributeLabel(attributeKey));
    default:
      return null;
  }
}

export function getWorkflowContentAttributeLabel(attributeKey: WorkflowContentAttributeKey) {
  return (
    WORKFLOW_CONTENT_ATTRIBUTE_OPTIONS.find((option) => option.value === attributeKey)?.label ??
    "Content field"
  );
}

export function parseWorkflowAmount(value: string) {
  const normalized = value.toLowerCase().replace(/,/g, "").trim();
  const match = normalized.match(/(\d+(?:\.\d+)?)(k|m)?/i);
  if (!match) {
    return null;
  }

  const base = Number(match[1]);
  if (!Number.isFinite(base) || base < 0) {
    return null;
  }

  const suffix = match[2]?.toLowerCase();
  if (suffix === "m") {
    return Math.round(base * 1_000_000);
  }
  if (suffix === "k") {
    return Math.round(base * 1_000);
  }
  return Math.round(base);
}

export function normalizeWorkflowTagList(value: string) {
  return Array.from(
    new Set(
      value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
    )
  );
}

function validateTagList(value: string) {
  const tags = normalizeWorkflowTagList(value);
  if (!tags.length) {
    return "At least one tag is required.";
  }
  if (tags.length > 20) {
    return "Tag list must contain 20 tags or fewer.";
  }
  const tooLong = tags.find((tag) => tag.length > 40);
  if (tooLong) {
    return "Each tag must be 40 characters or fewer.";
  }
  return null;
}

function validateStringRange(value: string, min: number, max: number, label: string) {
  if (value.length < min) {
    return `${label} must be at least ${min} characters.`;
  }
  if (value.length > max) {
    return `${label} must be ${max} characters or fewer.`;
  }
  return null;
}

function validateAddressField(
  value: string,
  min: number,
  max: number,
  label: string,
  requireAlphaNumeric: boolean
) {
  if (value.length < min) {
    return `${label} must be at least ${min} characters.`;
  }
  if (value.length > max) {
    return `${label} must be ${max} characters or fewer.`;
  }
  if (!/^[\p{L}\p{N}\s,./#'()-]+$/u.test(value)) {
    return `${label} contains unsupported characters.`;
  }
  if (requireAlphaNumeric && !/[\p{L}\p{N}]/u.test(value)) {
    return `${label} must contain letters or numbers.`;
  }
  return null;
}
