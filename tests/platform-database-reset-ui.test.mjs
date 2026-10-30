import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const component = readFileSync(join(root, "components", "platform-database-reset-card.tsx"), "utf8");
const css = readFileSync(join(root, "app", "globals.css"), "utf8");

test("database reset card uses compact scoped header and action layout", () => {
  assert.match(component, /platform-database-reset-head/);
  assert.match(component, /platform-database-reset-warning/);
  assert.match(component, /platform-database-reset-actions/);
  assert.doesNotMatch(component, /className="card-header settings-dark-panel-head"/);
  assert.doesNotMatch(component, /className="panel-row"/);
  assert.match(css, /\.platform-database-reset-card \{[\s\S]*padding: 0;[\s\S]*overflow: hidden;/);
  assert.match(css, /\.platform-database-reset-actions \{[\s\S]*justify-content: space-between;/);
});

test("database reset completion is structured and accessible", () => {
  assert.match(component, /aria-live="polite"[\s\S]*role="status"/);
  assert.match(component, /platform-database-reset-summary/);
  assert.match(component, /<dt>Target<\/dt>/);
  assert.match(component, /<dt>Seeded owner<\/dt>/);
  assert.match(component, /<dt>Workspace data<\/dt>/);
  assert.doesNotMatch(component, /Remaining rows:/);
});

test("database reset card remains usable on narrow screens", () => {
  assert.match(css, /@media \(max-width: 720px\) \{[\s\S]*\.platform-database-reset-actions \{[\s\S]*flex-direction: column;/);
  assert.match(css, /@media \(max-width: 720px\) \{[\s\S]*\.platform-database-reset-summary \{[\s\S]*grid-template-columns: minmax\(0, 1fr\);/);
});
