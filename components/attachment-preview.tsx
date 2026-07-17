"use client";

import { useEffect, useMemo, useState } from "react";
import { AttachmentIcon } from "@/components/inbox/icons";
import {
  getAttachmentExtension,
  getAttachmentPreviewDescriptor,
  type AttachmentPreviewKind
} from "@/lib/attachment-preview";
import { resolveMediaAssetUrl, toClientMediaUrl } from "@/lib/media-library-urls";

type AttachmentPreviewProps = {
  url?: string | null;
  mimeType?: string | null;
  fileName?: string | null;
  sizeLabel?: string | null;
  openLabel?: string;
  className?: string;
  frameClassName?: string;
  fit?: "contain" | "cover";
};

export function AttachmentPreview({
  url,
  mimeType,
  fileName,
  sizeLabel = null,
  openLabel = "Open attachment",
  className = "",
  frameClassName = "",
  fit = "contain"
}: AttachmentPreviewProps) {
  const descriptor = useMemo(
    () => getAttachmentPreviewDescriptor({ fileName, mimeType, url }),
    [fileName, mimeType, url]
  );
  const [previewError, setPreviewError] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const resolvedUrl = useMemo(() => getPreviewSourceUrl(url), [url]);
  const fileExtension = getAttachmentExtension(fileName, url);
  const metaLabel = [descriptor.label, formatExtension(fileExtension), sizeLabel].filter(Boolean).join(" · ");
  const previewKind = previewError ? "file" : descriptor.kind;

  useEffect(() => {
    setPreviewError(false);
  }, [fileName, mimeType, url]);

  useEffect(() => {
    if (!resolvedUrl || !isBlobPreviewKind(descriptor.kind) || !canUseFetchedPreview(resolvedUrl)) {
      setPreviewUrl(null);
      return;
    }

    let active = true;
    let objectUrl: string | null = null;
    setPreviewUrl(null);

    fetch(resolvedUrl, {
      credentials: "same-origin"
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Attachment preview fetch failed with status ${response.status}`);
        }

        const blob = await response.blob();
        if (!active) {
          return;
        }

        objectUrl = URL.createObjectURL(blob);
        setPreviewUrl(objectUrl);
      })
      .catch(() => {
        if (!active) {
          return;
        }
        setPreviewError(true);
        setPreviewUrl(null);
      });

    return () => {
      active = false;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [descriptor.kind, resolvedUrl]);

  return (
    <div className={`attachment-preview attachment-preview-${previewKind} ${className}`.trim()}>
      <div
        className={`attachment-preview-frame attachment-preview-fit-${fit} ${frameClassName}`.trim()}
      >
        {resolvedUrl ? (
          renderPreview({
            descriptorKind: descriptor.kind,
            metaLabel,
            fileName,
            kind: previewKind,
            onPreviewError: () => setPreviewError(true),
            resolvedUrl: previewUrl ?? resolvedUrl
          })
        ) : (
          <AttachmentFileCard
            description="Attachment preview is unavailable right now."
            fileName={fileName}
            isUnavailable
            metaLabel={metaLabel || "Missing attachment URL"}
          />
        )}
      </div>

      <div className="attachment-preview-footer">
        <div className="attachment-preview-copy">
          <strong>{fileName?.trim() || "Attachment"}</strong>
          <span>{metaLabel || "Unknown file type"}</span>
        </div>
        {resolvedUrl ? (
          <a
            className="attachment-preview-open"
            href={resolvedUrl}
            rel="noopener noreferrer"
            target="_blank"
          >
            {openLabel}
          </a>
        ) : (
          <span className="attachment-preview-open is-disabled">Attachment unavailable</span>
        )}
      </div>
    </div>
  );
}

function renderPreview(input: {
  descriptorKind: AttachmentPreviewKind;
  metaLabel: string;
  kind: AttachmentPreviewKind;
  resolvedUrl: string;
  fileName?: string | null;
  onPreviewError: () => void;
}) {
  switch (input.kind) {
    case "image":
      return (
        <img
          alt={input.fileName?.trim() || "Attachment preview"}
          className="attachment-preview-media"
          loading="lazy"
          onError={input.onPreviewError}
          src={input.resolvedUrl}
        />
      );
    case "audio":
      return (
        <audio
          className="attachment-preview-media attachment-preview-audio"
          controls
          onError={input.onPreviewError}
          preload="metadata"
          src={input.resolvedUrl}
        >
          Your browser does not support audio playback.
        </audio>
      );
    case "video":
      return (
        <video
          className="attachment-preview-media"
          controls
          onError={input.onPreviewError}
          playsInline
          preload="metadata"
          src={input.resolvedUrl}
        >
          Your browser does not support video playback.
        </video>
      );
    case "pdf":
      return (
        <object
          className="attachment-preview-document"
          data={input.resolvedUrl}
          onError={input.onPreviewError}
          type="application/pdf"
        >
          <AttachmentFileCard
            description="PDF preview is not available in this browser."
            fileName={input.fileName}
            metaLabel="PDF document"
          />
        </object>
      );
    case "document":
      return (
        <AttachmentFileCard
          description="This document opens in a new tab."
          fileName={input.fileName}
          metaLabel="Document preview"
        />
      );
    case "file":
    default:
      return renderFallbackCard({
        fileName: input.fileName,
        kind: input.descriptorKind,
        metaLabel: input.metaLabel
      });
  }
}

function renderFallbackCard(input: {
  kind: AttachmentPreviewKind;
  fileName?: string | null;
  metaLabel: string;
}) {
  return (
    <AttachmentFileCard
      description={getFallbackDescription(input.kind)}
      fileName={input.fileName}
      metaLabel={input.metaLabel}
    />
  );
}

function AttachmentFileCard({
  fileName,
  metaLabel,
  description,
  isUnavailable = false
}: {
  fileName?: string | null;
  metaLabel: string;
  description: string;
  isUnavailable?: boolean;
}) {
  return (
    <div className={`attachment-preview-file-card${isUnavailable ? " is-unavailable" : ""}`}>
      <span className="attachment-preview-file-icon">
        <AttachmentIcon />
      </span>
      <div className="attachment-preview-file-copy">
        <strong>{fileName?.trim() || "Attachment"}</strong>
        <span>{metaLabel}</span>
        <p>{description}</p>
      </div>
    </div>
  );
}

function formatExtension(value: string | null) {
  if (!value) {
    return null;
  }

  return value.replace(/^\./, "").toUpperCase();
}

function getFallbackDescription(kind: AttachmentPreviewKind) {
  switch (kind) {
    case "audio":
      return "Audio preview is unavailable right now. Open the attachment in a new tab.";
    case "image":
      return "Image preview is unavailable right now. Open the attachment in a new tab.";
    case "video":
      return "Video preview is unavailable right now. Open the attachment in a new tab.";
    case "pdf":
      return "PDF preview is unavailable in this browser. Open the attachment in a new tab.";
    case "document":
      return "This document opens in a new tab.";
    case "file":
    default:
      return "Preview is not available for this file type. Open the attachment in a new tab.";
  }
}

function isBlobPreviewKind(kind: AttachmentPreviewKind) {
  return kind === "image" || kind === "audio" || kind === "video" || kind === "pdf";
}

function getPreviewSourceUrl(url?: string | null) {
  if (!url) {
    return null;
  }

  if (typeof window === "undefined") {
    return resolveMediaAssetUrl(url);
  }

  try {
    const clientUrl = toClientMediaUrl(url);
    const parsed = new URL(clientUrl, window.location.origin);
    if (parsed.origin === window.location.origin) {
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
    return clientUrl;
  } catch {
    return toClientMediaUrl(url);
  }
}

function canUseFetchedPreview(url: string) {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.origin === window.location.origin;
  } catch {
    return false;
  }
}
