import {
  ensurePlatformPackageConfigStore,
  findPlatformPackageConfigs,
  upsertPlatformPackageConfig
} from "@/lib/db-auth";
import {
  defaultVisiblePublicPackageKeys,
  isPublicPackageKey,
  publicPackageKeys,
  publicPackages,
  type PublicPackageKey
} from "@/lib/public-packages";
import {
  calculatePackagePricing,
  formatPackageAmount,
  parseYearlyDiscountPercentage,
  PACKAGE_BILLING_PERIOD
} from "@/lib/package-pricing";

type PlatformPackageSettingsInput = {
  packageKey: PublicPackageKey;
  isVisible: boolean;
  displayOrder: number;
  priceAmount: number | null;
  yearlyDiscountPercentage: number;
  mediaLibraryStorageLimitBytes: number | null;
  maxOutboundMessages: number | null;
  maxActiveContacts: number | null;
  maxActiveAutomations: number | null;
  maxWhatsAppCampaigns: number | null;
};

function isMissingPlatformPackageTableError(error: unknown) {
  return (
    error instanceof Error &&
    (error.message.includes('relation "PlatformPackageConfig" does not exist') ||
      error.message.includes('column "platformId" does not exist') ||
      error.message.includes('column "priceAmount" does not exist') ||
      error.message.includes('column "yearlyDiscountPercentage" does not exist') ||
      error.message.includes('column "mediaLibraryStorageLimitBytes" does not exist') ||
      error.message.includes('column "maxOutboundMessages" does not exist') ||
      error.message.includes('column "maxActiveContacts" does not exist') ||
      error.message.includes('column "maxActiveAutomations" does not exist') ||
      error.message.includes('column "maxWhatsAppCampaigns" does not exist'))
  );
}

function getDefaultPackageSettings() {
  return publicPackageKeys.map((packageKey, index) => ({
    packageKey,
    isVisible: defaultVisiblePublicPackageKeys.includes(packageKey),
    displayOrder: index,
      priceAmount: publicPackages[packageKey].priceAmount,
      yearlyDiscountPercentage: 0,
      mediaLibraryStorageLimitBytes: publicPackages[packageKey].limits.mediaLibraryStorageLimitBytes,
      maxOutboundMessages: publicPackages[packageKey].limits.maxOutboundMessages,
    maxActiveContacts: publicPackages[packageKey].limits.maxActiveContacts,
    maxActiveAutomations: publicPackages[packageKey].limits.maxActiveAutomations,
    maxWhatsAppCampaigns: publicPackages[packageKey].limits.maxWhatsAppCampaigns
  }));
}

export async function getPlatformPackageSettings() {
  try {
    return mapPackageSettings(await findPlatformPackageConfigs());
  } catch (error) {
    if (isMissingPlatformPackageTableError(error)) {
      await ensurePlatformPackageConfigStore();
      return mapPackageSettings(await findPlatformPackageConfigs());
    }

    throw error;
  }
}

export async function getVisiblePublicPackages() {
  const settings = await getPlatformPackageSettings();

  return settings
    .filter((item) => item.isVisible)
    .sort((left, right) => left.displayOrder - right.displayOrder)
    .slice(0, 3)
    .map((item) => ({
      key: item.packageKey,
      ...mergePackageDefinition(item.packageKey, item.priceAmount, item.yearlyDiscountPercentage)
    }));
}

export async function getPlatformPackageAdminView() {
  const settings = await getPlatformPackageSettings();

  return settings
    .sort((left, right) => left.displayOrder - right.displayOrder)
    .map((item) => ({
      packageKey: item.packageKey,
      isVisible: item.isVisible,
      displayOrder: item.displayOrder,
      priceAmount: item.priceAmount,
      yearlyDiscountPercentage: item.yearlyDiscountPercentage,
      mediaLibraryStorageLimitBytes: item.mediaLibraryStorageLimitBytes,
      maxOutboundMessages: item.maxOutboundMessages,
      maxActiveContacts: item.maxActiveContacts,
      maxActiveAutomations: item.maxActiveAutomations,
      maxWhatsAppCampaigns: item.maxWhatsAppCampaigns,
      package: mergePackageDefinition(item.packageKey, item.priceAmount, item.yearlyDiscountPercentage)
    }));
}

