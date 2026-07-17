import { Decimal } from "@prisma/client/runtime/client";
import { prisma } from "@/lib/prisma";

type MessageUsageProvider = "personal" | "cloud";
type MessageUsageType = "text" | "template" | "media" | "interactive" | "unknown";

type RecordMessageUsageInput = {
  workspaceId: string;
  accountId?: string | null;
  provider: MessageUsageProvider;
  messageType: MessageUsageType;
  costEstimate?: number | string | Decimal | null;
  timestamp?: Date | null;
};

type MessageUsageSummaryInput = {
  workspaceId: string;
  accountId?: string | null;
  provider?: MessageUsageProvider | null;
  from?: Date | null;
  to?: Date | null;
};

function normalizeCostEstimate(value: RecordMessageUsageInput["costEstimate"]) {
  if (value == null) {
    return new Decimal(0);
  }

  if (value instanceof Decimal) {
    return value;
  }

  const normalized = typeof value === "string" ? Number.parseFloat(value) : Number(value);
  return Number.isFinite(normalized) ? new Decimal(normalized.toFixed(4)) : new Decimal(0);
}

export function estimateWhatsAppMessageCost(input: {
  provider: MessageUsageProvider;
  messageType: MessageUsageType;
}) {
  const envKey = `WHATSAPP_${input.provider.toUpperCase()}_${input.messageType.toUpperCase()}_COST`;
  const configured = Number.parseFloat(process.env[envKey] ?? "");

  if (Number.isFinite(configured) && configured >= 0) {
    return configured;
  }

  return 0;
}

export async function recordMessageUsage(input: RecordMessageUsageInput) {
  return prisma.messageUsageLog.create({
    data: {
      workspaceId: input.workspaceId,
      accountId: input.accountId ?? null,
      provider: input.provider,
      messageType: input.messageType,
      costEstimate: normalizeCostEstimate(input.costEstimate),
      timestamp: input.timestamp ?? new Date()
    }
  });
}

export async function getWorkspaceMessageUsageSummary(input: MessageUsageSummaryInput) {
  const where = {
    workspaceId: input.workspaceId,
    ...(input.accountId ? { accountId: input.accountId } : {}),
    ...(input.provider ? { provider: input.provider } : {}),
    timestamp: {
      ...(input.from ? { gte: input.from } : {}),
    ...(input.to ? { lte: input.to } : {})
    }
  };

  const [totals, groupedByProvider, groupedByMessageType, groupedByAccount] = await Promise.all([
    prisma.messageUsageLog.aggregate({
      where,
      _count: { _all: true },
      _sum: { costEstimate: true }
    }),
    prisma.messageUsageLog.groupBy({
      by: ["provider"],
      where,
      _count: { _all: true },
      _sum: { costEstimate: true }
    }),
    prisma.messageUsageLog.groupBy({
      by: ["messageType"],
      where,
      _count: { _all: true },
      _sum: { costEstimate: true }
    }),
    prisma.messageUsageLog.groupBy({
      by: ["accountId"],
      where,
      _count: { _all: true },
      _sum: { costEstimate: true }
    })
  ]);

  return {
    workspaceId: input.workspaceId,
    totalMessages: totals._count._all,
    totalCostEstimate: totals._sum.costEstimate?.toNumber() ?? 0,
    byProvider: groupedByProvider.map((entry: (typeof groupedByProvider)[number]) => ({
      provider: entry.provider,
      totalMessages: entry._count._all,
      totalCostEstimate: entry._sum.costEstimate?.toNumber() ?? 0
    })),
    byMessageType: groupedByMessageType.map((entry: (typeof groupedByMessageType)[number]) => ({
      messageType: entry.messageType,
      totalMessages: entry._count._all,
      totalCostEstimate: entry._sum.costEstimate?.toNumber() ?? 0
    })),
    byAccount: groupedByAccount.map((entry: (typeof groupedByAccount)[number]) => ({
      accountId: entry.accountId,
      totalMessages: entry._count._all,
      totalCostEstimate: entry._sum.costEstimate?.toNumber() ?? 0
    }))
  };
}

export async function getCustomerMessageUsageReport(input: {
  workspaceId: string;
  accountId: string;
  from?: Date | null;
  to?: Date | null;
}) {
  return getWorkspaceMessageUsageSummary({
    workspaceId: input.workspaceId,
    accountId: input.accountId,
    from: input.from ?? null,
    to: input.to ?? null
  });
}
