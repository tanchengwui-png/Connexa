const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".svg"]);
const AUDIO_EXTENSIONS = new Set([".mp3", ".ogg", ".wav", ".m4a", ".aac", ".opus", ".flac"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".webm", ".3gp", ".mkv", ".m4v"]);
const PDF_EXTENSIONS = new Set([".pdf"]);
const DOCUMENT_EXTENSIONS = new Set([
  ".doc",
  ".docx",
  ".eml",
  ".msg",
  ".htm",
  ".html",
  ".json",
  ".xml",
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
]);

const OFFICE_MIME_PREFIXES = [
  "application/vnd.openxmlformats-officedocument",
  "application/vnd.ms-",
  "application/msword"
];

const DOCUMENT_MIME_TYPES = new Set([
  "message/rfc822",
  "application/vnd.ms-outlook",
  "text/html",
  "application/json",
  "application/xml",
  "text/xml",
  "text/plain",
  "text/csv",
  "text/rtf",
  "application/rtf",
  "application/zip",
  "application/x-zip-compressed",
  "application/vnd.rar",
  "application/x-rar-compressed",
  "application/x-7z-compressed"
]);

export type AttachmentPreviewKind = "image" | "audio" | "video" | "pdf" | "document" | "file";

export type AttachmentPreviewDescriptor = {
  kind: AttachmentPreviewKind;
  extension: string | null;
  mimeType: string | null;
  label: string;
};

export function getAttachmentPreviewDescriptor(input: {
  fileName?: string | null;
  mimeType?: string | null;
  url?: string | null;
}): AttachmentPreviewDescriptor {
  const mimeType = normalizeMimeType(input.mimeType);
  const extension = getAttachmentExtension(input.fileName, input.url);
  const kind = detectAttachmentPreviewKind(mimeType, extension);

  return {
    kind,
    extension,
    mimeType,
    label: getAttachmentPreviewLabel(kind)
  };
}

export function normalizeMimeType(value?: string | null) {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (!normalized) {
    return null;
  }

  return normalized.split(";")[0]?.trim() || null;
}

export function getAttachmentExtension(fileName?: string | null, url?: string | null) {
  const candidates = [fileName, extractFileNameFromUrl(url)];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    const extension = extractExtension(candidate);
    if (extension) {
      return extension;
    }
  }

  return null;
}

export function getAttachmentPreviewLabel(kind: AttachmentPreviewKind) {
  switch (kind) {
    case "image":
      return "Image";
    case "audio":
      return "Audio";
    case "video":
      return "Video";
    case "pdf":
      return "PDF";
    case "document":
      return "Document";
    case "file":
    default:
      return "File";
  }
}

function detectAttachmentPreviewKind(
  mimeType: string | null,
  extension: string | null
): AttachmentPreviewKind {
  if (mimeType?.startsWith("image/")) {
    return "image";
  }

  if (mimeType?.startsWith("audio/")) {
    return "audio";
  }

  if (mimeType?.startsWith("video/")) {
    return "video";
  }

  if (mimeType === "application/pdf") {
    return "pdf";
  }

  if (mimeType && isDocumentMimeType(mimeType)) {
    return "document";
  }

  if (extension && IMAGE_EXTENSIONS.has(extension)) {
    return "image";
  }

  if (extension && AUDIO_EXTENSIONS.has(extension)) {
    return "audio";
  }

  if (extension && VIDEO_EXTENSIONS.has(extension)) {
    return "video";
  }

  if (extension && PDF_EXTENSIONS.has(extension)) {
    return "pdf";
  }

  if (extension && DOCUMENT_EXTENSIONS.has(extension)) {
    return "document";
  }

  return "file";
}

function isDocumentMimeType(mimeType: string) {
  return (
    OFFICE_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix)) ||
    DOCUMENT_MIME_TYPES.has(mimeType)
  );
}

function extractFileNameFromUrl(value?: string | null) {
  if (!value) {
    return null;
  }

  try {
    const parsed = new URL(value, "http://localhost");
    const pathname = parsed.pathname || "";
    const fileName = pathname.split("/").pop()?.trim() ?? "";
    return fileName || null;
  } catch {
    const pathname = value.split("?")[0]?.split("#")[0] ?? "";
    const fileName = pathname.split("/").pop()?.trim() ?? "";
    return fileName || null;
  }
}

function extractExtension(value: string) {
  const trimmedValue = value.trim().toLowerCase();

  if (!trimmedValue) {
    return null;
  }

  const lastDotIndex = trimmedValue.lastIndexOf(".");
  if (lastDotIndex <= 0 || lastDotIndex === trimmedValue.length - 1) {
    return null;
  }

  return trimmedValue.slice(lastDotIndex);
}
