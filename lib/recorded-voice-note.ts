import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { sanitizeUploadedFileName, validateInboxUploadFile } from "@/lib/inbox-upload";

const RECORDED_VOICE_NOTE_DIR = path.join(process.cwd(), "public", "uploads", "voice-notes");

export async function storeRecordedVoiceNote(input: {
  workspaceId: string;
  file: File;
}) {
  const originalName = sanitizeUploadedFileName(input.file.name || "voice-note.ogg");
  const mimeType = input.file.type.split(";", 1)[0]?.trim().toLowerCase() || "audio/ogg";
  validateInboxUploadFile({
    fileName: originalName,
    mimeType,
    sizeBytes: input.file.size
  });

  if (!mimeType.startsWith("audio/")) {
    throw new Error("Recorded voice notes must be audio files.");
  }

  const storageDirectory = path.join(RECORDED_VOICE_NOTE_DIR, input.workspaceId);
  const storageName = `${Date.now()}-${randomUUID()}-${originalName}`;
  const storagePath = path.join(storageDirectory, storageName);
  const publicUrl = `/uploads/voice-notes/${input.workspaceId}/${storageName}`;

  await mkdir(storageDirectory, { recursive: true });
  await writeFile(storagePath, Buffer.from(await input.file.arrayBuffer()));

  return {
    attachmentName: originalName,
    attachmentPath: storagePath,
    attachmentUrl: publicUrl,
    mimeType,
    cleanup: () => rm(storagePath, { force: true })
  };
}
