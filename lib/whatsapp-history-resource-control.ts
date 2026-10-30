type QueuedJob<T> = {
  accountKey: string;
  priority: number;
  sequence: number;
  run: () => Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

declare global {
  // eslint-disable-next-line no-var
  var connexaHistorySyncActiveJobs: number | undefined;
  // eslint-disable-next-line no-var
  var connexaHistorySyncQueue: QueuedJob<unknown>[] | undefined;
  // eslint-disable-next-line no-var
  var connexaHistorySyncKeys: Set<string> | undefined;
  // eslint-disable-next-line no-var
  var connexaHistorySyncLastAccountKey: string | undefined;
  // eslint-disable-next-line no-var
  var connexaHistorySyncSequence: number | undefined;
}

const queue = global.connexaHistorySyncQueue ?? [];
const activeKeys = global.connexaHistorySyncKeys ?? new Set<string>();
global.connexaHistorySyncQueue = queue;
global.connexaHistorySyncKeys = activeKeys;
global.connexaHistorySyncActiveJobs ??= 0;
global.connexaHistorySyncSequence ??= 0;

function getConcurrencyLimit() {
  return Math.max(1, Number.parseInt(process.env.WHATSAPP_HISTORY_GLOBAL_CONCURRENCY ?? "1", 10) || 1);
}

function drainQueue() {
  while ((global.connexaHistorySyncActiveJobs ?? 0) < getConcurrencyLimit() && queue.length > 0) {
    const bestPriority = Math.min(...queue.map((candidate) => candidate.priority));
    const eligible = queue
      .map((candidate, index) => ({ candidate, index }))
      .filter(({ candidate }) => candidate.priority === bestPriority);
    const fairCandidate =
      eligible.find(({ candidate }) => candidate.accountKey !== global.connexaHistorySyncLastAccountKey) ??
      eligible[0];
    const job = fairCandidate ? queue.splice(fairCandidate.index, 1)[0] : undefined;
    if (!job) return;
    global.connexaHistorySyncLastAccountKey = job.accountKey;
    global.connexaHistorySyncActiveJobs = (global.connexaHistorySyncActiveJobs ?? 0) + 1;
    void job
      .run()
      .then(job.resolve, job.reject)
      .finally(() => {
        global.connexaHistorySyncActiveJobs = Math.max(0, (global.connexaHistorySyncActiveJobs ?? 1) - 1);
        drainQueue();
      });
  }
}

export async function runWithWhatsAppHistoryBudget<T>(input: {
  key: string;
  accountKey?: string;
  priority?: "bootstrap" | "incremental" | "routine" | "media";
  skippedValue: T;
  run: () => Promise<T>;
}): Promise<T> {
  if (activeKeys.has(input.key)) {
    return input.skippedValue;
  }

  activeKeys.add(input.key);
  try {
    return await new Promise<T>((resolve, reject) => {
      const priority =
        input.priority === "bootstrap" ? 0 : input.priority === "incremental" ? 1 : input.priority === "media" ? 3 : 2;
      queue.push({
        accountKey: input.accountKey ?? input.key,
        priority,
        sequence: (global.connexaHistorySyncSequence = (global.connexaHistorySyncSequence ?? 0) + 1),
        run: input.run,
        resolve,
        reject
      } as QueuedJob<unknown>);
      drainQueue();
    });
  } finally {
    activeKeys.delete(input.key);
  }
}

export function getWhatsAppHistoryResourceSnapshot() {
  return {
    active: global.connexaHistorySyncActiveJobs ?? 0,
    queued: queue.length,
    concurrency: getConcurrencyLimit(),
    queuedBootstrap: queue.filter((job) => job.priority === 0).length,
    queuedIncremental: queue.filter((job) => job.priority === 1).length,
    queuedRoutine: queue.filter((job) => job.priority === 2).length,
    queuedMedia: queue.filter((job) => job.priority === 3).length
  };
}
