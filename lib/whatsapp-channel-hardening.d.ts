export function pickOnlyChannelId(channelIds: Array<string | null | undefined>): string | null;
export function resolveBackfillChannelId(input: {
  currentChannelId?: string | null;
  relatedChannelIds?: Array<string | null | undefined>;
  workspaceDefaultChannelId?: string | null;
}): string | null;
export function canCreateAnotherChannel(input: {
  currentChannelCount: number;
  numberLimit: number | null;
}): boolean;
export function shouldDeleteChannelRecord(totalChannels: number): boolean;
