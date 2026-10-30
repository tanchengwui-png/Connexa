type WhatsAppProfilePictureContact = {
  getProfilePicUrl?: () => Promise<string | null>;
  profilePicThumb?: { eurl?: string | null } | null;
  _data?: { profilePicThumb?: { eurl?: string | null } | null } | null;
} | null | undefined;

type WhatsAppProfilePictureClient = {
  getProfilePicUrl: (contactId: string) => Promise<string | null>;
};

const PROFILE_PICTURE_LOOKUP_ATTEMPTS = 3;
const PROFILE_PICTURE_RETRY_DELAY_MS = 200;
const PROFILE_PICTURE_RETRY_JITTER_MS = 50;

function normalizeProfilePictureUrl(value: string | null | undefined) {
  return value?.trim() || null;
}

async function retryTransientProfilePictureLookup(lookup: () => Promise<string | null>) {
  for (let attempt = 0; attempt < PROFILE_PICTURE_LOOKUP_ATTEMPTS; attempt += 1) {
    try {
      // A null response usually means the contact has restricted its profile
      // picture. Do not retry that privacy result; only retry thrown, transient
      // WhatsApp Web failures.
      return normalizeProfilePictureUrl(await lookup());
    } catch {
      if (attempt + 1 < PROFILE_PICTURE_LOOKUP_ATTEMPTS) {
        const delayMs =
          PROFILE_PICTURE_RETRY_DELAY_MS * 2 ** attempt +
          Math.floor(Math.random() * PROFILE_PICTURE_RETRY_JITTER_MS);
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  return null;
}

/**
 * Retrieves a short-lived WhatsApp Web profile-picture URL without letting a
 * privacy restriction or WhatsApp Web error affect message processing.
 */
export async function getWhatsAppProfilePictureUrl(input: {
  client: WhatsAppProfilePictureClient;
  contact?: WhatsAppProfilePictureContact;
  contactId?: string | null;
  contactIds?: Array<string | null | undefined>;
}) {
  const contactIds = Array.from(
    new Set(
      [input.contactId, ...(input.contactIds ?? [])]
        .map((contactId) => contactId?.trim())
        .filter((contactId): contactId is string => Boolean(contactId))
    )
  );
  if (!contactIds.length) {
    return null;
  }

  const loadedThumbnailUrl = normalizeProfilePictureUrl(
    input.contact?.profilePicThumb?.eurl ?? input.contact?._data?.profilePicThumb?.eurl
  );
  if (loadedThumbnailUrl) {
    return loadedThumbnailUrl;
  }

  if (input.contact?.getProfilePicUrl) {
    const contactUrl = await retryTransientProfilePictureLookup(() => input.contact!.getProfilePicUrl!());
    if (contactUrl) {
      return contactUrl;
    }
  }

  for (const contactId of contactIds) {
    const clientUrl = await retryTransientProfilePictureLookup(() => input.client.getProfilePicUrl(contactId));
    if (clientUrl) {
      return clientUrl;
    }
  }

  return null;
}