export async function getResolvedPublicPackageDefinition(packageKey: PublicPackageKey) {
  const settings = await getPlatformPackageSettings();
  const config = settings.find((item) => item.packageKey === packageKey);
  return mergePackageDefinition(packageKey, config?.priceAmount, config?.yearlyDiscountPercentage);
}

export async function savePlatformPackageSettings(input: PlatformPackageSettingsInput[]) {
  const seen = new Set<string>();
  let visibleCount = 0;

  for (const item of input) {
    if (!isPublicPackageKey(item.packageKey)) {
      throw new Error("Invalid package key.");
    }

    if (seen.has(item.packageKey)) {
      throw new Error("Duplicate package key.");
    }

    if (item.isVisible) {
      visibleCount += 1;
    }

    if (!Number.isInteger(item.displayOrder) || item.displayOrder < 0) {
      throw new Error("Display order must be a non-negative integer.");
    }

    if (item.priceAmount !== null && (!Number.isFinite(item.priceAmount) || item.priceAmount < 0)) {
      throw new Error("Package price must be a non-negative amount or left blank for custom billing.");
    }

    parseYearlyDiscountPercentage(item.yearlyDiscountPercentage);

    if (
      item.mediaLibraryStorageLimitBytes !== null &&
      (!Number.isInteger(item.mediaLibraryStorageLimitBytes) || item.mediaLibraryStorageLimitBytes < 0)
    ) {
      throw new Error("Media Library storage limit must be a non-negative whole number of bytes or unlimited.");
    }

    if (
      item.maxOutboundMessages !== null &&
      (!Number.isInteger(item.maxOutboundMessages) || item.maxOutboundMessages < 0)
    ) {
      throw new Error("Message limit must be a non-negative integer or unlimited.");
    }

    if (
      item.maxActiveContacts !== null &&
      (!Number.isInteger(item.maxActiveContacts) || item.maxActiveContacts < 0)
    ) {
      throw new Error("Active contacts limit must be a non-negative integer or unlimited.");
    }

    if (
      item.maxActiveAutomations !== null &&
      (!Number.isInteger(item.maxActiveAutomations) || item.maxActiveAutomations < 0)
    ) {
      throw new Error("Active automations limit must be a non-negative integer or unlimited.");
    }

    if (
      item.maxWhatsAppCampaigns !== null &&
      (!Number.isInteger(item.maxWhatsAppCampaigns) || item.maxWhatsAppCampaigns < 0)
    ) {
      throw new Error("WhatsApp campaigns limit must be a non-negative integer or unlimited.");
    }

    seen.add(item.packageKey);
  }

  if (visibleCount > 3) {
    throw new Error("A maximum of 3 packages can be visible on the public packages page.");
  }

  for (const packageKey of publicPackageKeys) {
    if (!seen.has(packageKey)) {
      throw new Error("Every package must be configured.");
    }
  }

  try {
    for (const item of input) {
      await upsertPlatformPackageConfig({
        packageKey: item.packageKey,
        isVisible: item.isVisible,
        displayOrder: item.displayOrder,
        priceAmount: item.priceAmount === null ? null : item.priceAmount.toFixed(2),
        yearlyDiscountPercentage: item.yearlyDiscountPercentage.toFixed(2),
        mediaLibraryStorageLimitBytes: item.mediaLibraryStorageLimitBytes,
        maxOutboundMessages: item.maxOutboundMessages,
        maxActiveContacts: item.maxActiveContacts,
        maxActiveAutomations: item.maxActiveAutomations,
        maxWhatsAppCampaigns: item.maxWhatsAppCampaigns
      });
    }
  } catch (error) {
    if (isMissingPlatformPackageTableError(error)) {
      await ensurePlatformPackageConfigStore();

      for (const item of input) {
        await upsertPlatformPackageConfig({
          packageKey: item.packageKey,
          isVisible: item.isVisible,
          displayOrder: item.displayOrder,
          priceAmount: item.priceAmount === null ? null : item.priceAmount.toFixed(2),
          yearlyDiscountPercentage: item.yearlyDiscountPercentage.toFixed(2),
          mediaLibraryStorageLimitBytes: item.mediaLibraryStorageLimitBytes,
          maxOutboundMessages: item.maxOutboundMessages,
          maxActiveContacts: item.maxActiveContacts,
          maxActiveAutomations: item.maxActiveAutomations,
          maxWhatsAppCampaigns: item.maxWhatsAppCampaigns
        });
      }

      return;
    }

    throw error;
  }
}

