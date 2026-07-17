import path from "path";
import { MediaAssetKind } from "@/lib/db-types";

export const INBOX_UPLOAD_LIMITS = {
  IMAGE: 10 * 1024 * 1024,
  DOCUMENT: 20 * 1024 * 1024,
  AUDIO: 20 * 1024 * 1024,
  VIDEO: 50 * 1024 * 1024
} as const;

export const SUPPORTED_IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".gif"] as const;
export const SUPPORTED_VIDEO_EXTENSIONS = [".mp4", ".mov", ".webm", ".3gp", ".mkv"] as const;
export const SUPPORTED_AUDIO_EXTENSIONS = [".mp3", ".ogg", ".wav", ".m4a", ".aac", ".opus", ".webm"] as const;
export const SUPPORTED_DOCUMENT_EXTENSIONS = [
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".csv",
  ".ppt",
  ".pptx",
  ".txt",
  ".rtf",
  ".zip",
  ".rar",
  ".7z"
] as const;

export const INBOX_UPLOAD_LIMITS_HELPER =
  "Upload limits: Images 10MB | Documents 20MB | Audio 20MB | Video 50MB";

export const UNSUPPORTED_UPLOAD_ERROR =
  "Unsupported file type. Supported images: jpg, jpeg, png, webp, gif. Videos: mp4, mov, webm, 3gp, mkv. Audio: mp3, ogg, wav, m4a, aac, opus, webm. Documents: pdf, doc, docx, xls, xlsx, csv, ppt, pptx, txt, rtf, zip, rar, 7z.";

export const UPLOAD_PROXY_LIMIT_ERROR =
  "Upload is blocked by the server size limit before the app can process it. Increase nginx client_max_body_size to at least 60M.";

const EXTENSION_KIND_MAP: Record<string, keyof typeof INBOX_UPLOAD_LIMITS> = {
  ".jpg": "IMAGE",
  ".jpeg": "IMAGE",
  ".png": "IMAGE",
  ".webp": "IMAGE",
  ".gif": "IMAGE",
  ".pdf": "DOCUMENT",
  ".doc": "DOCUMENT",
  ".docx": "DOCUMENT",
  ".xls": "DOCUMENT",
  ".xlsx": "DOCUMENT",
  ".csv": "DOCUMENT",
  ".ppt": "DOCUMENT",
  ".pptx": "DOCUMENT",
  ".txt": "DOCUMENT",
  ".rtf": "DOCUMENT",
  ".zip": "DOCUMENT",
  ".rar": "DOCUMENT",
  ".7z": "DOCUMENT",
  ".mp3": "AUDIO",
  ".ogg": "AUDIO",
  ".wav": "AUDIO",
  ".m4a": "AUDIO",
  ".aac": "AUDIO",
  ".opus": "AUDIO",
  ".mp4": "VIDEO",
  ".mov": "VIDEO",
  ".webm": "VIDEO",
  ".3gp": "VIDEO",
  ".mkv": "VIDEO"
};

const MIME_KIND_MAP: Record<string, keyof typeof INBOX_UPLOAD_LIMITS> = {
  "image/jpeg": "IMAGE",
  "image/gif": "IMAGE",
  "image/png": "IMAGE",
  "image/webp": "IMAGE",
  "application/pdf": "DOCUMENT",
  "application/msword": "DOCUMENT",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOCUMENT",
  "application/vnd.ms-excel": "DOCUMENT",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "DOCUMENT",
  "application/vnd.ms-powerpoint": "DOCUMENT",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "DOCUMENT",
  "text/csv": "DOCUMENT",
  "text/plain": "DOCUMENT",
  "application/rtf": "DOCUMENT",
  "text/rtf": "DOCUMENT",
  "application/zip": "DOCUMENT",
  "application/x-zip-compressed": "DOCUMENT",
  "application/vnd.rar": "DOCUMENT",
  "application/x-rar-compressed": "DOCUMENT",
  "application/x-7z-compressed": "DOCUMENT",
  "audio/mpeg": "AUDIO",
  "audio/mp3": "AUDIO",
  "audio/ogg": "AUDIO",
  "audio/opus": "AUDIO",
  "audio/wav": "AUDIO",
  "audio/x-wav": "AUDIO",
  "audio/mp4": "AUDIO",
  "audio/x-m4a": "AUDIO",
  "audio/aac": "AUDIO",
  "audio/webm": "AUDIO",
  "video/mp4": "VIDEO",
  "video/quicktime": "VIDEO",
  "video/webm": "VIDEO",
  "video/3gpp": "VIDEO",
  "video/x-matroska": "VIDEO",
  "application/x-matroska": "VIDEO"
};

export function inferInboxUploadKind(fileName: string, mimeType: string | null | undefined) {
  const normalizedMimeType = (mimeType ?? "").trim().toLowerCase();
  const normalizedExtension = path.extname(fileName).trim().toLowerCase();
  return MIME_KIND_MAP[normalizedMimeType] ?? EXTENSION_KIND_MAP[normalizedExtension] ?? null;
}

export function toMediaAssetKind(kind: keyof typeof INBOX_UPLOAD_LIMITS) {
  switch (kind) {
    case "IMAGE":
      return MediaAssetKind.IMAGE;
    case "AUDIO":
      return MediaAssetKind.AUDIO;
    case "VIDEO":
      return MediaAssetKind.VIDEO;
    case "DOCUMENT":
      return MediaAssetKind.DOCUMENT;
  }
}

export function validateInboxUploadFile(input: {
  fileName: string;
  mimeType: string | null | undefined;
  sizeBytes: number;
}) {
  const kind = inferInboxUploadKind(input.fileName, input.mimeType);
  if (!kind) {
    throw new Error(UNSUPPORTED_UPLOAD_ERROR);
  }

  if (input.sizeBytes > INBOX_UPLOAD_LIMITS[kind]) {
    throw new Error("File exceeds maximum upload size.");
  }

  return kind;
}

export function sanitizeUploadedFileName(fileName: string) {
  const extension = path.extname(fileName);
  const baseName = path.basename(fileName, extension).replace(/[^a-zA-Z0-9-_ ]/g, "").trim();
  return `${baseName || "upload"}${extension.toLowerCase()}`;
}

export function isVoiceMimeType(mimeType: string | null | undefined) {
  const normalizedMimeType = (mimeType ?? "").trim().toLowerCase();
  return normalizedMimeType === "audio/ogg" || normalizedMimeType === "audio/opus";
}
