import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    {
      error: "Meta webhook mode has been replaced by WhatsApp Web QR login."
    },
    { status: 410 }
  );
}

export async function POST() {
  return NextResponse.json(
    {
      error: "Meta webhook mode has been replaced by WhatsApp Web QR login."
    },
    { status: 410 }
  );
}
