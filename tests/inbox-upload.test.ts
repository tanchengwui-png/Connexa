import assert from "node:assert/strict";
import test from "node:test";
import {
  INBOX_UPLOAD_LIMITS,
  inferInboxUploadKind,
  isVoiceMimeType,
  sanitizeUploadedFileName,
  validateInboxUploadFile
} from "../lib/inbox-upload";

test("image upload validation accepts supported image files", () => {
  assert.equal(inferInboxUploadKind("photo.jpg", "image/jpeg"), "IMAGE");
  assert.equal(
    validateInboxUploadFile({
      fileName: "photo.jpg",
      mimeType: "image/jpeg",
      sizeBytes: INBOX_UPLOAD_LIMITS.IMAGE
    }),
    "IMAGE"
  );
});

test("document upload validation accepts supported document files", () => {
  assert.equal(inferInboxUploadKind("contacts.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"), "DOCUMENT");
  assert.equal(
    validateInboxUploadFile({
      fileName: "contacts.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      sizeBytes: INBOX_UPLOAD_LIMITS.DOCUMENT
    }),
    "DOCUMENT"
  );
});

test("audio upload validation accepts supported audio files", () => {
  assert.equal(inferInboxUploadKind("note.ogg", "audio/ogg"), "AUDIO");
  assert.equal(
    validateInboxUploadFile({
      fileName: "note.ogg",
      mimeType: "audio/ogg",
      sizeBytes: INBOX_UPLOAD_LIMITS.AUDIO
    }),
    "AUDIO"
  );
});

test("video upload validation accepts supported video files", () => {
  assert.equal(inferInboxUploadKind("clip.mp4", "video/mp4"), "VIDEO");
  assert.equal(
    validateInboxUploadFile({
      fileName: "clip.mp4",
      mimeType: "video/mp4",
      sizeBytes: INBOX_UPLOAD_LIMITS.VIDEO
    }),
    "VIDEO"
  );
});

test("oversized uploads are rejected", () => {
  assert.throws(
    () =>
      validateInboxUploadFile({
        fileName: "oversized.png",
        mimeType: "image/png",
        sizeBytes: INBOX_UPLOAD_LIMITS.IMAGE + 1
      }),
    /File exceeds maximum upload size\./
  );
});

test("invalid upload types are rejected", () => {
  assert.throws(
    () =>
      validateInboxUploadFile({
        fileName: "archive.exe",
        mimeType: "application/x-msdownload",
        sizeBytes: 1024
      }),
    /Unsupported file type\./
  );
});

test("voice mime detection only flags ogg or opus payloads", () => {
  assert.equal(isVoiceMimeType("audio/ogg"), true);
  assert.equal(isVoiceMimeType("audio/opus"), true);
  assert.equal(isVoiceMimeType("audio/mpeg"), false);
});

test("uploaded file names are sanitized", () => {
  assert.equal(sanitizeUploadedFileName("../../voice note!!.mp3"), "voice note.mp3");
});
