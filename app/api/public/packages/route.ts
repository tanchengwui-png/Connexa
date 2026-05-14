import { NextResponse } from "next/server";
import { getVisiblePublicPackages } from "@/lib/platform-packages";

export async function GET() {
  try {
    const packages = await getVisiblePublicPackages();
    return NextResponse.json({ packages });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load public packages.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
