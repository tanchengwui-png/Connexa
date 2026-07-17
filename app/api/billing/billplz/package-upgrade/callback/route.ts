import { NextRequest, NextResponse } from "next/server";
import { finalizeWorkspacePackageUpgradeFromCallback } from "@/lib/workspace-package-upgrades";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const params: Record<string, string> = {};

    for (const [key, value] of formData.entries()) {
      params[key] = String(value);
    }

    await finalizeWorkspacePackageUpgradeFromCallback(params);
    return new NextResponse("ok", { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to process package upgrade callback.";
    return new NextResponse(message, { status: 400 });
  }
}
