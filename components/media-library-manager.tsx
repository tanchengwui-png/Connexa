"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import { AttachmentPreview } from "@/components/attachment-preview";
import { useConfirmation } from "@/components/confirmation-provider";
import { useToast } from "@/components/toast-provider";
import { MediaAssetKind } from "@/lib/db-types";
import { INBOX_UPLOAD_LIMITS, UPLOAD_PROXY_LIMIT_ERROR, validateInboxUploadFile } from "@/lib/inbox-upload";
import { buildMediaStorageExceededMessage } from "@/lib/media-library-quota";
import {
  formatMediaAssetSize,
  getMediaAssetAccept,
  getMediaKindLabel,
  isAudioMimeType,
  isDocumentMimeType,
  type MediaLibraryAsset
} from "@/lib/media-library-shared";

type MediaLibraryManagerProps = {
  assets: MediaLibraryAsset[];
  limits: {
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
};

export function MediaLibraryManager({ assets, limits }: MediaLibraryManagerProps) {
  const router = useRouter();
  const { confirm } = useConfirmation();
  const { success, error: showError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [assetList, setAssetList] = useState(assets);
  const [isDragActive, setIsDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [renamingAssetId, setRenamingAssetId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const usedStorageBytes = useMemo(
    () => assetList.reduce((sum, asset) => sum + asset.sizeBytes, 0),
    [assetList]
  );
  const remainingStorageBytes =
    limits.remainingStorageBytes === null ? null : Math.max((limits.storageLimitBytes ?? 0) - usedStorageBytes, 0);
  const storageUsagePercentage =
    limits.storageLimitBytes && limits.storageLimitBytes > 0
      ? Math.min(100, Math.round((usedStorageBytes / limits.storageLimitBytes) * 100))
      : limits.isStorageUnlimited
        ? null
        : 0;
  const selectedFileExceedsRemainingStorage =
    selectedFile && remainingStorageBytes !== null ? selectedFile.size > remainingStorageBytes : false;
  const selectedFileValidationError = useMemo(() => {
    if (!selectedFile) return null;
    try {
      validateInboxUploadFile({
        fileName: selectedFile.name,
        mimeType: selectedFile.type,
        sizeBytes: selectedFile.size
      });
      return selectedFileExceedsRemainingStorage
        ? buildStorageExceededMessage(usedStorageBytes, limits.storageLimitBytes, selectedFile.size)
        : null;
    } catch (validationError) {
      return validationError instanceof Error ? validationError.message : "This file cannot be uploaded.";
    }
  }, [limits.storageLimitBytes, selectedFile, selectedFileExceedsRemainingStorage, usedStorageBytes]);
  const groupedCounts = useMemo(
    () => ({
      image: assetList.filter((asset) => asset.kind === MediaAssetKind.IMAGE).length,
      audio: assetList.filter((asset) => isAudioMimeType(asset.mimeType) || asset.kind === MediaAssetKind.AUDIO).length,
      video: assetList.filter((asset) => asset.kind === MediaAssetKind.VIDEO && !isDocumentMimeType(asset.mimeType)).length,
      document: assetList.filter((asset) => isDocumentMimeType(asset.mimeType)).length
    }),
    [assetList]
  );
  const storageHeadline = limits.isStorageUnlimited
    ? `${formatMediaAssetSize(usedStorageBytes)} used`
    : limits.storageLimitBytes !== null
      ? `${formatMediaAssetSize(usedStorageBytes)} of ${formatMediaAssetSize(limits.storageLimitBytes)} used`
      : "Storage limit unavailable";
  const storageRemainingLabel = limits.isStorageUnlimited
    ? "Unlimited storage"
    : remainingStorageBytes !== null
      ? `${formatMediaAssetSize(remainingStorageBytes)} remaining`
      : "Unlimited storage";

  const uploadAsset = async () => {
    if (!selectedFile) {
      setError("Choose a file to upload.");
      return;
    }

    if (selectedFileValidationError) {
      setError(selectedFileValidationError);
      return;
    }

    setError(null);
    setUploadProgress(0);

    try {
      const payload = await uploadMediaLibraryFileWithProgress(selectedFile, setUploadProgress);
      setAssetList((current) => [...current, payload.asset]);
      setSelectedFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      success("Media uploaded", `${payload.asset.title} is available for automation now.`);
      router.refresh();
    } catch (uploadError) {
      const message = uploadError instanceof Error ? uploadError.message : "Unable to upload media.";
      setError(message);
      showError("Upload failed", message);
    } finally {
      setUploadProgress(null);
    }
  };

  const startRename = (asset: MediaLibraryAsset) => {
    setError(null);
    setRenamingAssetId(asset.id);
    setRenameDraft(asset.title);
  };

  const cancelRename = () => {
    setRenamingAssetId(null);
    setRenameDraft("");
  };

  const saveRename = (assetId: string) => {
    const nextTitle = renameDraft.trim();
    if (!nextTitle) {
      setError("Media name is required.");
      return;
    }

    setError(null);
    startTransition(async () => {
      const response = await fetch(`/api/media-library/${assetId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          title: nextTitle
        })
      });
      const payload = (await response.json().catch(() => null)) as { error?: string; asset?: MediaLibraryAsset } | null;

      if (!response.ok || !payload?.asset) {
        const message = payload?.error ?? "Unable to rename media.";
        setError(message);
        showError("Rename failed", message);
        return;
      }

      setAssetList((current) => current.map((item) => (item.id === assetId ? payload.asset! : item)));
      setRenamingAssetId(null);
      setRenameDraft("");
      success("Media renamed", `${payload.asset.title} has been updated.`);
      router.refresh();
    });
  };

  const removeAsset = async (asset: MediaLibraryAsset) => {
    const accepted = await confirm({
      title: "Delete media asset?",
      description: `This will remove ${asset.originalName || asset.title} from the shared library.`,
      confirmLabel: "Delete media",
      tone: "danger"
    });

    if (!accepted) {
      return;
    }

    setError(null);
    startTransition(async () => {
      const response = await fetch(`/api/media-library/${asset.id}`, {
        method: "DELETE"
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;

      if (!response.ok) {
        const message = payload?.error ?? "Unable to delete media.";
        setError(message);
        showError("Delete failed", message);
        return;
      }

      setAssetList((current) => current.filter((item) => item.id !== asset.id));
      success("Media deleted", `${asset.title} has been removed from the library.`);
      router.refresh();
    });
  };

  const selectFile = (file: File | null) => {
    setSelectedFile(file);
    setError(null);
  };

  return (
    <section className="media-library-layout media-library-content">
      <section className="media-library-overview">
        <article className="content-card media-library-upload-card">
          <div className="card-header media-panel-header">
            <div>
              <h2 className="card-title">Upload media</h2>
              <p className="muted">Keep approved WhatsApp images, audio clips, videos, and documents here for automation reuse.</p>
            </div>
            <div className="media-library-capacity media-storage-summary">
              <span>Storage used</span>
              <strong>{storageHeadline}</strong>
            </div>
          </div>

          <div
            className={`media-library-upload-dropzone${isDragActive ? " dragging" : ""}${selectedFile ? " filled" : ""}${selectedFileValidationError ? " invalid" : ""}`}
            aria-label="Choose a media file to upload"
            onClick={() => fileInputRef.current?.click()}
            onDragEnter={(event) => {
              event.preventDefault();
              setIsDragActive(true);
            }}
            onDragLeave={(event) => {
              event.preventDefault();
              if (event.currentTarget === event.target) {
                setIsDragActive(false);
              }
            }}
            onDragOver={(event) => {
              event.preventDefault();
              setIsDragActive(true);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setIsDragActive(false);
              selectFile(event.dataTransfer.files?.[0] ?? null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                fileInputRef.current?.click();
              }
            }}
            role="button"
            tabIndex={0}
          >
            <input
              accept={getMediaAssetAccept()}
              aria-label="Choose a media file to upload"
              className="inbox-hidden-file-input"
              onChange={(event) => selectFile(event.target.files?.[0] ?? null)}
              ref={fileInputRef}
              type="file"
            />
            <div className="media-library-upload-hero media-dropzone__copy">
              <strong>Drag files here or choose a file</strong>
              <span>Supported: images, videos, audio, and documents.</span>
            </div>
            <button
              className="button button-secondary"
              onClick={(event) => {
                event.stopPropagation();
                fileInputRef.current?.click();
              }}
              type="button"
            >
              Choose file
            </button>
          </div>

          <div className="media-library-upload-meta">
            <span>
              Images {formatMediaAssetSize(INBOX_UPLOAD_LIMITS.IMAGE)} · Documents {formatMediaAssetSize(INBOX_UPLOAD_LIMITS.DOCUMENT)} · Audio {formatMediaAssetSize(INBOX_UPLOAD_LIMITS.AUDIO)} · Videos {formatMediaAssetSize(INBOX_UPLOAD_LIMITS.VIDEO)}
            </span>
          </div>

          {!limits.isStorageUnlimited && limits.storageLimitBytes !== null ? (
            <div
              aria-label="Media Library storage usage"
              aria-valuemax={limits.storageLimitBytes}
              aria-valuemin={0}
              aria-valuenow={usedStorageBytes}
              className="media-library-storage-meter"
              role="progressbar"
            >
              <div className="media-library-storage-meter-bar" aria-hidden="true">
                <span style={{ width: `${Math.max(storageUsagePercentage ?? 0, assetList.length ? 4 : 0)}%` }} />
              </div>
              <div className="media-library-storage-meter-copy">
                <span>{storageRemainingLabel}</span>
              </div>
            </div>
          ) : null}

          {selectedFile ? (
            <>
              <div className="media-library-selected-file">
                <div className="media-library-selected-file-copy">
                  <strong>{selectedFile.name}</strong>
                  <span>
                    {getSelectedFileTypeLabel(selectedFile)} · {formatMediaAssetSize(selectedFile.size)} · {selectedFileValidationError ? "Needs attention" : "Ready to upload"}
                  </span>
                </div>
                <button
                  className="inbox-search-tool"
                  onClick={() => {
                    selectFile(null);
                    if (fileInputRef.current) {
                      fileInputRef.current.value = "";
                    }
                  }}
                  type="button"
                >
                  Remove
                </button>
              </div>
              {selectedFileValidationError ? <div className="form-error" role="alert">{selectedFileValidationError}</div> : null}
            </>
          ) : null}

          {uploadProgress !== null ? (
            <div className="inbox-upload-progress-list" role="status">
              <div className="inbox-upload-progress-item">
                <div className="inbox-upload-progress-copy">
                  <strong>
                    <span className="inbox-upload-spinner" aria-hidden="true" />
                    {selectedFile?.name ?? "Uploading media"}
                  </strong>
                  <span>{Math.max(0, Math.min(100, uploadProgress))}% uploaded</span>
                </div>
                <div className="inbox-upload-progress-bar">
                  <span style={{ width: `${Math.max(6, uploadProgress)}%` }} />
                </div>
              </div>
            </div>
          ) : null}

          <div className="media-library-upload-actions">
            <button
              className="button button-primary"
              disabled={
                isPending ||
                uploadProgress !== null ||
                !selectedFile ||
                Boolean(selectedFileValidationError)
              }
              onClick={() => {
                void uploadAsset();
              }}
              type="button"
            >
              {uploadProgress !== null ? "Uploading..." : "Upload to library"}
            </button>
          </div>

          {error ? <div className="form-error">{error}</div> : null}
        </article>

        <article className="content-card media-library-summary-card">
          <div className="card-header media-summary-header">
            <div>
              <h2 className="card-title">Library summary</h2>
              <p className="muted">A quick view of the reusable media your team can attach to automation.</p>
            </div>
          </div>

          <div className="media-library-stats-grid">
            <div className="media-library-stat-tile">
              <strong>{assetList.length}</strong>
              <span>Total assets</span>
            </div>
            <div className="media-library-stat-tile kind-image">
              <strong>{groupedCounts.image}</strong>
              <span>Images</span>
            </div>
            <div className="media-library-stat-tile kind-audio">
              <strong>{groupedCounts.audio}</strong>
              <span>Audio</span>
            </div>
            <div className="media-library-stat-tile kind-video">
              <strong>{groupedCounts.video}</strong>
              <span>Videos</span>
            </div>
            <div className="media-library-stat-tile">
              <strong>{groupedCounts.document}</strong>
              <span>Documents</span>
            </div>
          </div>

          <p className="media-library-summary-note">Assets are shared across automation rules and quick replies.</p>
        </article>
      </section>

      <article className="content-card media-library-collection-card">
        <div className="card-header media-library-collection-head media-library-header">
          <div>
            <h2 className="card-title">Library</h2>
            <p className="muted">Reusable WhatsApp-ready assets for automation messages.</p>
          </div>
          <span className="product-catalog-count">
            {assetList.length} {assetList.length === 1 ? "asset" : "assets"}
          </span>
        </div>

        {assetList.length ? (
          <ul className="media-library-list">
            {assetList.map((asset) => (
              <li className={`media-library-list-item kind-${asset.kind.toLowerCase()}`} key={asset.id}>
                <div className="media-library-preview-shell">
                  <div className="media-library-card-type">
                    <span className={`pill-muted media-library-kind-pill kind-${asset.kind.toLowerCase()}`}>
                      {getMediaKindLabel(asset.kind, asset.mimeType)}
                    </span>
                  </div>
                  <div className="media-library-preview">
                    <AttachmentPreview
                      fileName={asset.originalName || asset.title}
                      fit="contain"
                      mimeType={asset.mimeType}
                      openLabel="Open attachment"
                      sizeLabel={formatMediaAssetSize(asset.sizeBytes)}
                      url={asset.publicUrl}
                    />
                  </div>
                </div>

                <div className="media-library-card-copy">
                  <div className="media-library-card-head">
                    {renamingAssetId === asset.id ? (
                      <div className="media-library-rename-inline">
                        <input
                          className="lead-record-input media-library-rename-input"
                          onChange={(event) => setRenameDraft(event.target.value)}
                          value={renameDraft}
                        />
                        <div className="media-library-rename-actions">
                          <button className="inbox-search-tool" onClick={() => saveRename(asset.id)} type="button">
                            Save
                          </button>
                          <button className="inbox-search-tool" onClick={cancelRename} type="button">
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <strong title={asset.title}>{asset.title}</strong>
                    )}
                  </div>
                  {asset.originalName && asset.originalName !== asset.title ? <p className="muted" title={asset.originalName}>{asset.originalName}</p> : null}
                  <div className="media-library-card-meta">
                    <span>{getMediaKindLabel(asset.kind, asset.mimeType)} · {getAssetExtension(asset)}</span>
                  </div>
                </div>

                <div className="media-library-card-size">{formatMediaAssetSize(asset.sizeBytes)}</div>
                <div className="media-library-card-upload">
                  <span>{asset.uploadedByName ?? "—"}</span>
                  <span>{formatAssetUploadedAt(asset.createdAtIso)}</span>
                </div>

                <div className="media-library-card-actions">
                  <button aria-label={`Rename ${asset.title}`} className="button button-secondary media-library-action-rename" disabled={isPending} onClick={() => startRename(asset)} type="button">
                    Rename
                  </button>
                  <button aria-label={`Delete ${asset.title}`} className="button button-secondary media-library-action-delete" disabled={isPending} onClick={() => removeAsset(asset)} type="button">
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="media-library-empty">
            <h3>No media uploaded yet</h3>
            <p>Upload approved images, audio, videos, and documents here so automation can reuse them safely.</p>
          </div>
        )}
      </article>
    </section>
  );
}

function getAssetExtension(asset: MediaLibraryAsset) {
  const source = asset.originalName || asset.title;
  const extension = source.split(".").pop()?.trim();
  return extension && extension !== source ? extension.toUpperCase() : asset.mimeType;
}

function getSelectedFileTypeLabel(file: File) {
  const extension = file.name.split(".").pop()?.trim();
  return extension ? extension.toUpperCase() : "File";
}

function formatAssetUploadedAt(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "Date unavailable";
  return new Intl.DateTimeFormat("en-MY", {
    dateStyle: "medium",
    timeZone: "Asia/Kuala_Lumpur"
  }).format(new Date(timestamp));
}

function uploadMediaLibraryFileWithProgress(file: File, onProgress: (progress: number) => void) {
  return new Promise<{ asset: MediaLibraryAsset }>((resolve, reject) => {
    const formData = new FormData();
    formData.append("file", file);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/media-library");

    xhr.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable) {
        return;
      }

      onProgress(Math.round((event.loaded / event.total) * 100));
    });

    xhr.addEventListener("load", () => {
      if (xhr.status === 413) {
        reject(new Error(UPLOAD_PROXY_LIMIT_ERROR));
        return;
      }

      try {
        const payload = JSON.parse(xhr.responseText || "{}") as { asset?: MediaLibraryAsset; error?: string };
        if (xhr.status >= 200 && xhr.status < 300 && payload.asset) {
          onProgress(100);
          resolve({ asset: payload.asset });
          return;
        }

        reject(new Error(payload.error || "Unable to upload media."));
      } catch {
        reject(new Error("Unable to upload media."));
      }
    });

    xhr.addEventListener("error", () => reject(new Error("Unable to upload media.")));
    xhr.send(formData);
  });
}

function buildStorageExceededMessage(usedStorageBytes: number, storageLimitBytes: number | null, requestedUploadBytes: number) {
  if (storageLimitBytes === null) {
    return "Upload failed because this workspace does not have enough Media Library storage.";
  }

  return buildMediaStorageExceededMessage({
    usedStorageBytes: formatForDisplay(usedStorageBytes),
    storageLimitBytes: formatForDisplay(storageLimitBytes),
    requestedUploadBytes: formatForDisplay(requestedUploadBytes)
  });
}

function formatForDisplay(sizeBytes: number) {
  return formatMediaAssetSize(sizeBytes);
}
