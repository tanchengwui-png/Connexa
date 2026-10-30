import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const css = readFileSync(join(repoRoot, "app", "globals.css"), "utf8");

test("landing page does not create a hidden vertical scroll container", () => {
  const shellRule = css.match(/\.connexa-dark-shell\s*\{(?<body>[\s\S]*?)\}/)?.groups?.body ?? "";

  assert.match(shellRule, /overflow-x:\s*clip;/);
  assert.doesNotMatch(shellRule, /overflow:\s*hidden;/);
  assert.doesNotMatch(shellRule, /overflow-y:\s*(?:auto|scroll|hidden);/);
});
