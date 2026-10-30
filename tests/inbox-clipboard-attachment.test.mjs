import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const composer = readFileSync(join(root, "components", "inbox", "reply-composer.tsx"), "utf8");
const uploadRoute = readFileSync(join(root, "app", "api", "inbox", "uploads", "route.ts"), "utf8");
const mediaLibrary = readFileSync(join(root, "lib", "media-library.ts"), "utf8");

test("WhatsApp reply textbox uploads pasted clipboard attachments", () => {
  assert.match(composer, /onPaste=\{handleAttachmentPaste\}/);
  assert.match(composer, /event\.clipboardData\.items/);
  assert.match(composer, /item\.kind === "file"/);
  assert.match(composer, /event\.clipboardData\.files/);
  assert.match(composer, /event\.preventDefault\(\);[\s\S]*void uploadFiles\(pastedFiles\)/);
});

test("plain text paste and internal notes keep the browser's default paste behavior", () => {
  assert.match(composer, /if \(isInternalNote\) \{\s*return;\s*\}/);
  assert.match(composer, /if \(!pastedFiles\.length\) \{\s*return;\s*\}/);
});

test("pasted attachments use the quota-counted Inbox Media Library upload path", () => {
  assert.match(composer, /xhr\.open\("POST", "\/api\/inbox\/uploads"\)/);
  assert.match(uploadRoute, /createWorkspaceMediaAssets\(\{/);
  assert.match(uploadRoute, /sourceModule: MediaAssetSource\.INBOX/);
  assert.match(mediaLibrary, /lockedWorkspace\.mediaLibraryUsedBytes \+ totalRequestedBytes > usageLimit/);
  assert.match(mediaLibrary, /mediaLibraryUsedBytes: \{\s*increment: totalRequestedBytes/);
});
