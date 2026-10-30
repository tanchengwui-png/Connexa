type ChannelLifecycleTail = Promise<void>;

declare global {
  // eslint-disable-next-line no-var
  var whatsAppChannelLifecycleTails: Map<string, ChannelLifecycleTail> | undefined;
  // eslint-disable-next-line no-var
  var whatsAppRuntimeGenerations: Map<string, string> | undefined;
  // eslint-disable-next-line no-var
  var whatsAppRuntimeGenerationCounter: number | undefined;
}

const lifecycleTails = global.whatsAppChannelLifecycleTails ?? new Map<string, ChannelLifecycleTail>();
const runtimeGenerations = global.whatsAppRuntimeGenerations ?? new Map<string, string>();

if (!global.whatsAppChannelLifecycleTails) global.whatsAppChannelLifecycleTails = lifecycleTails;
if (!global.whatsAppRuntimeGenerations) global.whatsAppRuntimeGenerations = runtimeGenerations;
if (global.whatsAppRuntimeGenerationCounter === undefined) global.whatsAppRuntimeGenerationCounter = 0;

export function createRuntimeGeneration(channelId: string) {
  global.whatsAppRuntimeGenerationCounter = (global.whatsAppRuntimeGenerationCounter ?? 0) + 1;
  const generationId = `${channelId}:${Date.now().toString(36)}:${global.whatsAppRuntimeGenerationCounter.toString(36)}`;
  runtimeGenerations.set(channelId, generationId);
  return generationId;
}

export function isCurrentRuntimeGeneration(channelId: string, generationId: string) {
  return runtimeGenerations.get(channelId) === generationId;
}

export function invalidateRuntimeGeneration(channelId: string, generationId?: string) {
  if (generationId && !isCurrentRuntimeGeneration(channelId, generationId)) return false;
  runtimeGenerations.delete(channelId);
  return true;
}

/** Serialize all client creation, replacement, teardown and manual reset work per channel. */
export function runSerializedChannelLifecycle<T>(channelId: string, operation: () => Promise<T>): Promise<T> {
  const previous = lifecycleTails.get(channelId) ?? Promise.resolve();
  const result = previous.catch(() => undefined).then(operation);
  const tail = result.then(() => undefined, () => undefined);
  lifecycleTails.set(channelId, tail);
  void tail.finally(() => {
    if (lifecycleTails.get(channelId) === tail) lifecycleTails.delete(channelId);
  });
  return result;
}

export function hasRecentLifecycleProgress(input: {
  now: number;
  lastProgressAt: number;
  timeoutMs: number;
}) {
  return input.now - input.lastProgressAt < input.timeoutMs;
}
