import { NextRequest, NextResponse } from "next/server";
import { getPasswordResetServerErrorMessage } from "@/lib/auth/password-reset-shared";
import {
  resetPasswordWithToken
} from "@/lib/auth/password-reset";

const VALIDATION_ERRORS = new Set([
  "New password is required.",
  "Password must be at least 8 characters.",
  "Passwords do not match.",
  "This password reset link is invalid or has already been used.",
  "This password reset link has expired. Request a new one to continue."
]);

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as
    | {
        token?: string;
        password?: string;
        confirmPassword?: string;
      }
    | null;

  try {
    await resetPasswordWithToken({
      token: body?.token ?? "",
      password: body?.password ?? "",
      confirmPassword: body?.confirmPassword ?? ""
    });

    return NextResponse.json({
      ok: true
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : getPasswordResetServerErrorMessage();
    const isValidationError = VALIDATION_ERRORS.has(message);

    return NextResponse.json(
      {
        error: isValidationError ? message : getPasswordResetServerErrorMessage()
      },
      { status: isValidationError ? 400 : 500 }
    );
  }
}
