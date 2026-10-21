import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getWhatsAppCloudFeatureFlags, isWhatsAppCloudEnabledForWorkspace } from "@/lib/whatsapp-cloud/feature-flags";
import { assertTransportMatchesFundingRoute } from "@/lib/whatsapp-cloud/transport";
import { evaluateCloudSendGate } from "@/lib/whatsapp-cloud/billing-gate";

export { evaluateCloudSendGate } from "@/lib/whatsapp-cloud/billing-gate";

export async function assertAuthorizedCloudSend(input: {
  workspaceId: string;
  channelId: string;
  reservationId?: string | null;
}) {
  const flags = getWhatsAppCloudFeatureFlags();
  const [channel, subscription, funding, reservation, pricingContext] = await Promise.all([
    prisma.whatsAppChannel.findFirst({
      where: { id: input.channelId, workspaceId: input.workspaceId },
      select: { id: true, connectionStatus: true, provider: true }
    }),
    prisma.workspacePackageSubscription.findFirst({
      where: { workspaceId: input.workspaceId },
      orderBy: { startedAt: "desc" },
      select: { status: true }
    }),
    prisma.tenantFundingAccount.findUnique({
      where: { workspaceId: input.workspaceId },
      select: { billingRoute: true, verified: true }
    }),
    input.reservationId
      ? prisma.usageCreditReservation.findUnique({
          where: { id: input.reservationId },
          select: { id: true, workspaceId: true, channelId: true, status: true, expiresAt: true }
        })
      : Promise.resolve(null),
    input.reservationId
      ? prisma.whatsAppUsageLedger.findFirst({
          where: { reservationId: input.reservationId, reconciliationStatus: "RESERVED" },
          select: { id: true }
        })
      : Promise.resolve(null)
  ]);

  if (!channel || !["meta_direct", "approved_partner"].includes(channel.provider ?? "")) {
    throw new Error("WHATSAPP_CLOUD_CHANNEL_NOT_FOUND");
  }

  const failure = evaluateCloudSendGate({
    cloudEnabled: isWhatsAppCloudEnabledForWorkspace(input.workspaceId, flags),
    billingEnabled: flags.billingEnabled,
    subscriptionStatus: subscription?.status ?? null,
    connectionStatus: channel.connectionStatus,
    fundingRoute: funding?.billingRoute ?? "unconfigured",
    fundingVerified: funding?.verified ?? false,
    reservationStatus: reservation?.status ?? null,
    reservationExpired: !reservation || reservation.expiresAt.getTime() <= Date.now(),
    reservationWorkspaceId: reservation?.workspaceId ?? null,
    reservationChannelId: reservation?.channelId ?? null,
    hasPricingContext: Boolean(pricingContext),
    workspaceId: input.workspaceId,
    channelId: input.channelId
  });
  if (failure) throw new Error(failure);

  assertTransportMatchesFundingRoute({
    transport: channel.provider === "approved_partner" ? "approved_solution_partner" : "meta_direct",
    fundingRoute: funding!.billingRoute
  });
  return reservation!;
}

