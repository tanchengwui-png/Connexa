import {
  createPlatformDiscountCode,
  deletePlatformDiscountCode,
  ensurePendingWorkspaceCheckoutDiscountColumns,
  ensurePlatformDiscountCodeStore,
  findPlatformDiscountCodeByCode,
  findPlatformDiscountCodeById,
  findPlatformDiscountCodes,
  findPlatformDiscountCodeByCodeForUpdate,
  redeemPlatformDiscountCode,
  updatePlatformDiscountCode
} from "@/lib/db-auth";
import { type DbExecutor } from "@/lib/db";

type DiscountCodeInput = {
  code: string;
  percentage: number;
  expiresOn?: string | null;
};

function normalizeDiscountCode(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

function parsePercentage(value: number) {
  if (!Number.isInteger(value) || value < 1 || value > 99) {
    throw new Error("Discount percentage must be an integer from 1 to 99.");
  }

  return value;
}

function parseExpiryDate(value: string | null | undefined) {
  const normalized = value?.trim() ?? "";

  if (!normalized) {
    return null;
  }

  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    throw new Error("Expiry date must use YYYY-MM-DD format.");
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));

  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error("Expiry date is invalid.");
  }

  return date;
}

function formatExpiryDateInput(value: Date | null) {
  if (!value) {
    return "";
  }

  return value.toISOString().slice(0, 10);
}

function parseDecimalAmount(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : null;
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

function formatCurrencyAmount(amount: number, currency: string | null, billingPeriod: "MONTHLY" | "YEARLY" | null) {
  const formattedAmount = new Intl.NumberFormat("en-MY", {
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2
  }).format(amount);
  const currencyPrefix = currency === "MYR" || !currency ? "RM" : `${currency} `;
  const periodSuffix = billingPeriod === "YEARLY" ? "/yr" : billingPeriod === "MONTHLY" ? "/mo" : "";

  return `${currencyPrefix}${formattedAmount}${periodSuffix}`;
}

function validateDiscountCodeInput(input: DiscountCodeInput) {
  const code = normalizeDiscountCode(input.code);

  if (code.length < 4 || code.length > 32 || !/^[A-Z0-9-]+$/.test(code)) {
    throw new Error("Discount code must be 4-32 characters using only letters, numbers, or hyphens.");
  }

  return {
    code,
    percentage: parsePercentage(input.percentage),
    expiresAt: parseExpiryDate(input.expiresOn)
  };
}

export async function getPlatformDiscountAdminView() {
  await ensurePlatformDiscountCodeStore();

  const now = Date.now();
  const rows = await findPlatformDiscountCodes();
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    percentage: row.percentage,
    expiresAtIso: row.expiresAt?.toISOString() ?? null,
    expiresOn: formatExpiryDateInput(row.expiresAt),
    redeemedAtIso: row.redeemedAt?.toISOString() ?? null,
    redeemedByName: row.redeemedByName,
    redeemedByEmail: row.redeemedByEmail,
    redeemedByWorkspaceName: row.redeemedByWorkspaceName,
    isRedeemed: Boolean(row.redeemedAt),
    isInactive: Boolean(row.redeemedAt) || (row.expiresAt ? row.expiresAt.getTime() < now : false),
    isExpired: row.expiresAt ? row.expiresAt.getTime() < now : false,
    createdAtIso: row.createdAt.toISOString(),
    updatedAtIso: row.updatedAt.toISOString()
  }));
}

export async function createPlatformDiscount(input: DiscountCodeInput) {
  await ensurePlatformDiscountCodeStore();

  const payload = validateDiscountCodeInput(input);
  const existing = await findPlatformDiscountCodeByCode(payload.code);
  if (existing) {
    throw new Error("Discount code already exists.");
  }

  return createPlatformDiscountCode(payload);
}

