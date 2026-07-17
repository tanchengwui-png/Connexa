import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AttachmentPreview } from "../components/attachment-preview";
import { getAttachmentPreviewDescriptor } from "../lib/attachment-preview";

test("attachment preview detection prefers MIME type first", () => {
  const descriptor = getAttachmentPreviewDescriptor({
    fileName: "report.pdf",
    mimeType: "image/png",
    url: "/uploads/report.pdf"
  });

  assert.equal(descriptor.kind, "image");
  assert.equal(descriptor.label, "Image");
});

test("attachment preview detection falls back to file extension", () => {
  const descriptor = getAttachmentPreviewDescriptor({
    fileName: "voice-note.ogg",
    mimeType: null,
    url: null
  });

  assert.equal(descriptor.kind, "audio");
  assert.equal(descriptor.extension, ".ogg");
});

test("attachment preview detection classifies office docs as documents", () => {
  const descriptor = getAttachmentPreviewDescriptor({
    fileName: "proposal.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    url: "/uploads/proposal.docx"
  });

  assert.equal(descriptor.kind, "document");
  assert.equal(descriptor.label, "Document");
});

test("attachment preview renders audio player and open button", () => {
  const markup = renderToStaticMarkup(
    React.createElement(AttachmentPreview, {
      fileName: "call.ogg",
      mimeType: "audio/ogg",
      sizeLabel: "2 MB",
      url: "/uploads/call.ogg"
    })
  );

  assert.match(markup, /<audio/);
  assert.match(markup, /Open attachment/);
  assert.match(markup, /call\.ogg/);
});

test("attachment preview renders document fallback card when no URL is available", () => {
  const markup = renderToStaticMarkup(
    React.createElement(AttachmentPreview, {
      fileName: "missing.pdf",
      mimeType: "application/pdf",
      url: null
    })
  );

  assert.match(markup, /Attachment unavailable/);
  assert.match(markup, /missing\.pdf/);
});
