export const WHATSAPP_CLOUD_CONNECTION_STATUSES = [
  "not_connected",
  "connecting",
  "awaiting_meta_authorization",
  "awaiting_funding",
  "awaiting_webhook",
  "active",
  "restricted",
  "suspended",
  "failed",
  "disconnected"
] as const;

export type WhatsAppCloudConnectionStatus = (typeof WHATSAPP_CLOUD_CONNECTION_STATUSES)[number];
export type WhatsAppCloudOnboardingMode = "standard" | "coexistence";
export type WhatsAppCloudTransportKind = "meta_direct" | "approved_solution_partner";
export type WhatsAppFundingRoute = "unconfigured" | "solution_partner_direct" | "approved_partner";

export const WHATSAPP_PROVIDER_CAPABILITIES = {
  web: {
    linkedDeviceQr: true,
    metaHostedCoexistenceQr: false,
    freeTextOutsideCustomerWindow: true,
    templates: false,
    groups: true,
    appMessageEchoes: false,
    historyImport: true
  },
  cloud_api: {
    linkedDeviceQr: false,
    metaHostedCoexistenceQr: false,
    freeTextOutsideCustomerWindow: false,
    templates: true,
    groups: false,
    appMessageEchoes: false,
    historyImport: false
  },
  cloud_api_coexistence: {
    linkedDeviceQr: false,
    metaHostedCoexistenceQr: true,
    freeTextOutsideCustomerWindow: false,
    templates: true,
    groups: false,
    appMessageEchoes: true,
    historyImport: true
  }
} as const;

export function isCloudConnectionStatus(value: string): value is WhatsAppCloudConnectionStatus {
  return (WHATSAPP_CLOUD_CONNECTION_STATUSES as readonly string[]).includes(value);
}
