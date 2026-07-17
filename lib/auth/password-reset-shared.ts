export const PASSWORD_RESET_GENERIC_MESSAGE =
  "If an account exists for this email, we have sent password reset instructions.";

export const PASSWORD_RESET_SERVER_ERROR_MESSAGE =
  "Unable to process password reset right now. Please try again shortly.";

export const PASSWORD_RESET_TOKEN_INVALID_MESSAGE =
  "This password reset link is invalid or has already been used.";

export const PASSWORD_RESET_TOKEN_EXPIRED_MESSAGE =
  "This password reset link has expired. Request a new one to continue.";

export function normalizePasswordResetEmail(email: string) {
  return email.trim().toLowerCase();
}

export function validatePasswordResetEmail(email: string) {
  const normalizedEmail = normalizePasswordResetEmail(email);

  if (!normalizedEmail) {
    return {
      ok: false as const,
      error: "Email is required."
    };
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    return {
      ok: false as const,
      error: "Enter a valid email address."
    };
  }

  return {
    ok: true as const,
    email: normalizedEmail
  };
}

export function validatePasswordResetToken(token: string) {
  const normalizedToken = token.trim();

  if (!normalizedToken) {
    return {
      ok: false as const,
      error: PASSWORD_RESET_TOKEN_INVALID_MESSAGE
    };
  }

  return {
    ok: true as const,
    token: normalizedToken
  };
}

export function validatePasswordResetForm(password: string, confirmPassword: string) {
  if (!password) {
    return {
      ok: false as const,
      error: "New password is required."
    };
  }

  if (password.length < 8) {
    return {
      ok: false as const,
      error: "Password must be at least 8 characters."
    };
  }

  if (password !== confirmPassword) {
    return {
      ok: false as const,
      error: "Passwords do not match."
    };
  }

  return {
    ok: true as const
  };
}

export function getPasswordResetServerErrorMessage() {
  return PASSWORD_RESET_SERVER_ERROR_MESSAGE;
}

export function getPasswordResetTokenErrorMessage() {
  return PASSWORD_RESET_TOKEN_INVALID_MESSAGE;
}

export function getPasswordResetTokenExpiredMessage() {
  return PASSWORD_RESET_TOKEN_EXPIRED_MESSAGE;
}
