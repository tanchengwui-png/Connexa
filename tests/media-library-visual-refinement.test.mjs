import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const page = readFileSync(join(process.cwd(), "app", "media-library", "page.tsx"), "utf8");
const manager = readFileSync(join(process.cwd(), "components", "media-library-manager.tsx"), "utf8");
const css = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");

test("media library keeps the exact operational-library title and heading", () => {
  assert.match(page, /title="Store approved WhatsApp media in one operational library\."/);
  assert.match(page, /headingAs="h1"/);
  assert.equal((manager.match(/<h2 className="card-title">/g) ?? []).length, 3);
});

test("media library preserves the existing upload and attachment flows", () => {
  assert.match(manager, /onDragEnter=/);
  assert.match(manager, /onDrop=/);
  assert.match(manager, /fileInputRef/);
  assert.match(manager, /uploadMediaLibraryFileWithProgress/);
  assert.match(manager, /<AttachmentPreview/);
  assert.match(manager, /openLabel="Open attachment"/);
  assert.match(manager, /fit="contain"/);
  assert.match(manager, /aria-label="Choose a media file to upload"/);
  assert.match(manager, />\s*Choose file\s*<\/button>/s);
});

test("media library renders storage details once with accessible progress", () => {
  assert.equal((manager.match(/\{storageHeadline\}/g) ?? []).length, 1);
  assert.match(manager, /role="progressbar"/);
  assert.match(manager, /aria-valuenow=\{usedStorageBytes\}/);
  assert.match(manager, /\{storageRemainingLabel\}/);
});

test("media asset rows retain metadata and file-specific Rename/Delete actions", () => {
  assert.match(manager, /getAssetExtension\(asset\)/);
  assert.match(manager, /formatAssetUploadedAt\(asset\.createdAtIso\)/);
  assert.match(manager, /aria-label=\{`Rename \$\{asset\.title\}`\}/);
  assert.match(manager, /aria-label=\{`Delete \$\{asset\.title\}`\}/);
  assert.match(manager, /This will remove \$\{asset\.originalName \|\| asset\.title\} from the shared library\./);
});

test("media library refinement uses contained panels, a single drop zone, and borderless metrics", () => {
  assert.match(css, /\.media-library-page \.media-library-content \{[\s\S]*scroll-padding-top: var\(--app-header-height, 5rem\);/);
  assert.match(css, /\.media-library-page \.media-library-upload-dropzone \{[\s\S]*border: 1px dashed/);
  assert.match(css, /\.media-library-page \.media-library-upload-hero \{[\s\S]*border: 0;[\s\S]*background: transparent;/);
  assert.match(css, /\.media-library-page \.media-library-stat-tile \{[\s\S]*border: 0;[\s\S]*background: transparent;[\s\S]*box-shadow: none;/);
  assert.match(css, /\.media-library-page \.media-library-preview \.attachment-preview-open/);
  assert.match(css, /@media \(max-width: 680px\) \{[\s\S]*\.media-library-page \.media-library-list-item \{[\s\S]*grid-template-columns: 1fr;/);
});

test("media library keeps the desktop drop zone horizontal and the asset row compact", () => {
  assert.match(css, /\.media-library-page \.media-library-upload-dropzone \{[\s\S]*display: flex;[\s\S]*justify-content: space-between;/);
  assert.match(css, /\.media-library-page \.media-library-overview \{[\s\S]*grid-template-columns: minmax\(0, 1\.35fr\) minmax\(320px, 0\.9fr\);/);
  assert.match(css, /\.media-library-page \.media-library-list-item \{[\s\S]*grid-template-columns: 7rem minmax\(0, 1fr\) 5\.25rem minmax\(9rem, 10\.5rem\) auto;/);
  assert.match(css, /@media \(max-width: 780px\) \{[\s\S]*\.media-library-page \.media-library-upload-dropzone \{[\s\S]*flex-direction: column;/);
});

test("media library panel headers keep a consistent border-safe gutter", () => {
  assert.match(manager, /card-header media-panel-header/);
  assert.match(manager, /media-library-capacity media-storage-summary/);
  assert.match(manager, /card-header media-summary-header/);
  assert.match(manager, /media-library-collection-head media-library-header/);
  assert.match(css, /media-library-upload-card,[\s\S]*media-library-summary-card \{[\s\S]*padding: 18px;/);
  assert.match(css, /\.media-panel-header,[\s\S]*margin: 0 0 16px;[\s\S]*border: 0;/);
  assert.match(css, /\.media-summary-header \{[\s\S]*margin-bottom: 16px;/);
  assert.match(css, /media-library-stat-tile \{[\s\S]*padding: 0;[\s\S]*border: 0;[\s\S]*background: transparent;/);
  assert.match(css, /@media \(max-width: 640px\) \{[\s\S]*padding: 16px;/);
});