export async function updatePlatformDiscount(
  id: string,
  input: DiscountCodeInput
) {
  await ensurePlatformDiscountCodeStore();

  const current = await findPlatformDiscountCodeById(id);
  if (!current) {
    throw new Error("Discount code not found.");
  }

  const payload = validateDiscountCodeInput(input);
  const duplicate = await findPlatformDiscountCodeByCode(payload.code);
  if (duplicate && duplicate.id !== id) {
    throw new Error("Discount code already exists.");
  }

  return updatePlatformDiscountCode({
    id,
    code: payload.code,
    percentage: payload.percentage,
    expiresAt: payload.expiresAt
  });
}

export async function removePlatformDiscount(id: string) {
  await ensurePlatformDiscountCodeStore();

  const deleted = await deletePlatformDiscountCode(id);
  if (!deleted) {
    throw new Error("Discount code not found.");
  }

  return deleted;
}

export async function resolveCheckoutDiscount(input: {
  code?: string | null;
  amount: number;
  currency: string | null;
  billingPeriod: "MONTHLY" | "YEARLY" | null;
}) {
  await ensurePlatformDiscountCodeStore();

  const normalizedCode = normalizeDiscountCode(input.code ?? "");
  if (!normalizedCode) {
    return {
      code: null,
      percentage: null,
      originalAmount: roundCurrency(input.amount),
      discountAmount: 0,
      finalAmount: roundCurrency(input.amount),
      currency: input.currency,
      formattedOriginalAmount: formatCurrencyAmount(roundCurrency(input.amount), input.currency, input.billingPeriod),
      formattedDiscountAmount: formatCurrencyAmount(0, input.currency, null),
      formattedFinalAmount: formatCurrencyAmount(roundCurrency(input.amount), input.currency, input.billingPeriod)
    };
  }

  const match = await findPlatformDiscountCodeByCode(normalizedCode);
  if (!match) {
    throw new Error("Discount code is invalid.");
  }

  if (match.expiresAt && match.expiresAt.getTime() < Date.now()) {
    throw new Error("Discount code has expired.");
  }

  if (match.redeemedAt) {
    throw new Error("Discount code has already been used.");
  }

  const originalAmount = roundCurrency(input.amount);
  const discountAmount = roundCurrency((originalAmount * match.percentage) / 100);
  const finalAmount = roundCurrency(Math.max(0, originalAmount - discountAmount));

  return {
    code: match.code,
    percentage: match.percentage,
    originalAmount,
    discountAmount,
    finalAmount,
    currency: input.currency,
    formattedOriginalAmount: formatCurrencyAmount(originalAmount, input.currency, input.billingPeriod),
    formattedDiscountAmount: formatCurrencyAmount(discountAmount, input.currency, null),
    formattedFinalAmount: formatCurrencyAmount(finalAmount, input.currency, input.billingPeriod)
  };
}

export async function ensureCheckoutDiscountSupport() {
  await ensurePendingWorkspaceCheckoutDiscountColumns();
}

export async function recordSuccessfulDiscountRedemption(
  input: {
    code: string;
    redeemedByName?: string | null;
    redeemedByEmail?: string | null;
    redeemedByWorkspaceName?: string | null;
    redeemedAt?: Date | null;
  },
  executor: DbExecutor
) {
  const normalizedCode = normalizeDiscountCode(input.code ?? "");
  if (!normalizedCode) {
    return null;
  }

  const discount = await findPlatformDiscountCodeByCodeForUpdate(normalizedCode, executor);
  if (!discount || discount.redeemedAt) {
    return discount;
  }

  return redeemPlatformDiscountCode(
    {
      id: discount.id,
      redeemedAt: input.redeemedAt ?? new Date(),
      redeemedByName: input.redeemedByName ?? null,
      redeemedByEmail: input.redeemedByEmail ?? null,
      redeemedByWorkspaceName: input.redeemedByWorkspaceName ?? null,
      executor
    }
  );
}

export function getCheckoutAmountSnapshot(input: {
  originalAmount: number | string | null | undefined;
  finalAmount: number | string | null | undefined;
}) {
  const originalAmount = parseDecimalAmount(input.originalAmount);
  const finalAmount = parseDecimalAmount(input.finalAmount);

  return {
    originalAmount,
    finalAmount
  };
}
