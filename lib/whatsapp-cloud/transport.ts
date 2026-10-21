import type { WhatsAppCloudTransportKind } from "@/lib/whatsapp-cloud/domain";

export type CloudSendRequest = {
  phoneNumberId: string;
  to: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
};

export type CloudSendResult = {
  providerMessageId: string;
  acceptedAt: Date;
};

export interface WhatsAppCloudTransport {
  readonly kind: WhatsAppCloudTransportKind;
  send(request: CloudSendRequest): Promise<CloudSendResult>;
}

export class DisabledPartnerTransport implements WhatsAppCloudTransport {
  readonly kind = "approved_solution_partner" as const;

  async send(): Promise<never> {
    throw new Error("APPROVED_PARTNER_TRANSPORT_NOT_CONFIGURED");
  }
}

// Direct Meta calls remain in the existing provider until funding, subscription,
// and reservation preflights are connected. This guard prevents callers from
// treating an approved-partner route as if it were a Graph API credential.
export function assertTransportMatchesFundingRoute(input: {
  transport: WhatsAppCloudTransportKind;
  fundingRoute: string;
}) {
  if (input.transport === "meta_direct" && input.fundingRoute !== "solution_partner_direct") {
    throw new Error("DIRECT_META_FUNDING_NOT_AUTHORIZED");
  }
  if (input.transport === "approved_solution_partner" && input.fundingRoute !== "approved_partner") {
    throw new Error("APPROVED_PARTNER_FUNDING_NOT_AUTHORIZED");
  }
}
