import { NextRequest, NextResponse } from "next/server";
import { getPasswordResetServerErrorMessage } from "@/lib/auth/password-reset-shared";
import {
  requestPasswordReset
} from "@/lib/auth/password-reset";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    email?: string;
  };

  try {
    const result = await requestPasswordReset({
      email: body.email ?? ""
    });

    return NextResponse.json({
      ok: true,
      message: result.message
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : getPasswordResetServerErrorMessage();
    const isValidationError =
      message === "Email is required." || message === "Enter a valid email address.";

    return NextResponse.json(
      {
        error: isValidationError ? message : getPasswordResetServerErrorMessage()
      },
      { status: isValidationError ? 400 : 500 }
    );
  }
}
