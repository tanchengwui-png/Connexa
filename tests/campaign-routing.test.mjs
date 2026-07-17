import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = "/srv/recurvos/staging/connexa/repo";

function readRepoFile(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("/campaigns renders the campaign list instead of the editor workspace", () => {
  const source = readRepoFile("app/campaigns/page.tsx");

  assert.match(source, /getCampaignDraftListData/);
  assert.match(source, /<CampaignList drafts=\{drafts\} \/>/);
  assert.doesNotMatch(source, /<CampaignsWorkspace/);
});

test("campaign create route uses the shared editor and redirects saves back to the list", () => {
  const source = readRepoFile("app/campaigns/new/page.tsx");

  assert.match(source, /<CampaignsWorkspace/);
  assert.match(source, /mode="create"/);
  assert.match(source, /redirectOnSaveTo="\/campaigns"/);
  assert.match(source, /showHistory=\{false\}/);
});

test("campaign edit route loads an existing draft and reuses the shared editor", () => {
  const source = readRepoFile("app/campaigns/\\[id\\]/edit/page.tsx".replace(/\\/g, ""));

  assert.match(source, /getCampaignDraftById/);
  assert.match(source, /initialDraft=\{draft\}/);
  assert.match(source, /mode="edit"/);
  assert.match(source, /redirectOnSaveTo="\/campaigns"/);
});

test("campaign list wiring includes create, edit, delete, and empty-state actions", () => {
  const source = readRepoFile("components/campaign-list.tsx");

  assert.match(source, /No campaigns yet/);
  assert.match(source, /href="\/campaigns\/new"/);
  assert.match(source, /href=\{`\/campaigns\/\$\{draft\.id\}\/edit`\}/);
  assert.match(source, /Delete campaign\?/);
  assert.match(source, /router\.refresh\(\)/);
  assert.match(source, /Campaign deleted/);
});

test("campaign workspace save flow supports redirecting back to the list", () => {
  const source = readRepoFile("components/campaigns-workspace.tsx");

  assert.match(source, /redirectOnSaveTo\?: string \| null/);
  assert.match(source, /if \(redirectOnSaveTo\) \{/);
  assert.match(source, /router\.push\(redirectOnSaveTo\)/);
  assert.match(source, /mode === "edit" \? "Update campaign" : "Save draft"/);
});
