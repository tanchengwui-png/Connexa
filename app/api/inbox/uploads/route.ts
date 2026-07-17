import { NextRequest, NextResponse } from "next/server";
import { MediaAssetSource } from "@/lib/db-types";
import {
  createWorkspaceMediaAssets,
  isWorkspaceMediaStorageLimitError
} from "@/lib/media-library";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const files = formData.getAll("files").filter((entry): entry is File => entry instanceof File);

    if (!files.length) {
      return NextResponse.json({ error: "Choose a file to upload." }, { status: 400 });
    }

    const assets = await createWorkspaceMediaAssets({
      files,
      sourceModule: MediaAssetSource.INBOX
    });

    return NextResponse.json({ assets }, { status: 201 });
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
