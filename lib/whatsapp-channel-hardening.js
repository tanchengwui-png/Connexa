export function pickOnlyChannelId(channelIds) {
  const unique = Array.from(
    new Set(
      channelIds
        .map((channelId) => (typeof channelId === "string" ? channelId.trim() : ""))
        .filter(Boolean)
    )
  );

  return unique.length === 1 ? unique[0] : null;
}

export function resolveBackfillChannelId(input) {
  if (input.currentChannelId?.trim()) {
    return input.currentChannelId.trim();
  }

  const relatedChannelId = pickOnlyChannelId(input.relatedChannelIds ?? []);
  if (relatedChannelId) {
    return relatedChannelId;
  }

  if ((input.relatedChannelIds ?? []).some((channelId) => typeof channelId === "string" && channelId.trim())) {
    return null;
  }

  return input.workspaceDefaultChannelId?.trim() || null;
}

export function canCreateAnotherChannel(input) {
  return input.numberLimit === null || input.currentChannelCount < input.numberLimit;
}

export function shouldDeleteChannelRecord(totalChannels) {
  return totalChannels > 1;
}
