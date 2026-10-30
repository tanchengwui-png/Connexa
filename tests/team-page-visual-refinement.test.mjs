import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const page = readFileSync(join(process.cwd(), "app", "team", "page.tsx"), "utf8");
const members = readFileSync(join(process.cwd(), "components", "team-members-card.tsx"), "utf8");
const invites = readFileSync(join(process.cwd(), "components", "pending-invites-card.tsx"), "utf8");
const css = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");

test("team page preserves the exact hero title and invite anchor", () => {
  assert.match(page, /<h1>Keep staffing, availability, and invites on one operating page\.<\/h1>/);
  assert.match(page, /href="#invite-teammates"/);
  assert.match(page, /teamCapacity\.seatsUsed[\s\S]*teamCapacity\.memberLimit[\s\S]*seats used/);
});

test("team page keeps the existing member and invitation actions", () => {
  assert.match(members, /method: "PATCH"/);
  assert.match(members, /method: "DELETE"/);
  assert.match(members, /Confirm member update/);
  assert.match(members, /Remove team member/);
  assert.match(invites, /method: "PATCH" \| "DELETE"/);
  assert.match(invites, /Resend invitation/);
});

test("team page uses compact borderless internal sections and responsive containment", () => {
  assert.match(css, /\.team-page \.team-hero \{[\s\S]*min-height: 0;[\s\S]*padding:/);
  assert.match(css, /\.team-page \.team-dashboard \{[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  assert.match(css, /\.team-page \.team-panel > \.team-panel-header \{[\s\S]*border: 0;[\s\S]*background: transparent;/);
  assert.match(css, /\.team-page \.team-member-row \{[\s\S]*grid-template-columns:/);
  assert.match(css, /@media \(max-width: 720px\) \{[\s\S]*\.team-page \.team-dashboard \{[\s\S]*grid-template-columns: 1fr;/);
});
