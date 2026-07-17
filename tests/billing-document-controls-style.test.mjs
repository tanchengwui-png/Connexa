import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

const repoRoot = resolve(dirname(new URL(import.meta.url).pathname), "..");

test("billing document controls use clear light-theme button contrast", () => {
  const css = readFileSync(join(repoRoot, "app", "globals.css"), "utf8");

  assert.match(css, /html\[data-theme="light"\] \.subscriber-icon-button,/);
  assert.match(css, /html\[data-theme="light"\] \.subscriber-pagination button \{/);
  assert.match(css, /color: #173b78;/);
  assert.match(css, /border-color: rgba\(45, 99, 181, 0\.38\);/);
  assert.match(css, /background: linear-gradient\(180deg, #ffffff, #eaf2ff\);/);
  assert.match(css, /html\[data-theme="light"\] \.subscriber-icon-button:disabled:hover,/);
  assert.match(css, /background: rgba\(238, 244, 252, 0\.9\);/);
});
