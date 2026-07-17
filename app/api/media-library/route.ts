import { NextRequest, NextResponse } from "next/server";
import { MediaAssetSource } from "@/lib/db-types";
import {
  createWorkspaceMediaAsset,
  getMediaLibraryData,
  isWorkspaceMediaStorageLimitError
} from "@/lib/media-library";

export async function GET() {
  try {
    const data = await getMediaLibraryData();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error && error.message === "UNAUTHORIZED"
            ? "Unauthorized."
            : "Unable to load media library."
      },
      { status: error instanceof Error && error.message === "UNAUTHORIZED" ? 401 : 400 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const sourceModule = parseSourceModule(formData.get("sourceModule"));

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Choose a file to upload." }, { status: 400 });
    }

    const asset = await createWorkspaceMediaAsset({
      file,
      sourceModule
    });

    return NextResponse.json({ asset }, { status: 201 });
  } catch (error) {
    if (isWorkspaceMediaStorageLimitError(error)) {
      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
          limitBytes: error.limitBytes,
          usedStorageBytes: error.usedStorageBytes,
          requestedUploadBytes: error.requestedUploadBytes,
          remainingStorageBytes: error.remainingStorageBytes
        },
        { status: error.status }
      );
    }

    return NextResponse.json(
      {
        error:
          error instanceof Error && error.message === "UNAUTHORIZED"
            ? "Unauthorized."
            : error instanceof Error
              ? error.message
              : "Unable to upload media."
      },
      { status: error instanceof Error && error.message === "UNAUTHORIZED" ? 401 : 400 }
    );
  }
}

function parseSourceModule(value: FormDataEntryValue | null) {
  switch (value) {
    case MediaAssetSource.QUICK_REPLY:
      return MediaAssetSource.QUICK_REPLY;
    case MediaAssetSource.CAMPAIGN:
      return MediaAssetSource.CAMPAIGN;
    case MediaAssetSource.AUTOMATION_RULE:
      return MediaAssetSource.AUTOMATION_RULE;
    case MediaAssetSource.AUTOMATION_WORKFLOW:
      return MediaAssetSource.AUTOMATION_WORKFLOW;
    case MediaAssetSource.INBOX:
      return MediaAssetSource.INBOX;
    default:
      return MediaAssetSource.MEDIA_LIBRARY;
  }
}