function mapPackageSettings(
  configs: Array<{
    packageKey: string;
    isVisible: boolean;
    displayOrder: number;
    priceAmount: string | null;
    yearlyDiscountPercentage: string | null;
    mediaLibraryStorageLimitBytes: number | string | null;
    maxOutboundMessages: number | null;
    maxActiveContacts: number | null;
    maxActiveAutomations: number | null;
    maxWhatsAppCampaigns: number | null;
  }>
) {
  const configMap = new Map(configs.map((config) => [config.packageKey, config]));

  return publicPackageKeys.map((packageKey, index) => {
    const config = configMap.get(packageKey);
    return {
      packageKey,
      isVisible: config?.isVisible ?? defaultVisiblePublicPackageKeys.includes(packageKey),
      displayOrder: config?.displayOrder ?? index,
      priceAmount: config ? parseOptionalPriceAmount(config.priceAmount) : publicPackages[packageKey].priceAmount,
      yearlyDiscountPercentage: config ? parseOptionalPercentage(config.yearlyDiscountPercentage) : 0,
      mediaLibraryStorageLimitBytes:
        parseOptionalStorageLimit(config?.mediaLibraryStorageLimitBytes) ??
        publicPackages[packageKey].limits.mediaLibraryStorageLimitBytes,
      maxOutboundMessages: config?.maxOutboundMessages ?? publicPackages[packageKey].limits.maxOutboundMessages,
      maxActiveContacts: config?.maxActiveContacts ?? publicPackages[packageKey].limits.maxActiveContacts,
      maxActiveAutomations: config?.maxActiveAutomations ?? publicPackages[packageKey].limits.maxActiveAutomations,
      maxWhatsAppCampaigns: config?.maxWhatsAppCampaigns ?? publicPackages[packageKey].limits.maxWhatsAppCampaigns
    };
  });
}

function parseOptionalPriceAmount(value: string | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : null;
}

function parseOptionalPercentage(value: string | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return 0;
  }

  return parseYearlyDiscountPercentage(value);
}

function parseOptionalStorageLimit(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const normalized = Number(value);

  if (!Number.isFinite(normalized) || !Number.isInteger(normalized) || normalized < 0) {
    throw new Error("Stored media library storage limit is invalid.");
  }

  return normalized;
}

function mergePackageDefinition(
  packageKey: PublicPackageKey,
  priceAmountOverride: number | null | undefined,
  yearlyDiscountPercentageOverride: number | undefined
) {
  const pkg = publicPackages[packageKey];
  const resolvedPriceAmount = priceAmountOverride === undefined ? pkg.priceAmount : priceAmountOverride;
  const yearlyDiscountPercentage = parseYearlyDiscountPercentage(yearlyDiscountPercentageOverride ?? 0);
  const pricing = calculatePackagePricing(resolvedPriceAmount, yearlyDiscountPercentage, pkg.currency);

  return {
    ...pkg,
    monthlyPriceAmount: resolvedPriceAmount,
    yearlyDiscountPercentage,
    pricing,
    priceAmount: resolvedPriceAmount,
    price: formatPackagePrice(resolvedPriceAmount, pkg.currency, PACKAGE_BILLING_PERIOD.MONTHLY)
  };
}

function formatPackagePrice(
  priceAmount: number | null,
  currency: string | null,
  billingPeriod: "MONTHLY" | "YEARLY" | null
) {
  return formatPackageAmount(priceAmount, currency, billingPeriod);
}
