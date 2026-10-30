import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);

function readProjectFile(path) {
  return readFileSync(join(repoRoot, path), "utf8");
}

test("global favicon uses the static Connexa favicon asset", () => {
  assert.ok(!existsSync(join(repoRoot, "public", "favicon.png")));
  assert.ok(!existsSync(join(repoRoot, "public", "favicon.ico")));
  assert.ok(existsSync(join(repoRoot, "public", "connexa-favicon-512.png")));
  assert.ok(!existsSync(join(repoRoot, "app", "icon.tsx")));
  assert.ok(!existsSync(join(repoRoot, "app", "apple-icon.tsx")));

  const layout = readProjectFile("app/layout.tsx");
  assert.match(layout, /shortcut: "\/connexa-favicon-512\.png"/);
  assert.match(layout, /url: "\/connexa-favicon-512\.png"/);
  assert.doesNotMatch(layout, /"\/favicon\.png"/);
  assert.doesNotMatch(layout, /"\/favicon\.ico"/);
  assert.doesNotMatch(layout, /"\/icon"/);
  assert.doesNotMatch(layout, /"\/apple-icon"/);
});

test("manifest and worker cache reference the static favicon files", () => {
  const manifest = readProjectFile("app/manifest.ts");
  const serviceWorker = readProjectFile("public/sw.js");
  const webPush = readProjectFile("lib/inbox-web-push.ts");

  for (const source of [manifest, serviceWorker, webPush]) {
    assert.doesNotMatch(source, /"\/icon"/);
    assert.doesNotMatch(source, /"\/apple-icon"/);
    assert.doesNotMatch(source, /"\/favicon\.ico"/);
    assert.doesNotMatch(source, /"\/favicon\.png"/);
  }

  assert.match(manifest, /src: "\/connexa-favicon-512\.png"/);
  assert.match(serviceWorker, /"\/connexa-favicon-512\.png"/);
  assert.match(webPush, /\/connexa-favicon-512\.png/);
});
