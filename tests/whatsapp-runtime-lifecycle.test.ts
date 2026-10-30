import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createRuntimeGeneration,
  hasRecentLifecycleProgress,
  invalidateRuntimeGeneration,
  isCurrentRuntimeGeneration,
  runSerializedChannelLifecycle
} from "../lib/whatsapp-runtime-lifecycle.ts";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("slow authentication is not stale at 90 seconds during the initialization phase", () => {
  assert.equal(
    hasRecentLifecycleProgress({
      now: 91_000,
      lastProgressAt: 0,
      timeoutMs: 180_000
    }),
    true
  );
});

test("incremental loading progress keeps a prolonged authentication alive", () => {
  assert.equal(
    hasRecentLifecycleProgress({
      now: 200_000,
      lastProgressAt: 140_000,
      timeoutMs: 90_000
    }),
    true
  );
  assert.equal(
    hasRecentLifecycleProgress({
      now: 231_000,
      lastProgressAt: 140_000,
      timeoutMs: 90_000
    }),
    false
  );
});

test("lifecycle operations never overlap for one channel", async () => {
  const channelId = `serialized-${Date.now()}-${Math.random()}`;
  let active = 0;
  let maxActive = 0;

  const operations = Array.from({ length: 5 }, (_, index) =>
    runSerializedChannelLifecycle(channelId, async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      return index;
    })
  );

  assert.deepEqual(await Promise.all(operations), [0, 1, 2, 3, 4]);
  assert.equal(maxActive, 1);
});

test("manual fresh start waits for pending initialization instead of interfering", async () => {
  const channelId = `fresh-start-${Date.now()}-${Math.random()}`;
  const initializationGate = deferred();
  const order: string[] = [];

  const initialization = runSerializedChannelLifecycle(channelId, async () => {
    order.push("initialize:start");
    await initializationGate.promise;
    order.push("initialize:end");
  });
  const freshStart = runSerializedChannelLifecycle(channelId, async () => {
    order.push("fresh-start");
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ["initialize:start"]);
  initializationGate.resolve();
  await Promise.all([initialization, freshStart]);
  assert.deepEqual(order, ["initialize:start", "initialize:end", "fresh-start"]);
});

test("two WhatsApp channels recover independently", async () => {
  const suffix = `${Date.now()}-${Math.random()}`;
  const firstGate = deferred();
  const order: string[] = [];

  const first = runSerializedChannelLifecycle(`first-${suffix}`, async () => {
    order.push("first:start");
    await firstGate.promise;
    order.push("first:end");
  });
  const second = runSerializedChannelLifecycle(`second-${suffix}`, async () => {
    order.push("second:complete");
  });

  await second;
  assert.deepEqual(order, ["first:start", "second:complete"]);
  firstGate.resolve();
  await first;
});

test("replacement generations reject obsolete runtime events and promises", () => {
  const channelId = `generation-${Date.now()}-${Math.random()}`;
  const obsoleteGeneration = createRuntimeGeneration(channelId);
  assert.equal(isCurrentRuntimeGeneration(channelId, obsoleteGeneration), true);

  invalidateRuntimeGeneration(channelId, obsoleteGeneration);
  const replacementGeneration = createRuntimeGeneration(channelId);
  assert.equal(isCurrentRuntimeGeneration(channelId, obsoleteGeneration), false);
  assert.equal(isCurrentRuntimeGeneration(channelId, replacementGeneration), true);
});

test("runtime wiring records loading progress, fences persistence, and atomically fresh-starts", () => {
  const webSource = readFileSync(new URL("../lib/whatsapp-web.ts", import.meta.url), "utf8");
  const routeSource = readFileSync(
    new URL("../app/api/settings/whatsapp/route.ts", import.meta.url),
    "utf8"
  );

  assert.match(webSource, /boundClient\.on\("loading_screen"/);
  assert.match(
    webSource,
    /recordLifecycleProgress\(state, typeof percent === "number" \? percent : Number\(percent\)\)/
  );
  assert.match(webSource, /saveWhatsAppChannelConnectionIfSessionCurrent/);
  assert.match(webSource, /pending && isCurrentRuntimeGeneration\(channelId, pending\.generationId\)/);
  assert.match(webSource, /state\.lifecycleProgressAt !== lifecycleProgressAt/);
  assert.match(webSource, /teardownActiveRuntimeStateSerialized/);
  assert.match(webSource, /export async function freshStartWorkspaceWhatsAppClient/);
  assert.match(webSource, /return runSerializedChannelLifecycle\(channel\.id, async \(\) =>/);
  assert.match(routeSource, /await freshStartWorkspaceWhatsAppClient\(/);
  assert.doesNotMatch(
    routeSource,
    /if \(body\?\.action === "fresh-start"\) \{\s*await deleteWorkspaceWhatsAppClientSession/
  );
});
