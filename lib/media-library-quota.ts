import type { MediaLibraryUsage } from "@/lib/media-library-shared";

export function buildMediaUsageSummary(input: {
  totalAssets: number;
  imageCount: number;
  audioCount: number;
  videoCount: number;
  documentCount: number;
  usedStorageBytes: number;
  storageLimitBytes: number | null;
  hasStorageLimitConfigured: boolean;
  maxFileBytes: number;
}): MediaLibraryUsage {
  const storageLimitBytes = input.storageLimitBytes;
  const isStorageUnlimited = storageLimitBytes === null;
  const remainingStorageBytes = isStorageUnlimited
    ? null
    : Math.max(storageLimitBytes - input.usedStorageBytes, 0);
  const storageUsagePercentage =
    storageLimitBytes && storageLimitBytes > 0
      ? Math.min(100, Math.round((input.usedStorageBytes / storageLimitBytes) * 100))
      : isStorageUnlimited
        ? null
        : 0;

  return {
    totalAssets: input.totalAssets,
    imageCount: input.imageCount,
    audioCount: input.audioCount,
    videoCount: input.videoCount,
    documentCount: input.documentCount,
    usedStorageBytes: input.usedStorageBytes,
    storageLimitBytes,
    remainingStorageBytes,
    storageUsagePercentage,
    isStorageUnlimited,
    hasStorageLimitConfigured: input.hasStorageLimitConfigured,
    maxFileBytes: input.maxFileBytes
  };
}

export function buildMediaStorageExceededMessage(input: {
  usedStorageBytes: number | string;
  storageLimitBytes: number | string;
  requestedUploadBytes: number | string;
}) {
  return `Upload failed because this workspace does not have enough Media Library storage. Used: ${input.usedStorageBytes} of ${input.storageLimitBytes}. Selected files: ${input.requestedUploadBytes}.`;
}
