import { NextRequest, NextResponse } from "next/server";
import { finalizeCheckoutFromCallback } from "@/lib/checkout";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const params: Record<string, string> = {};

    for (const [key, value] of formData.entries()) {
      params[key] = String(value);
    }

    await finalizeCheckoutFromCallback(params);
    return new NextResponse("ok", { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to process Billplz callback.";
    return new NextResponse(message, { status: 400 });
  }
}
