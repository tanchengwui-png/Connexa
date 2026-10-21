export type CloudSendGateInput = {
  cloudEnabled: boolean;
  billingEnabled: boolean;
  subscriptionStatus: string | null;
  connectionStatus: string;
  fundingRoute: string;
  fundingVerified: boolean;
  reservationStatus: string | null;
  reservationExpired: boolean;
  reservationWorkspaceId: string | null;
  reservationChannelId: string | null;
  hasPricingContext: boolean;
  workspaceId: string;
  channelId: string;
};

export function evaluateCloudSendGate(input: CloudSendGateInput) {
  if (!input.cloudEnabled) return "WHATSAPP_CLOUD_DISABLED";
  if (!input.billingEnabled) return "WHATSAPP_CLOUD_BILLING_DISABLED";
  if (input.subscriptionStatus !== "ACTIVE") return "PAID_SUBSCRIPTION_REQUIRED";
  if (input.connectionStatus !== "ACTIVE") return "WHATSAPP_CLOUD_CONNECTION_NOT_ACTIVE";
  if (input.fundingRoute === "unconfigured" || !input.fundingVerified) return "FUNDING_NOT_VERIFIED";
  if (input.reservationStatus !== "RESERVED") return "CLOUD_USAGE_RESERVATION_REQUIRED";
  if (input.reservationExpired) return "CLOUD_USAGE_RESERVATION_EXPIRED";
  if (!input.hasPricingContext) return "CLOUD_PRICING_CONTEXT_REQUIRED";
  if (
    input.reservationWorkspaceId !== input.workspaceId ||
    input.reservationChannelId !== input.channelId
  ) {
    return "CLOUD_USAGE_RESERVATION_SCOPE_MISMATCH";
  }
  return null;
}
