export type ContactTagLike = {
  id: string;
  name: string;
  description?: string | null;
};

export const DUPLICATE_CONTACT_TAG_MODAL_MESSAGE =
  "This tag already exists. Please select it from the Existing tags dropdown.";

export function normalizeContactTagName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function normalizeContactTagKey(value: string) {
  return normalizeContactTagName(value).toLowerCase();
}

export function sortContactTags<T extends ContactTagLike>(tags: T[]) {
  return [...tags].sort((left, right) => left.name.localeCompare(right.name));
}

export function findContactTagByName<T extends ContactTagLike>(tags: T[], value: string) {
  const normalizedValue = normalizeContactTagKey(value);
  if (!normalizedValue) {
    return null;
  }

  return tags.find((tag) => normalizeContactTagKey(tag.name) === normalizedValue) ?? null;
}

export function addTagToContact(currentTags: string[], value: string) {
  const nextName = normalizeContactTagName(value);
  if (!nextName) {
    return [...currentTags];
  }

  if (currentTags.some((tag) => normalizeContactTagKey(tag) === normalizeContactTagKey(nextName))) {
    return [...currentTags];
  }

  return [...currentTags, nextName];
}

export function mergeContactTagCollections<T extends ContactTagLike>(current: T[], next: T[]) {
  const merged = new Map<string, T>();

  [...current, ...next].forEach((tag) => {
    const normalizedKey = normalizeContactTagKey(tag.name);
    if (!normalizedKey) {
      return;
    }

    if (!merged.has(normalizedKey) || tag.description) {
      merged.set(normalizedKey, tag);
    }
  });

  return sortContactTags([...merged.values()]);
}

export function buildCreateContactTagDraft(value: string) {
  return {
    name: normalizeContactTagName(value),
    description: ""
  };
}

export async function createAndApplyContactTag<T extends ContactTagLike>(input: {
  availableTags: T[];
  currentTags: string[];
  description?: string | null;
  name: string;
}, dependencies: {
  applyTags: (tags: string[]) => Promise<void>;
  createTag: (input: { description: string | null; name: string }) => Promise<T>;
}) {
  const normalizedName = normalizeContactTagName(input.name);

  if (!normalizedName) {
    return {
      ok: false as const,
      error: "Tag name is required."
    };
  }

  if (findContactTagByName(input.availableTags, normalizedName)) {
    return {
      ok: false as const,
      error: DUPLICATE_CONTACT_TAG_MODAL_MESSAGE
    };
  }

  const createdTag = await dependencies.createTag({
    name: normalizedName,
    description: normalizeContactTagName(input.description ?? "") || null
  });
  const nextTags = addTagToContact(input.currentTags, createdTag.name);
  await dependencies.applyTags(nextTags);

  return {
    ok: true as const,
    tag: createdTag,
    tags: nextTags
  };
}
