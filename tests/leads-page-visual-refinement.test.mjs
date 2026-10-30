import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const workspace = readFileSync(join(process.cwd(), "components", "leads-workspace.tsx"), "utf8");
const css = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");

test("leads preserves the title, live counts, filters, updates, and record action", () => {
  assert.match(workspace, /<h1>Leads<\/h1>/);
  assert.match(workspace, /Pipeline management/);
  assert.match(workspace, /setStageFilter/);
  assert.match(workspace, /setOwnerFilter/);
  assert.match(workspace, /method: "PATCH"/);
  assert.match(workspace, /href=\{`\/leads\/\$\{lead\.id\}`\}/);
});

test("leads removes repeated status presentation and keeps compact accessible rows", () => {
  assert.doesNotMatch(workspace, /auth-page-hero-panel-label/);
  assert.doesNotMatch(workspace, /scheduled-inline-stats/);
  assert.match(workspace, /aria-label="Search leads"/);
  assert.match(workspace, /aria-label=\{`Owner for \$\{lead\.name \|\| lead\.phone\}`\}/);
  assert.match(workspace, /No contact name/);
  assert.match(workspace, /lead-workspace-activity/);
});

test("leads page styling is contained, list-first, and responsive", () => {
  assert.match(css, /\.leads-page \.leads-hero \{[\s\S]*min-height: 0;[\s\S]*padding:/);
  assert.match(css, /\.leads-page \.auth-page-hero-stat \{[\s\S]*border: 0;[\s\S]*background: transparent;/);
  assert.match(css, /\.leads-page \.lead-workspace-row \{[\s\S]*grid-template-columns: minmax\(12rem, 1fr\) minmax\(13rem, 1\.2fr\) minmax\(25rem, 2fr\);/);
  assert.match(css, /@media \(max-width: 680px\) \{[\s\S]*lead-workspace-row,[\s\S]*grid-template-columns: 1fr;/);
});
