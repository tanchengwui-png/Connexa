import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (...parts) => readFileSync(join(root, ...parts), "utf8");

for (const resetPath of [
  ["lib", "platform-database-reset.ts"],
  ["prisma", "reseed-demo.mjs"]
]) {
  test(`${resetPath.join("/")} deletes restricted deletion requests before agents`, () => {
    const reset = read(...resetPath);
    const deletionRequests = reset.indexOf("prisma.deletionRequest.deleteMany()");
    const agents = reset.indexOf("prisma.agent.deleteMany()");

    assert.notEqual(deletionRequests, -1);
    assert.notEqual(agents, -1);
    assert.ok(deletionRequests < agents);
  });
}
