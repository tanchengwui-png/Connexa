import { MediaAssetKind, type MediaAssetKind as MediaAssetKindValue } from "@/lib/db-types";

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

export function formatMediaAssetSize(sizeBytes: number) {
  if (sizeBytes >= 1024 * 1024) {
    return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  if (sizeBytes >= 1024) {
    return `${Math.round(sizeBytes / 1024)} KB`;
  }

  return `${sizeBytes} B`;
}

export function isPdfMimeType(mimeType?: string | null) {
  return mimeType?.trim().toLowerCase() === "application/pdf";
}

export function getMediaKindLabel(kind: MediaAssetKindValue, mimeType?: string | null) {
  if (isPdfMimeType(mimeType)) {
    return "PDF";
  }

  if (kind === MediaAssetKind.IMAGE) {
    return "Image";
  }

  if (kind === MediaAssetKind.AUDIO) {
    return "Audio";
  }

  return "Video";
}

export function getMediaAssetAccept() {
  return "image/*,audio/*,video/*,application/pdf";
}
