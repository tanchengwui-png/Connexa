import { readFile } from "fs/promises";
import { NextRequest, NextResponse } from "next/server";
import {
  deleteWorkspaceMediaAsset,
  findWorkspaceMediaAssetById,
  renameWorkspaceMediaAsset
} from "@/lib/media-library";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const asset = await findWorkspaceMediaAssetById(id);

    if (!asset) {
      return NextResponse.json({ error: "Media asset not found." }, { status: 404 });
    }

    const fileBuffer = await readFile(asset.storagePath);

    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        "Content-Type": asset.mimeType || "application/octet-stream",
        "Content-Length": `${fileBuffer.byteLength}`,
        "Cache-Control": "public, max-age=0, must-revalidate",
        "Content-Disposition": `inline; filename="${encodeURIComponent(asset.originalName)}"`
      }
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to load media."
      },
      { status: 400 }
    );
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    await deleteWorkspaceMediaAsset(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error && error.message === "UNAUTHORIZED"
            ? "Unauthorized."
            : error instanceof Error
              ? error.message
              : "Unable to delete media."
      },
      { status: error instanceof Error && error.message === "UNAUTHORIZED" ? 401 : 400 }
    );
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as {
      title?: string;
    };

    const asset = await renameWorkspaceMediaAsset({
      assetId: id,
      title: body.title ?? ""
    });

    return NextResponse.json({ asset });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error && error.message === "UNAUTHORIZED"
            ? "Unauthorized."
            : error instanceof Error
              ? error.message
              : "Unable to rename media."
      },
      { status: error instanceof Error && error.message === "UNAUTHORIZED" ? 401 : 400 }
    );
  }
}
