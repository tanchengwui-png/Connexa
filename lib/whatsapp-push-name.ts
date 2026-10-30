export function normalizeWhatsAppPushName(value?: string | null) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  // The tilde is presentation-only in WhatsApp's UI and in our Contacts list.
  // Keep the owner-configured value itself clean in storage.
  return trimmed.replace(/^~+\s*/, "").trim() || null;
}
