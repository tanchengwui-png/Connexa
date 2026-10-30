import { NextResponse } from "next/server";
import { requireCurrentApiAgent } from "@/lib/auth/current-user";
import { listWorkspaceMediaAssets } from "@/lib/media-library";
import { formatMediaAssetSize } from "@/lib/media-library-shared";

export async function GET() {
  try {
    const agent = await requireCurrentApiAgent();
    const assets = await listWorkspaceMediaAssets(agent.workspaceId);
    return NextResponse.json({
      assets: assets.map((asset) => ({
        id: asset.id,
        title: asset.title,
        originalName: asset.originalName,
        publicUrl: asset.publicUrl,
        kind: asset.kind,
        mimeType: asset.mimeType,
        sizeLabel: formatMediaAssetSize(asset.sizeBytes)
      }))
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error && error.message === "UNAUTHORIZED" ? "Unauthorized." : "Unable to load Inbox media." },
      { status: error instanceof Error && error.message === "UNAUTHORIZED" ? 401 : 400 }
    );
  }
}
