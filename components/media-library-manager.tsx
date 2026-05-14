"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import { useConfirmation } from "@/components/confirmation-provider";
import { useToast } from "@/components/toast-provider";
import { MediaAssetKind } from "@/lib/db-types";
import {
  formatMediaAssetSize,
  getMediaAssetAccept,
  getMediaKindLabel,
  isPdfMimeType,
  type MediaLibraryAsset
} from "@/lib/media-library-shared";

type MediaLibraryManagerProps = {
  assets: MediaLibraryAsset[];
  limits: {
    maxItems: number;
    maxFileBytes: number;
    remainingItems: number;
  };
};

export function MediaLibraryManager({ assets, limits }: MediaLibraryManagerProps) {
  const router = useRouter();
  const { confirm } = useConfirmation();
  const { success, error: showError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [assetList, setAssetList] = useState(assets);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renamingAssetId, setRenamingAssetId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const remainingItems = Math.max(0, limits.maxItems - assetList.length);
  const groupedCounts = useMemo(
    () => ({
      image: assetList.filter((asset) => asset.kind === MediaAssetKind.IMAGE).length,
      audio: assetList.filter((asset) => asset.kind === MediaAssetKind.AUDIO).length,
      video: assetList.filter((asset) => asset.kind === MediaAssetKind.VIDEO && !isPdfMimeType(asset.mimeType)).length,
      document: assetList.filter((asset) => isPdfMimeType(asset.mimeType)).length
    }),
    [assetList]
  );

  const uploadAsset = () => {
    if (!selectedFile) {
      setError("Choose a file to upload.");
      return;
    }

    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.append("file", selectedFile);

      const response = await fetch("/api/media-library", {
        method: "POST",
        body: formData
      });
      const payload = (await response.json().catch(() => null)) as { error?: string; asset?: MediaLibraryAsset } | null;

      if (!response.ok || !payload?.asset) {
        const message = payload?.error ?? "Unable to upload media.";
        setError(message);
        showError("Upload failed", message);
        return;
      }

      setAssetList((current) => [...current, payload.asset!]);
      setSelectedFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      success("Media uploaded", `${payload.asset.title} is available for automation now.`);
      router.refresh();
    });
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
      description: `This will remove ${asset.title} from the shared library.`,
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

  return (
    <section className="media-library-layout">
      <section className="media-library-overview">
        <article className="content-card media-library-upload-card">
          <div className="card-header">
            <div>
              <h3 className="card-title">Upload media</h3>
              <p className="muted">Keep approved WhatsApp images, audio clips, videos, and PDFs here for automation reuse.</p>
            </div>
            <div className="media-library-capacity">
              <strong>{assetList.length}</strong>
              <span>{`of ${limits.maxItems} used`}</span>
            </div>
          </div>

          <div className="media-library-upload-dropzone">
            <input
              accept={getMediaAssetAccept()}
              className="inbox-hidden-file-input"
              onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
              ref={fileInputRef}
              type="file"
            />
            <div className="media-library-upload-hero">
              <strong>Drag in a file or choose one manually</strong>
              <span>Supported: image, audio, video, PDF</span>
            </div>
            <button className="button button-secondary" onClick={() => fileInputRef.current?.click()} type="button">
              Choose file
            </button>
          </div>

          <div className="media-library-upload-meta">
            <span>{`Max ${formatMediaAssetSize(limits.maxFileBytes)} each`}</span>
            <span>{remainingItems} slots left</span>
          </div>

          {selectedFile ? (
            <div className="media-library-selected-file">
              <div className="media-library-selected-file-copy">
                <strong>{selectedFile.name}</strong>
                <span>{formatMediaAssetSize(selectedFile.size)}</span>
              </div>
              <button
                className="inbox-search-tool"
                onClick={() => {
                  setSelectedFile(null);
                  if (fileInputRef.current) {
                    fileInputRef.current.value = "";
                  }
                }}
                type="button"
              >
                Remove
              </button>
            </div>
          ) : null}

          <div className="media-library-upload-actions">
            <button
              className="button button-primary"
              disabled={isPending || !selectedFile || remainingItems === 0}
              onClick={uploadAsset}
              type="button"
            >
              {isPending ? "Uploading..." : "Upload to library"}
            </button>
          </div>

          {error ? <div className="form-error">{error}</div> : null}
        </article>

        <article className="content-card media-library-summary-card">
          <div className="card-header">
            <div>
              <h3 className="card-title">Library summary</h3>
              <p className="muted">A quick view of the reusable media your team can attach to automation.</p>
            </div>
          </div>

          <div className="media-library-stats-grid">
            <div className="media-library-stat-tile">
              <span>Total assets</span>
              <strong>{assetList.length}</strong>
            </div>
            <div className="media-library-stat-tile kind-image">
              <span>Images</span>
              <strong>{groupedCounts.image}</strong>
            </div>
            <div className="media-library-stat-tile kind-audio">
              <span>Audio</span>
              <strong>{groupedCounts.audio}</strong>
            </div>
            <div className="media-library-stat-tile kind-video">
              <span>Videos</span>
              <strong>{groupedCounts.video}</strong>
            </div>
            <div className="media-library-stat-tile">
              <span>Documents</span>
              <strong>{groupedCounts.document}</strong>
            </div>
          </div>

          <div className="media-library-stats">
            <span>Shared across automation rules</span>
            <span>No inline uploads from rules</span>
            <span>Central limit control</span>
          </div>
        </article>
      </section>

      <article className="content-card media-library-collection-card">
        <div className="card-header">
          <div>
            <h3 className="card-title">Library</h3>
            <p className="muted">Reusable WhatsApp-ready assets for automation messages.</p>
          </div>
          <span className="product-catalog-count">
            {assetList.length} {assetList.length === 1 ? "asset" : "assets"}
          </span>
        </div>

        {assetList.length ? (
          <div className="media-library-grid">
            {assetList.map((asset) => (
              <article className={`media-library-card kind-${asset.kind.toLowerCase()}`} key={asset.id}>
                <div className="media-library-preview-shell">
                  <div className="media-library-card-type">
                    <span className={`pill-muted media-library-kind-pill kind-${asset.kind.toLowerCase()}`}>
                      {getMediaKindLabel(asset.kind, asset.mimeType)}
                    </span>
                  </div>
                  <div className="media-library-preview">
                  {asset.kind === MediaAssetKind.IMAGE ? (
                    <img alt={asset.title} className="media-library-preview-image" src={asset.publicUrl} />
                  ) : null}
                  {asset.kind === MediaAssetKind.AUDIO ? (
                    <audio className="media-library-preview-audio" controls preload="metadata" src={asset.publicUrl}>
                      Your browser does not support audio playback.
                    </audio>
                  ) : null}
                  {asset.kind === MediaAssetKind.VIDEO && !isPdfMimeType(asset.mimeType) ? (
                    <video className="media-library-preview-video" controls preload="metadata" src={asset.publicUrl}>
                      Your browser does not support video playback.
                    </video>
                  ) : null}
                  {isPdfMimeType(asset.mimeType) ? (
                    <a className="media-library-preview-audio" href={asset.publicUrl} rel="noreferrer" target="_blank">
                      Open PDF
                    </a>
                  ) : null}
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
                      <strong>{asset.title}</strong>
                    )}
                  </div>
                  <p className="muted">{asset.originalName}</p>
                  <div className="media-library-card-meta">
                    <span>{formatMediaAssetSize(asset.sizeBytes)}</span>
                    <span>{asset.uploadedByName ? `by ${asset.uploadedByName}` : "Uploaded"}</span>
                  </div>
                </div>

                <div className="media-library-card-actions">
                  <a className="inbox-search-tool" href={asset.publicUrl} rel="noreferrer" target="_blank">
                    Open
                  </a>
                  <button className="inbox-search-tool" onClick={() => startRename(asset)} type="button">
                    Rename
                  </button>
                  <button className="button button-secondary" onClick={() => removeAsset(asset)} type="button">
                    Delete
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="media-library-empty">
            <h3>No media uploaded yet</h3>
            <p>Upload approved images, audio, videos, and PDFs here so automation can reuse them safely.</p>
          </div>
        )}
      </article>
    </section>
  );
}