export async function reserveCloudUsageCredit(input: {
  workspaceId: string;
  channelId: string;
  idempotencyKey: string;
  currency: string;
  estimatedAmount: number;
  expiresAt: Date;
  category: "marketing" | "utility" | "authentication" | "service";
  destinationMarket: string;
  rateCardVersion: string;
  rateEffectiveAt: Date;
  billingPeriodKey: string;
}) {
  if (
    !input.idempotencyKey.trim() ||
    !input.destinationMarket.trim() ||
    !input.rateCardVersion.trim() ||
    !input.billingPeriodKey.trim() ||
    !Number.isFinite(input.estimatedAmount) ||
    input.estimatedAmount < 0
  ) {
    throw new Error("CLOUD_USAGE_RESERVATION_INVALID");
  }

  return prisma.$transaction(
    async (tx) => {
      const existing = await tx.usageCreditReservation.findUnique({
        where: {
          workspaceId_idempotencyKey: {
            workspaceId: input.workspaceId,
            idempotencyKey: input.idempotencyKey
          }
        }
      });
      if (existing) return existing;

      const funding = await tx.tenantFundingAccount.findUnique({ where: { workspaceId: input.workspaceId } });
      if (!funding || !funding.verified || funding.billingRoute === "unconfigured") {
        throw new Error("FUNDING_NOT_VERIFIED");
      }
      if (funding.billingCurrency !== input.currency) throw new Error("FUNDING_CURRENCY_MISMATCH");

      const outstanding = await tx.usageCreditReservation.aggregate({
        where: { fundingAccountId: funding.id, status: "RESERVED", expiresAt: { gt: new Date() } },
        _sum: { estimatedAmount: true }
      });
      const estimated = new Prisma.Decimal(input.estimatedAmount);
      const reserved = outstanding._sum.estimatedAmount ?? new Prisma.Decimal(0);
      const projectedSpend = funding.spentThisPeriod.add(reserved).add(estimated);
      if (funding.monthlyCap && projectedSpend.gt(funding.monthlyCap)) {
        throw new Error("MONTHLY_SPEND_CAP_REACHED");
      }
      if (projectedSpend.gt(funding.prepaidBalance)) throw new Error("PREPAID_CREDIT_EXHAUSTED");

      const reservation = await tx.usageCreditReservation.create({
        data: {
          workspaceId: input.workspaceId,
          channelId: input.channelId,
          fundingAccountId: funding.id,
          idempotencyKey: input.idempotencyKey,
          currency: input.currency,
          estimatedAmount: estimated,
          expiresAt: input.expiresAt
        }
      });
      await tx.whatsAppUsageLedger.create({
        data: {
          workspaceId: input.workspaceId,
          channelId: input.channelId,
          reservationId: reservation.id,
          direction: "OUTBOUND",
          category: input.category,
          destinationMarket: input.destinationMarket,
          currency: input.currency,
          rateCardVersion: input.rateCardVersion,
          rateEffectiveAt: input.rateEffectiveAt,
          estimatedCost: estimated,
          reconciliationStatus: "RESERVED",
          deliveryResult: "NOT_SENT",
          billingPeriodKey: input.billingPeriodKey
        }
      });
      return reservation;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );
}

export async function settleCloudUsageReservation(input: { reservationId: string; finalAmount: number }) {
  return prisma.$transaction(
    async (tx) => {
      const reservation = await tx.usageCreditReservation.findUnique({ where: { id: input.reservationId } });
      if (!reservation) throw new Error("CLOUD_USAGE_RESERVATION_NOT_FOUND");
      if (reservation.status === "SETTLED") return reservation;
      if (reservation.status !== "RESERVED") throw new Error("CLOUD_USAGE_RESERVATION_NOT_SETTLEABLE");
      const amount = new Prisma.Decimal(input.finalAmount);
      if (amount.isNegative()) throw new Error("CLOUD_USAGE_SETTLEMENT_INVALID");
      await tx.tenantFundingAccount.update({
        where: { id: reservation.fundingAccountId },
        data: { spentThisPeriod: { increment: amount } }
      });
      return tx.usageCreditReservation.update({
        where: { id: reservation.id },
        data: { status: "SETTLED", settledAmount: amount, settledAt: new Date() }
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );
}

export async function releaseCloudUsageReservation(reservationId: string) {
  return prisma.usageCreditReservation.updateMany({
    where: { id: reservationId, status: "RESERVED" },
    data: { status: "RELEASED", releasedAt: new Date() }
  });
}

export async function recordCloudSendAccepted(input: {
  reservationId: string;
  providerMessageId: string;
}) {
  return prisma.whatsAppUsageLedger.updateMany({
    where: { reservationId: input.reservationId, reconciliationStatus: "RESERVED" },
    data: {
      providerReference: input.providerMessageId,
      reconciliationStatus: "AWAITING_DELIVERY",
      deliveryResult: "ACCEPTED"
    }
  });
}
