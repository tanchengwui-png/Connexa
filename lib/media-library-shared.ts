import { MediaAssetKind, type MediaAssetKind as MediaAssetKindValue } from "@/lib/db-types";
import {
  SUPPORTED_AUDIO_EXTENSIONS,
  SUPPORTED_DOCUMENT_EXTENSIONS,
  SUPPORTED_IMAGE_EXTENSIONS,
  SUPPORTED_VIDEO_EXTENSIONS
} from "@/lib/inbox-upload";

export type MediaLibraryAsset = {
  id: string;
  title: string;
  originalName: string;
  publicUrl: string;
  mimeType: string;
  kind: MediaAssetKindValue;
  sizeBytes: number;
  uploadedByName: string | null;
  createdAtIso: string;
};

export type MediaLibraryUsage = {
  totalAssets: number;
  imageCount: number;
  audioCount: number;
  videoCount: number;
  documentCount: number;
  usedStorageBytes: number;
  storageLimitBytes: number | null;
  remainingStorageBytes: number | null;
  storageUsagePercentage: number | null;
  isStorageUnlimited: boolean;
  hasStorageLimitConfigured: boolean;
  maxFileBytes: number;
};

export function formatMediaAssetSize(sizeBytes: number) {
  if (sizeBytes >= 1024 * 1024 * 1024) {
    const size = sizeBytes / (1024 * 1024 * 1024);
    return `${size >= 10 ? size.toFixed(0) : size.toFixed(1)} GB`;
  }

  if (sizeBytes >= 1024 * 1024) {
    const size = sizeBytes / (1024 * 1024);
    return `${size >= 10 ? size.toFixed(0) : size.toFixed(1)} MB`;
  }

  if (sizeBytes >= 1024) {
    const size = sizeBytes / 1024;
    return `${size >= 10 ? size.toFixed(0) : size.toFixed(1)} KB`;
  }

  return `${sizeBytes} B`;
}

export function isPdfMimeType(mimeType?: string | null) {
  return mimeType?.trim().toLowerCase() === "application/pdf";
}

export function isAudioMimeType(mimeType?: string | null) {
  const normalizedMimeType = mimeType?.trim().toLowerCase() ?? "";
  return normalizedMimeType.startsWith("audio/");
}

export function isDocumentMimeType(mimeType?: string | null) {
  const normalizedMimeType = mimeType?.trim().toLowerCase() ?? "";
  return [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "text/csv",
    "text/plain",
    "application/rtf",
    "text/rtf",
    "application/zip",
    "application/x-zip-compressed",
    "application/vnd.rar",
    "application/x-rar-compressed",
    "application/x-7z-compressed"
  ].includes(normalizedMimeType);
}

export function getMediaKindLabel(kind: MediaAssetKindValue, mimeType?: string | null) {
  if (isDocumentMimeType(mimeType) || kind === MediaAssetKind.DOCUMENT) {
    return "Document";
  }

  if (isAudioMimeType(mimeType) || kind === MediaAssetKind.AUDIO) {
    return "Audio";
  }

  if (kind === MediaAssetKind.IMAGE) {
    return "Image";
  }

  return "Video";
}

export function getMediaAssetAccept() {
  return [
    ...SUPPORTED_IMAGE_EXTENSIONS,
    ...SUPPORTED_VIDEO_EXTENSIONS,
    ...SUPPORTED_AUDIO_EXTENSIONS,
    ...SUPPORTED_DOCUMENT_EXTENSIONS
  ].join(",");
}
