import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = "/srv/recurvos/staging/connexa/repo";

function readRepoFile(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("/quick-replies now renders a list-first management page", () => {
  const source = readRepoFile("app/quick-replies/page.tsx");

  assert.match(source, /getQuickReplyListData/);
  assert.match(source, /<QuickReplyList/);
  assert.doesNotMatch(source, /<QuickRepliesManager/);
});

test("quick reply create route uses the shared editor in create mode", () => {
  const source = readRepoFile("app/quick-replies/new/page.tsx");

  assert.match(source, /<QuickReplyEditor/);
  assert.match(source, /mode="create"/);
});

test("quick reply edit route loads a single record and reuses the shared editor", () => {
  const source = readRepoFile("app/quick-replies/[id]/edit/page.tsx");

  assert.match(source, /getQuickReplyById/);
  assert.match(source, /initialReply=\{quickReply\}/);
  assert.match(source, /mode="edit"/);
  assert.match(source, /notFound\(\)/);
});

test("quick reply list component includes search, empty state, edit, and delete actions", () => {
  const source = readRepoFile("components/quick-reply-list.tsx");

  assert.match(source, /Search title, shortcut, category, or reply body/);
  assert.match(source, /No quick replies yet\./);
  assert.match(source, /href="\/quick-replies\/new"/);
  assert.match(source, /href=\{`\/quick-replies\/\$\{item\.id\}\/edit`\}/);
  assert.match(source, /Delete quick reply\?/);
  assert.match(source, /Deleting\.\.\./);
});

test("quick reply editor keeps template sample, add template, cancel, and save flows", () => {
  const source = readRepoFile("components/quick-reply-editor.tsx");

  assert.match(source, /Template sample/);
  assert.match(source, /Add template/);
  assert.match(source, /Use template/);
  assert.match(source, /href="\/quick-replies"/);
  assert.match(source, /router\.push\(redirectOnSaveTo\)/);
});

test("quick reply API and data layer support list, single-fetch, create, update, and delete", () => {
  const libSource = readRepoFile("lib/quick-replies.ts");
  const routeSource = readRepoFile("app/api/quick-replies/[id]/route.ts");

  assert.match(libSource, /export async function getQuickReplyById/);
  assert.match(libSource, /createdAt: item\.createdAt\.toISOString\(\)/);
  assert.match(libSource, /updatedAt: item\.updatedAt\.toISOString\(\)/);
  assert.match(libSource, /Shortcut already exists\. Use a different shortcut\./);
  assert.match(routeSource, /export async function GET/);
  assert.match(routeSource, /Quick reply not found\./);
});
