export type LeadCustomFieldType = "text" | "number" | "datetime";

export type LeadCustomFieldDefinition = {
  key: string;
  label: string;
  type: LeadCustomFieldType;
};

export type LeadIndustryTemplate = {
  key: string;
  label: string;
  fields: LeadCustomFieldDefinition[];
};

export const LEAD_INDUSTRY_TEMPLATES: Record<string, LeadIndustryTemplate> = {
  PROPERTY: {
    key: "PROPERTY",
    label: "Property",
    fields: [
      { key: "project", label: "Project", type: "text" },
      { key: "preferredArea", label: "Preferred area", type: "text" },
      { key: "budget", label: "Budget", type: "text" },
      { key: "financingStatus", label: "Financing status", type: "text" },
      { key: "siteVisitAt", label: "Site visit at", type: "datetime" }
    ]
  },
  CLINIC: {
    key: "CLINIC",
    label: "Clinic",
    fields: [
      { key: "serviceType", label: "Service type", type: "text" },
      { key: "appointmentDate", label: "Appointment date", type: "datetime" },
      { key: "doctorPreference", label: "Doctor preference", type: "text" }
    ]
  },
  ECOMMERCE: {
    key: "ECOMMERCE",
    label: "Ecommerce",
    fields: [
      { key: "productInterest", label: "Product interest", type: "text" },
      { key: "orderValue", label: "Order value", type: "number" },
      { key: "deliveryArea", label: "Delivery area", type: "text" }
    ]
  },
  WORKSHOP: {
    key: "WORKSHOP",
    label: "Workshop",
    fields: [
      { key: "vehicleModel", label: "Vehicle model", type: "text" },
      { key: "serviceNeeded", label: "Service needed", type: "text" },
      { key: "preferredDate", label: "Preferred date", type: "datetime" }
    ]
  },
  EDUCATION: {
    key: "EDUCATION",
    label: "Education",
    fields: [
      { key: "courseInterest", label: "Course interest", type: "text" },
      { key: "studentLevel", label: "Student level", type: "text" },
      { key: "preferredSchedule", label: "Preferred schedule", type: "text" }
    ]
  },
  GENERAL: {
    key: "GENERAL",
    label: "General",
    fields: [
      { key: "interest", label: "Interest", type: "text" },
      { key: "requirement", label: "Requirement", type: "text" },
      { key: "targetDate", label: "Target date", type: "datetime" }
    ]
  }
};

export const DEFAULT_LEAD_CUSTOM_FIELD_TEMPLATE = LEAD_INDUSTRY_TEMPLATES.PROPERTY;

export function parseLeadCustomData(value?: string | null) {
  if (!value) {
    return {} as Record<string, unknown>;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function stringifyLeadCustomData(value: Record<string, unknown>) {
  const entries = Object.entries(value).filter(([, entryValue]) => {
    if (entryValue === null || entryValue === undefined) {
      return false;
    }
    return typeof entryValue !== "string" || entryValue.trim().length > 0;
  });

  return entries.length ? JSON.stringify(Object.fromEntries(entries)) : null;
}

export function getLeadCustomString(customData: Record<string, unknown>, key: string) {
  const value = customData[key];
  if (value === null || value === undefined) {
    return null;
  }
  return String(value);
}
